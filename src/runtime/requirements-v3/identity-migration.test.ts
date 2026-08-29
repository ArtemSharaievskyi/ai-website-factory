import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PlannerAgentInputSchema } from "@/agents/planner/contracts";
import { buildPlanningPackage, planningDocumentChecksum, planningSemanticChecksum } from "@/agents/planner/deterministic";
import { representativeV1Brief, cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { createRequirementIdentityLineage } from "@/domain/requirements/v3/identity";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { BriefV3DocumentSchema, createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { RequirementIdentityMigrationService, prepareRequirementIdentityMigration } from "./identity-migration";

const projectId = "77777777-7777-4777-8777-777777777777";
const timestamp = "2026-01-01T00:00:00.000Z";

function historicalBrief() {
  return CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    requirements: cleanBriefV3.requirements.map((entry, index) => ({ ...entry, id: `REQUIREMENT:legacy-v1-migration-${index}` })),
  });
}

function candidates(brief: ReturnType<typeof historicalBrief>) {
  return brief.requirements.map((entry) => createRequirementIdentityLineage({ projectId, projectVersion: 1, fromRequirementId: entry.id, canonicalSemanticIdentity: `legacy-id:${entry.id}` }));
}

function planningPackage(brief: ReturnType<typeof historicalBrief>) {
  const compatibility = RequirementSpecificationSchema.parse({ ...representativeV1Brief, projectId, projectVersion: 1, approval: { approved: false }, briefStatus: "draft" });
  const input = PlannerAgentInputSchema.parse({ projectId, projectVersion: 1, approvedBrief: compatibility, canonicalBrief: brief, approvedBriefChecksum: canonicalBriefChecksum(brief), originalPromptReference: "synthetic-migration-prompt", clarificationEvidenceReferences: ["synthetic-clarification"], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: "synthetic-identity-migration", expectedRowVersion: 1 });
  const generated = buildPlanningPackage(input);
  const legacyId = brief.requirements[0]!.id;
  return { ...generated, traceability: generated.traceability.map((entry, index) => index === 0 ? { ...entry, requirementReferences: [legacyId] } : entry) };
}

