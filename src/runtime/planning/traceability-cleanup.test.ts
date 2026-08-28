import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPlanningPackage, planningSemanticChecksum } from "@/agents/planner/deterministic";
import { PlannerAgentInputSchema, PlanningPackageSchema, type PlanningPackage } from "@/agents/planner/contracts";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { BriefV3DocumentSchema, createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { FakeProjectMemorySyncPort } from "@/persistence/database/sync";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  ORPHAN_PLANNING_REFERENCE_IDS,
  PLANNING_TRACEABILITY_CLEANUP_AUTHORIZATION,
  PlanningTraceabilityCleanupService,
  preparePlanningTraceabilityCleanup,
} from "./traceability-cleanup";

const projectId = representativeV1Brief.projectId;
const timestamp = "2026-01-01T00:00:00.000Z";

function plannerInput() {
  return PlannerAgentInputSchema.parse({
    projectId,
    projectVersion: 1,
    approvedBrief: representativeV1Brief,
    canonicalBrief: cleanBriefV3,
    approvedBriefChecksum: canonicalBriefChecksum(cleanBriefV3),
    originalPromptReference: "synthetic-prompt",
    clarificationEvidenceReferences: [],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: "synthetic-planning-cleanup",
    expectedRowVersion: 1,
  });
}

function planningWithOrphans(): PlanningPackage {
  const planning = buildPlanningPackage(plannerInput());
  return PlanningPackageSchema.parse({
    ...planning,
    authentication: {
      ...planning.authentication,
      traceability: planning.authentication.traceability.map((entry, index) => index === 0
        ? { ...entry, requirementReferences: [...entry.requirementReferences, ORPHAN_PLANNING_REFERENCE_IDS[0]] }
        : entry),
    },
    supabase: {
      ...planning.supabase,
      traceability: planning.supabase.traceability.map((entry, index) => index === 0
        ? { ...entry, requirementReferences: [...entry.requirementReferences, ORPHAN_PLANNING_REFERENCE_IDS[1]] }
        : entry),
    },
    storage: {
      ...planning.storage,
      traceability: planning.storage.traceability.map((entry, index) => index === 0
        ? { ...entry, requirementReferences: [...entry.requirementReferences, ORPHAN_PLANNING_REFERENCE_IDS[1]] }
        : entry),
    },
    security: {
      ...planning.security,
      controls: planning.security.controls.map((control, index) => index === 0
        ? { ...control, requirementReferences: [...control.requirementReferences, ORPHAN_PLANNING_REFERENCE_IDS[1]] }
        : control),
    },
    traceability: planning.traceability.map((entry, index) => {
      if (index === 0) return { ...entry, requirementReferences: [...entry.requirementReferences, ORPHAN_PLANNING_REFERENCE_IDS[0]] };
      if (index === 1) return { ...entry, requirementReferences: [...entry.requirementReferences, ORPHAN_PLANNING_REFERENCE_IDS[1]] };
      return entry;
    }),
    databaseRecommendation: planning.databaseRecommendation
      ? { ...planning.databaseRecommendation, selectedMode: "NONE" as const, requirementReferences: [...planning.databaseRecommendation.requirementReferences, ORPHAN_PLANNING_REFERENCE_IDS[1]] }
      : planning.databaseRecommendation,
  });
}

function approvedBrief() {
  const document = createBriefV3Document({ projectId, projectVersion: 1, brief: cleanBriefV3, createdAt: timestamp, updatedAt: timestamp });
  return BriefV3DocumentSchema.parse({
    ...document,
    approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: document.briefChecksum },
  });
}

async function fixture() {
  const database = new InMemoryPersistenceDatabase();
  const project = FactoryProjectSchema.parse({
    schemaVersion: 1,
    documentType: "factory-project",
    projectId,
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    id: projectId,
    slug: "synthetic-planning-cleanup",
    origin: "SYNTHETIC",
    originalPrompt: "Synthetic planning cleanup fixture.",
    currentVersion: 1,
    workflowState: "AWAITING_DESIGN_SELECTION",
  });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({
    id: randomUUID(),
    projectId,
    versionNumber: 1,
    state: "AWAITING_DESIGN_SELECTION",
    memoryRootPath: null,
    requirementsChecksum: canonicalBriefChecksum(cleanBriefV3),
    selectedDesignChecksum: null,
    architectureChecksum: null,
    releasedAt: null,
    immutable: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    rowVersion: 1,
  });
  const brief = approvedBrief();
  const planning = planningWithOrphans();
  const documents = new DocumentRepository(database);
  await documents.save(brief);
  await documents.save(planning);
  return { database, brief, planning };
}

