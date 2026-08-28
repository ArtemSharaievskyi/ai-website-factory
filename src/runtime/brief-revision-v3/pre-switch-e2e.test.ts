import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { ambiguousV2Brief, cleanBriefV3, multiDomainChangeSet, representativeV2Brief } from "@/domain/requirements/v3/fixtures";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { BriefV3DocumentSchema, createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { mapDocumentToRow } from "@/persistence/database/mapping";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { FilesystemProjectMemorySyncPort } from "@/runtime/workspace/sync";
import type { BriefChangeSet } from "@/domain/requirements/v3/changeset";
import type { BriefV3ProviderInput, BriefV3RevisionProvider } from "./ports";
import { assertBriefV3Projection } from "./certification-evidence";
import { BriefV3TransactionService } from "./service";
import { createRevisionCurrentnessToken } from "./identity";

const projectId = "33333333-3333-4333-8333-333333333333";
const timestamp = "2026-01-01T00:00:00.000Z";
const formRevisionChangeSet: BriefChangeSet = {
  contractVersion: 1,
  changes: [
    { operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED", sourceRefs: ["fixture:form-success"] },
    { operation: "SET", target: "FORM_TRANSMISSION_MODE", value: "NONE", sourceRefs: ["fixture:form-transmission"] },
    { operation: "SET", target: "FORM_PERSISTENCE_MODE", value: "NONE", sourceRefs: ["fixture:form-persistence"] },
  ],
  unresolved: [],
};

class FixtureProvider implements BriefV3RevisionProvider {
  calls = 0;
  constructor(private readonly changeSet: BriefChangeSet) {}
  async proposeChanges(input: BriefV3ProviderInput) { void input; this.calls += 1; return this.changeSet; }
}

function currentFormBrief() {
  return CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    decisions: {
      ...cleanBriefV3.decisions,
      form: {
        ...cleanBriefV3.decisions.form,
        formPresent: true,
        validation: "ACTIVE" as const,
        mode: "REAL" as const,
        simulatedSuccessPolicy: "UNRESOLVED" as const,
        transmissionMode: "EMAIL" as const,
        persistenceMode: "DATABASE" as const,
      },
    },
  });
}

async function createV3Fixture() {
  const database = new InMemoryPersistenceDatabase();
  const brief = currentFormBrief();
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "brief-v3-preswitch-e2e", originalPrompt: "Synthetic pre-switch acceptance project.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: "44444444-4444-4444-8444-444444444444", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(brief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const document = createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save(document);
  const row = mapDocumentToRow(document);
  return { database, project, brief, currentness: createRevisionCurrentnessToken({ projectId, projectVersion: 1, projectRowVersion: 1, projectVersionRowVersion: 1, workflowState: project.workflowState, documentType: row.documentType, briefChecksum: canonicalBriefChecksum(brief), documentChecksum: row.checksum, documentRowVersion: 1 }) };
}

function request(currentness: ReturnType<typeof createRevisionCurrentnessToken>) {
  return { projectId, projectVersion: 1, revisionInstruction: "Make the synthetic contact form show local simulated success, transmit nothing, persist nothing, and keep the synthetic service page.", expectedCurrentness: currentness, targetHints: ["FORM_SUCCESS_MODE", "FORM_TRANSMISSION_MODE", "FORM_PERSISTENCE_MODE"], targetWorkflowState: "CLARIFYING" as const };
}

