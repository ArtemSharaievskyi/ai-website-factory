import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPlanningPackage } from "./deterministic";
import { FakePlannerMemoryPort } from "./memory";
import { PlannerArchitectService } from "./service";
import type { PlannerAgentInput } from "./contracts";
import type { PlannerArchitectureProvider } from "./ports";
import { representativeV1Brief, cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";

const timestamp = "2026-01-01T00:00:00.000Z";
const serviceScope = [
  "Transport von M\u00f6beln",
  "Abholung und Lieferung",
  "Hilfe beim Be- und Entladen",
  "auf Wunsch Auf- und Abbau von M\u00f6beln",
] as const;

function pilotBrief(withPlanningBlocker = false) {
  return CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    requirements: [
      ...cleanBriefV3.requirements,
      ...serviceScope.map((statement, index) => ({ id: `REQUIREMENT:moebeltransport-${index}`, category: "FEATURE" as const, statement, sourceRefs: [`fixture:moebeltransport:${index}`] })),
    ],
    unresolved: [
      { target: "FINAL_LEGAL_FACTS_REQUIRED", reason: "Final legal facts are required before publication.", sourceRefs: ["fixture:legal"], blockingStages: ["PUBLICATION"] },
      { target: "PHOTO_RIGHTS_PROVENANCE_REQUIRED", reason: "Photo rights provenance is required before asset publication.", sourceRefs: ["fixture:photo"], blockingStages: ["ASSET_REVIEW", "PUBLICATION"] },
      ...(withPlanningBlocker ? [{ target: "REQUIREMENT:planning-choice", reason: "Choose the approved service workflow.", sourceRefs: ["fixture:planning"], blockingStages: ["PLANNING"] }] : []),
    ],
  });
}

async function seed(brief = pilotBrief()) {
  const database = new InMemoryPersistenceDatabase();
  const projectId = randomUUID();
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "synthetic-planner-boundary", originalPrompt: "Synthetic planning boundary fixture.", currentVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" });
  await new ProjectRepository(database).create(project);
  const briefChecksum = canonicalBriefChecksum(brief);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: "AWAITING_DESIGN_SELECTION", memoryRootPath: null, requirementsChecksum: briefChecksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const document = createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save(BriefV3DocumentSchema.parse({ ...document, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: document.briefChecksum } }));
  const approvedBrief = RequirementSpecificationSchema.parse({ ...representativeV1Brief, projectId, projectVersion: 1 });
  const input: PlannerAgentInput = { projectId, projectVersion: 1, approvedBrief, canonicalBrief: brief, approvedBriefChecksum: briefChecksum, originalPromptReference: "synthetic-prompt", clarificationEvidenceReferences: ["synthetic-clarification"], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: randomUUID(), expectedRowVersion: 1 };
  return { database, projectId, brief, input };
}

function countingProvider(calls: { count: number }): PlannerArchitectureProvider {
  return { async plan(input) { calls.count += 1; return buildPlanningPackage(input); } };
}

describe("production-shaped Planner canonical boundary", () => {
  it("reaches the fake provider only for deferred unresolved items and preserves Möbeltransport plus no-backend semantics", async () => {
    const fixture = await seed();
    const calls = { count: 0 };
    const result = await new PlannerArchitectService({ database: fixture.database, memory: new FakePlannerMemoryPort(), provider: countingProvider(calls) }).planApprovedProject(fixture.input);

    expect(calls.count).toBe(1);
    expect(result.productScope.inScopeCapabilities).toEqual(expect.arrayContaining([...serviceScope]));
    expect(result.architecture.backendPriority).toEqual([]);
    expect(result.architecture.serverActions).toEqual([]);
    expect(result.architecture.routeHandlers).toEqual([]);
    expect(result.supabase.postgres).toBe(false);
    expect(result.supabase.auth).toBe(false);
    expect(result.supabase.environmentVariables).toEqual([]);
    expect(result.forms.forms[0]?.submissionMechanism).toBe("client-only");
    expect(result.dataModel.entities).toEqual([]);
    expect(fixture.input.canonicalBrief?.unresolved.map((item) => item.blockingStages)).toEqual([["PUBLICATION"], ["ASSET_REVIEW", "PUBLICATION"]]);
  });

  it("rejects a genuine Planning blocker before the provider boundary", async () => {
    const fixture = await seed(pilotBrief(true));
    const calls = { count: 0 };
    const service = new PlannerArchitectService({ database: fixture.database, memory: new FakePlannerMemoryPort(), provider: countingProvider(calls) });

    await expect(service.planApprovedProject(fixture.input)).rejects.toMatchObject({ code: "BLOCKING_CLARIFICATIONS_REMAIN" });
    expect(calls.count).toBe(0);
    expect(fixture.database.documents.size).toBe(1);
  });

  it("rejects a canonical currentness change between preflight and provider spend", async () => {
    const fixture = await seed();
    const documents = new DocumentRepository(fixture.database);
    const changedBrief = CanonicalBriefV3Schema.parse({ ...fixture.brief, summary: "Synthetic concurrent Brief update." });
    const changed = createBriefV3Document({ projectId: fixture.projectId, projectVersion: 1, brief: changedBrief, createdAt: timestamp, updatedAt: timestamp });
    // The pre-provider recheck is exercised through the host's skill/context hook.
    const calls = { count: 0 };
    const service = new PlannerArchitectService({ database: fixture.database, memory: new FakePlannerMemoryPort(), provider: countingProvider(calls), resolveSkills: async () => { await documents.save(BriefV3DocumentSchema.parse({ ...changed, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: changed.briefChecksum } })); return { contexts: [], identityChecksum: "none", selectedSkillIds: [], selectedSkillChecksums: [] }; } });
    await expect(service.planApprovedProject(fixture.input)).rejects.toMatchObject({ code: "BRIEF_CHECKSUM_MISMATCH" });
    expect(calls.count).toBe(0);
    expect(checksumPersistedDocument(changedBrief)).toHaveLength(64);
  });
});