describe("CanonicalBriefV3 requirement identity migration", () => {
  it("fails PREPARE closed for unmapped, ambiguous, and colliding lineage", () => {
    const brief = historicalBrief();
    const unsafe = prepareRequirementIdentityMigration({ projectId, projectVersion: 1, brief, lineageCandidates: [] });
    expect(unsafe.plan.safeToApply).toBe(false);
    expect(unsafe.plan.counts.unmappedMappings).toBe(brief.requirements.length);

    const one = createRequirementIdentityLineage({ projectId, projectVersion: 1, fromRequirementId: brief.requirements[0]!.id, canonicalSemanticIdentity: "same-semantic-key" });
    const duplicate = createRequirementIdentityLineage({ projectId, projectVersion: 1, fromRequirementId: brief.requirements[0]!.id, canonicalSemanticIdentity: "different-semantic-key" });
    const ambiguous = prepareRequirementIdentityMigration({ projectId, projectVersion: 1, brief, lineageCandidates: [one, duplicate] });
    expect(ambiguous.plan.safeToApply).toBe(false);
    expect(ambiguous.plan.ambiguousRequirementIds).toContain(brief.requirements[0]!.id);

    const first = createRequirementIdentityLineage({ projectId, projectVersion: 1, fromRequirementId: brief.requirements[0]!.id, canonicalSemanticIdentity: "collision-key" });
    const second = createRequirementIdentityLineage({ projectId, projectVersion: 1, fromRequirementId: brief.requirements[1]!.id, canonicalSemanticIdentity: "collision-key" });
    const collision = prepareRequirementIdentityMigration({ projectId, projectVersion: 1, brief, lineageCandidates: [first, second] });
    expect(collision.plan.safeToApply).toBe(false);
    expect(collision.plan.collisionRequirementIds).toEqual(expect.arrayContaining([brief.requirements[0]!.id, brief.requirements[1]!.id]));
  });

  it("fails PREPARE closed for cross-project candidates and preserves canonical text", () => {
    const brief = historicalBrief();
    const candidate = createRequirementIdentityLineage({ projectId: "88888888-8888-4888-8888-888888888888", projectVersion: 1, fromRequirementId: brief.requirements[0]!.id, canonicalSemanticIdentity: `legacy-id:${brief.requirements[0]!.id}` });
    const result = prepareRequirementIdentityMigration({ projectId, projectVersion: 1, brief, lineageCandidates: [candidate] });
    expect(result.plan.safeToApply).toBe(false);
    expect(result.plan.invalidRequirementIds).toContain(brief.requirements[0]!.id);
    expect(result.nextBrief.requirements.map((entry) => entry.statement)).toEqual(brief.requirements.map((entry) => entry.statement));
  });

  it("fails closed when Planning references a legacy ID absent from the canonical Brief", () => {
    const brief = historicalBrief();
    const planning = planningPackage(brief);
    const planningOnlyId = "REQUIREMENT:legacy-v1-planning-only";
    const planningWithOrphan = {
      ...planning,
      traceability: planning.traceability.map((entry, index) => index === 0 ? { ...entry, requirementReferences: [planningOnlyId] } : entry),
    };
    const result = prepareRequirementIdentityMigration({
      projectId,
      projectVersion: 1,
      brief,
      planningPackage: planningWithOrphan,
      lineageCandidates: [...candidates(brief), createRequirementIdentityLineage({ projectId, projectVersion: 1, fromRequirementId: planningOnlyId, canonicalSemanticIdentity: `legacy-id:${planningOnlyId}` })],
    });
    expect(result.plan.safeToApply).toBe(false);
    expect(result.plan.invalidRequirementIds).toContain(planningOnlyId);
  });

  it("keeps historical reads compatible while rejecting legacy IDs on current V3 document creation", () => {
    const brief = historicalBrief();
    const historicalDocument = BriefV3DocumentSchema.parse({ schemaVersion: 3, documentType: "brief-v3", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, brief, briefChecksum: canonicalBriefChecksum(brief) });
    expect(historicalDocument.brief.requirements[0]!.id).toMatch(/^REQUIREMENT:legacy-v1-/);
    expect(() => createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: timestamp, updatedAt: timestamp })).toThrow("BRIEF_V3_IDENTITY_INVALID");
  });

  it("changes both Brief and Planning checksum domains only after a complete one-to-one mapping", () => {
    const brief = historicalBrief();
    const planning = planningPackage(brief);
    const result = prepareRequirementIdentityMigration({ projectId, projectVersion: 1, brief, planningPackage: planning, lineageCandidates: candidates(brief), downstreamArtifactsInvalidated: ["planning-package", "architecture-review"], briefApprovalInvalidated: true, planningAcceptanceInvalidated: true });
    expect(result.plan.safeToApply).toBe(true);
    expect(result.plan.nextBriefChecksum).not.toBe(result.plan.previousBriefChecksum);
    expect(result.plan.nextPlanningSemanticChecksum).not.toBe(result.plan.previousPlanningSemanticChecksum);
    expect(result.plan.nextPlanningDocumentChecksum).not.toBe(result.plan.previousPlanningDocumentChecksum);
    expect(result.nextBrief.requirements.every((entry) => entry.id.startsWith("REQUIREMENT:v3-"))).toBe(true);
    expect(result.nextPlanningPackage?.approvedBriefChecksum).toBe(result.plan.nextBriefChecksum);
    expect(result.nextPlanningPackage?.accepted).toBe(false);
    expect(result.nextPlanningPackage?.architecture.acceptance.accepted).toBe(false);
    expect(result.nextBrief.requirements.some((entry) => entry.statement.includes("synthetic"))).toBe(true);
    expect(planningDocumentChecksum(planning)).toBe(result.plan.previousPlanningDocumentChecksum);
    expect(planningSemanticChecksum(planning)).toBe(result.plan.previousPlanningSemanticChecksum);
  });

  it("applies atomically with CAS, clears downstream checksum bindings, records immutable lineage, and replays", async () => {
    const database = new InMemoryPersistenceDatabase();
    const brief = historicalBrief();
    const planning = planningPackage(brief);
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "synthetic-identity-migration", origin: "SYNTHETIC", originalPrompt: "Synthetic identity migration.", currentVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" });
    await new ProjectRepository(database).create(project);
    await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: "AWAITING_DESIGN_SELECTION", memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(brief), selectedDesignChecksum: "a".repeat(64), architectureChecksum: "b".repeat(64), releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    const historicalDocument = BriefV3DocumentSchema.parse({ schemaVersion: 3, documentType: "brief-v3", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, brief, briefChecksum: canonicalBriefChecksum(brief) });
    const documents = new DocumentRepository(database);
    await documents.save(historicalDocument);
    await documents.save(planning);
    const service = new RequirementIdentityMigrationService(database);
    const prepared = await service.prepare({ projectId, projectVersion: 1, lineageCandidates: candidates(brief), downstreamArtifactsInvalidated: ["planning-package"], briefApprovalInvalidated: true, planningAcceptanceInvalidated: true });
    expect(prepared.plan.safeToApply).toBe(true);
    const applied = await service.apply({ plan: prepared.plan, expectedBriefRowVersion: 1, expectedPlanningRowVersion: 1, expectedProjectRowVersion: 1, expectedProjectVersionRowVersion: 1, actor: "synthetic-test", now: "2026-01-01T00:01:00.000Z" });
    expect(applied.outcome).toBe("APPLIED");
    expect(applied.project.workflow_state).toBe("AWAITING_BRIEF_APPROVAL");
    expect(applied.version.requirementsChecksum).toBe(prepared.plan.nextBriefChecksum);
    expect(applied.version.selectedDesignChecksum).toBeNull();
    expect(applied.version.architectureChecksum).toBeNull();
    const currentBrief = await documents.get(projectId, 1, "brief-v3");
    expect(currentBrief?.documentType).toBe("brief-v3");
    expect(BriefV3DocumentSchema.parse(currentBrief).brief.requirements.every((entry) => entry.id.startsWith("REQUIREMENT:v3-"))).toBe(true);
    const currentPlanning = await documents.get(projectId, 1, "planning-package");
    expect(currentPlanning?.documentType).toBe("planning-package");
    expect(currentPlanning?.documentType === "planning-package" && currentPlanning.accepted).toBe(false);
    expect(database.requirementIdentityLineage.size).toBe(brief.requirements.length);
    expect(database.requirementIdentityMigrations.size).toBe(1);
    expect(database.events).toHaveLength(1);
    expect(database.events[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(database.events[0]?.idempotencyKey).toContain("requirement-identity-migration:");
    const replay = await service.apply({ plan: prepared.plan, expectedBriefRowVersion: 1, expectedPlanningRowVersion: 1, expectedProjectRowVersion: 1, expectedProjectVersionRowVersion: 1, actor: "synthetic-test", now: "2026-01-01T00:02:00.000Z" });
    expect(replay.outcome).toBe("COMMITTED_REPLAY");
    expect(database.requirementIdentityMigrations.size).toBe(1);
    expect(database.events).toHaveLength(1);
  });
});