const input = {
  authorization: PLANNING_TRACEABILITY_CLEANUP_AUTHORIZATION,
  projectId,
  projectVersion: 1,
  expectedWorkflowState: "AWAITING_DESIGN_SELECTION" as const,
};

describe("host-owned Planning traceability cleanup", () => {
  it("prepares an exact seven-reference removal without identity mapping or semantic field drift", () => {
    const planning = planningWithOrphans();
    const plan = preparePlanningTraceabilityCleanup({
      projectId,
      projectVersion: 1,
      expectedWorkflowState: "AWAITING_DESIGN_SELECTION",
      projectRowVersion: 1,
      projectVersionRowVersion: 1,
      planningRowVersion: 1,
      canonicalBriefChecksum: canonicalBriefChecksum(cleanBriefV3),
      planningRowChecksum: checksumPersistedDocument(planning),
      briefDocument: approvedBrief(),
      planningPackage: planning,
    });
    expect(plan.plan.removedReferenceCount).toBe(7);
    expect(plan.plan.removedReferenceCounts).toEqual({
      "REQUIREMENT:legacy-v1-decisions-auth": 2,
      "REQUIREMENT:legacy-v1-decisions-database": 5,
    });
    expect(plan.next.authentication.decision).toBe("none");
    expect(plan.next.databaseRecommendation?.selectedMode).toBe("NONE");
    expect(plan.next.accepted).toBe(false);
    expect(plan.next.architecture.acceptance.accepted).toBe(false);
    expect(planningSemanticChecksum(plan.next)).not.toBe(planningSemanticChecksum(planning));
    expect(JSON.stringify(plan.next)).not.toContain("legacy-v1-decisions-auth");
    expect(JSON.stringify(plan.next)).not.toContain("legacy-v1-decisions-database");
  });

  it("commits through CAS and idempotency, records historical evidence, and reconciles only the derived Planning projection", async () => {
    const fixtureValue = await fixture();
    const projection = new FakeProjectMemorySyncPort();
    const service = new PlanningTraceabilityCleanupService({ database: fixtureValue.database, projection, clock: () => "2026-01-01T00:01:00.000Z" });
    const plan = await service.prepare(input);
    const result = await service.execute({ ...input, expectedPlan: plan });
    expect(result).toMatchObject({ outcome: "COMMITTED", changed: true, removedReferenceCount: 7, projectionStatus: "SYNCED" });
    expect(result.nextPlanningRowVersion).toBe(2);

    const currentPlanning = await new DocumentRepository(fixtureValue.database).get(projectId, 1, "planning-package");
    expect(currentPlanning?.documentType).toBe("planning-package");
    expect(JSON.stringify(currentPlanning)).not.toContain("legacy-v1-decisions-auth");
    expect(JSON.stringify(currentPlanning)).not.toContain("legacy-v1-decisions-database");
    const currentProject = await new ProjectRepository(fixtureValue.database).getWithVersion(projectId);
    expect(currentProject?.rowVersion).toBe(1);
    expect(currentProject?.project.workflowState).toBe("AWAITING_DESIGN_SELECTION");
    expect((await new ProjectVersionRepository(fixtureValue.database).get(projectId, 1))?.rowVersion).toBe(1);

    const decisions = await fixtureValue.database.transaction((tx) => tx.listDecisions(projectId, 1));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ category: "planning-traceability-cleanup", requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required", affectedDocuments: ["planning-package.json"] });
    expect(decisions[0]?.rationale).toContain(`previousPlanningDocumentChecksum=${result.previousPlanningDocumentChecksum}`);
    expect(projection.decisions.get(`${projectId}:1`)).toHaveLength(1);

    const replay = await service.execute(input);
    expect(replay).toMatchObject({ outcome: "COMMITTED_REPLAY", nextPlanningRowVersion: 2, decisionId: result.decisionId });
    expect((await fixtureValue.database.transaction((tx) => tx.listDecisions(projectId, 1)))).toHaveLength(1);
  });
});
