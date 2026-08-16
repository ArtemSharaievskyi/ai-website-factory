import { describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { representativeV2Brief } from "@/domain/requirements/v3/fixtures";
import { invokeLegacyBriefRevisionProvider, mergeRevisionRequirements } from "@/agents/lead/service";
import { OpenAiLeadProvider } from "@/integrations/openai/adapters";
import type { BriefRevisionProviderInput } from "@/agents/lead/ports";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { readV2TripwireSnapshot, resetV2Tripwires } from "./v2-tripwire";
import { briefRevisionOperationKey } from "@/runtime/trial-entry/idempotency";

const projectId = "77777777-7777-4777-8777-777777777777";
const timestamp = "2026-08-16T00:00:00.000Z";

describe("real legacy V2 mutation tripwires", () => {
  it("increments only when the actual V2 provider and merge seams run", async () => {
    resetV2Tripwires();
    const existing = RequirementSpecificationSchema.parse({ ...representativeV2Brief, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp });
    const candidate = RequirementSpecificationSchema.parse({ ...existing, seoMetadata: { ...existing.seoMetadata, exactTitle: "Synthetic V2 title" } });
    mergeRevisionRequirements(existing, candidate, "Update the synthetic title.");
    const provider = new OpenAiLeadProvider({} as never);
    await expect(invokeLegacyBriefRevisionProvider(provider, {} as BriefRevisionProviderInput)).rejects.toBeDefined();
    const snapshot = readV2TripwireSnapshot();
    expect(snapshot.mergeCalls).toBe(1);
    expect(snapshot.providerMutationCalls).toBe(1);
    expect(snapshot.revisionPersistenceCalls).toBe(0);
    expect(snapshot.idempotencyMutationCalls).toBe(0);
    expect(snapshot.loadedLegacyMutationModules).toContain("src/agents/lead/service.ts");
  });

  it("increments persistence and idempotency counters at the legacy requirements save seam", async () => {
    resetV2Tripwires();
    const database = new InMemoryPersistenceDatabase();
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "brief-v3-v2-tripwire", originalPrompt: "Synthetic V2 tripwire fixture.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
    await new ProjectRepository(database).create(project);
    await new ProjectVersionRepository(database).create({ id: "66666666-6666-4666-8666-666666666666", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, updatedAt: timestamp, createdAt: timestamp, immutable: false, rowVersion: 1 });
    const legacy = RequirementSpecificationSchema.parse({ ...representativeV2Brief, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp });
    await new DocumentRepository(database).save(legacy, "synthetic-v2-idempotency");
    briefRevisionOperationKey({ projectId, projectVersion: 1, briefChecksum: "a".repeat(64), expectedRowVersion: 1, reason: "Synthetic V2 idempotency seam.", requirementKeys: ["project-brief"] });
    const snapshot = readV2TripwireSnapshot();
    expect(snapshot.revisionPersistenceCalls).toBe(1);
    expect(snapshot.idempotencyMutationCalls).toBe(1);
    expect(snapshot.loadedLegacyMutationModules).toContain("src/runtime/trial-entry/idempotency.ts");
  });
});