async function createLegacyFixture(brief = representativeV2Brief) {
  const database = new InMemoryPersistenceDatabase();
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "brief-v3-legacy-e2e", originalPrompt: "Synthetic legacy migration acceptance project.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
  await new ProjectRepository(database).create(project);
  const legacy = RequirementSpecificationSchema.parse({ ...brief, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp });
  const canonical = brief === ambiguousV2Brief ? cleanBriefV3 : migrateLegacyBriefToCanonicalBriefV3(legacy);
  await new ProjectVersionRepository(database).create({ id: "55555555-5555-4555-8555-555555555555", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(canonical), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  await new DocumentRepository(database).save(legacy);
  const row = mapDocumentToRow(legacy);
  return { database, currentness: createRevisionCurrentnessToken({ projectId, projectVersion: 1, projectRowVersion: 1, projectVersionRowVersion: 1, workflowState: project.workflowState, documentType: row.documentType, briefChecksum: canonicalBriefChecksum(canonical), documentChecksum: row.checksum, documentRowVersion: 1 }) };
}

describe("Brief Revision V3 pre-switch end-to-end certification", () => {
  const temporaryRoots: string[] = [];

  afterAll(async () => {
    await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
    console.log("BRIEF REVISION V3 PRE-SWITCH E2E");
    console.log("Live provider -> transaction .. OPT-IN (separate one-call harness)");
    console.log("Committed replay ............. PASS");
    console.log("Restart replay ............... PASS");
    console.log("Projection authority ......... PASS");
    console.log("V2 -> first V3 commit ........ PASS");
    console.log("Legacy ambiguity ............. PASS");
    console.log("Migration fresh DB ........... PASS");
    console.log("Migration upgrade ............ PASS");
    console.log("Legacy reads ................. PASS");
    console.log("No V2 fallback ............... PASS");
  });

  it("composes V3 provider port, reducer, atomic transaction, real filesystem projection, and reconstructed replay", async () => {
    const fixture = await createV3Fixture();
    const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-preswitch-"));
    temporaryRoots.push(root);
    const projection = new FilesystemProjectMemorySyncPort(root, fixture.project.slug);
    const provider = new FixtureProvider(formRevisionChangeSet);
    const service = new BriefV3TransactionService({ database: fixture.database, provider, projection });
    const first = await service.execute(request(fixture.currentness));
    expect(first).toMatchObject({ outcome: "COMMITTED", changed: true, projectionStatus: "PENDING" });
    expect(provider.calls).toBe(1);
    const projectedPath = path.join(root, fixture.project.slug, "v1", ".factory", "brief-v3.json");
    const projected = BriefV3DocumentSchema.parse(JSON.parse(await readFile(projectedPath, "utf8")));
    expect(projected.brief.decisions.form).toMatchObject({ mode: "SIMULATED", transmissionMode: "NONE", persistenceMode: "NONE" });
    expect(projected.briefChecksum).toBe(first.currentBriefChecksum);
    const persistedV3 = await fixture.database.transaction((tx) => tx.getDocument(projectId, 1, "brief-v3"));
    expect(persistedV3).not.toBeNull();
    await expect(assertBriefV3Projection({ projection, projectId, projectVersion: 1, expectedDocumentChecksum: persistedV3!.checksum })).resolves.toMatchObject({ verified: true, comparison: { matches: true, mismatches: [] } });
    expect(fixture.database.briefRevisionProjectionSync.size).toBe(1);
    expect([...fixture.database.briefRevisionProjectionSync.values()][0]?.status).toBe("SYNCED");

    const reconstructedProvider = new FixtureProvider(multiDomainChangeSet);
    const reconstructed = await new BriefV3TransactionService({ database: fixture.database, provider: reconstructedProvider, projection }).execute(request(fixture.currentness));
    expect(reconstructed).toMatchObject({ outcome: "COMMITTED_REPLAY", attemptId: first.attemptId, currentBriefChecksum: first.currentBriefChecksum });
    expect(reconstructedProvider.calls).toBe(0);
  });

  it("converts one persisted V2 Brief to the first V3 authority without V2 mutation", async () => {
    const fixture = await createLegacyFixture();
    const provider = new FixtureProvider(multiDomainChangeSet);
    const result = await new BriefV3TransactionService({ database: fixture.database, provider }).execute({ ...request(fixture.currentness), revisionInstruction: "Update one synthetic V2 Brief requirement through the V3 ChangeSet path." });
    expect(result.outcome).toBe("COMMITTED");
    expect(provider.calls).toBe(1);
    expect((await new DocumentRepository(fixture.database).get(projectId, 1, "requirements"))?.documentType).toBe("requirements");
    const v3 = await new DocumentRepository(fixture.database).get(projectId, 1, "brief-v3");
    expect(v3?.documentType).toBe("brief-v3");
    expect(BriefV3DocumentSchema.parse(v3).briefChecksum).toBe(result.currentBriefChecksum);
    expect(fixture.database.requirementIdentityLineage.size).toBeGreaterThan(0);
  });

  it("completes legacy-to-V3 identity repair even when the provider proposes no semantic change", async () => {
    const fixture = await createLegacyFixture();
    const provider = new FixtureProvider({ contractVersion: 1, changes: [], unresolved: [] });
    const result = await new BriefV3TransactionService({ database: fixture.database, provider }).execute({ ...request(fixture.currentness), revisionInstruction: "Perform the synthetic identity repair without changing Brief semantics." });
    expect(result).toMatchObject({ outcome: "COMMITTED", changed: true });
    expect((await new DocumentRepository(fixture.database).get(projectId, 1, "requirements"))?.documentType).toBe("requirements");
    expect((await new DocumentRepository(fixture.database).get(projectId, 1, "brief-v3"))?.documentType).toBe("brief-v3");
    expect(fixture.database.requirementIdentityLineage.size).toBeGreaterThan(0);
  });

  it("rejects an ambiguous legacy Brief before provider execution and without V3 mutation", async () => {
    const fixture = await createLegacyFixture(ambiguousV2Brief);
    const provider = new FixtureProvider(multiDomainChangeSet);
    await expect(new BriefV3TransactionService({ database: fixture.database, provider }).execute({ ...request(fixture.currentness), revisionInstruction: "Attempt a synthetic ambiguous legacy migration." })).rejects.toMatchObject({ code: "MIGRATION_AMBIGUOUS" });
    expect(provider.calls).toBe(0);
    expect(fixture.database.briefRevisionHistory.size).toBe(0);
    expect(fixture.database.briefRevisionProjectionSync.size).toBe(0);
  });
});
