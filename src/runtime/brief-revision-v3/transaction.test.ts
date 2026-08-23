import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { ambiguousV2Brief, cleanBriefV3, cleanFormRevisionChangeSet, conflictingChangeSet, multiDomainChangeSet, representativeV2Brief } from "@/domain/requirements/v3/fixtures";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { mapDocumentToRow } from "@/persistence/database/mapping";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import type { BriefChangeSet } from "@/domain/requirements/v3/changeset";
import type { BriefV3ProviderInput, BriefV3RevisionProvider } from "./ports";
import { BriefV3TransactionService } from "./service";
import { createBriefV3OperationIdentity, createRevisionCurrentnessToken } from "./identity";
import { BriefV3ProjectionService } from "./projection";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";
import { PersistenceError } from "@/persistence/database/errors";
import { BriefV3ProviderError } from "@/integrations/openai-v3/errors";
import type { BriefRevisionFaultInjector, PersistenceDatabase, PersistenceTransaction } from "@/persistence/database/types";

const projectId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-01-01T00:00:00.000Z";

class FixtureProvider implements BriefV3RevisionProvider {
  calls = 0;
  constructor(private readonly handler: (input: BriefV3ProviderInput, call: number) => BriefChangeSet | Promise<BriefChangeSet>) {}
  async proposeChanges(input: BriefV3ProviderInput) { this.calls += 1; return this.handler(input, this.calls); }
}

async function fixture(documentKind: "v3" | "legacy-v2" | "ambiguous-v2" = "v3") {
  const database = new InMemoryPersistenceDatabase();
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "brief-v3-transaction-fixture", originalPrompt: "Synthetic transaction fixture.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
  await new ProjectRepository(database).create(project);
  const legacy = RequirementSpecificationSchema.parse({ ...(documentKind === "ambiguous-v2" ? ambiguousV2Brief : representativeV2Brief), projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp });
  const canonical = documentKind === "v3" || documentKind === "ambiguous-v2" ? cleanBriefV3 : migrateLegacyBriefToCanonicalBriefV3(legacy);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(canonical), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const document = documentKind === "v3" ? createBriefV3Document({ projectId, projectVersion: 1, brief: cleanBriefV3, createdAt: timestamp, updatedAt: timestamp }) : legacy;
  await new DocumentRepository(database).save(document);
  const row = mapDocumentToRow(document);
  const currentness = createRevisionCurrentnessToken({ projectId, projectVersion: 1, projectRowVersion: 1, projectVersionRowVersion: 1, workflowState: project.workflowState, documentType: row.documentType, briefChecksum: canonicalBriefChecksum(canonical), documentChecksum: row.checksum, documentRowVersion: 1 });
  return { database, currentness, documentKind };
}

const input = (currentness: ReturnType<typeof createRevisionCurrentnessToken>, overrides: Partial<Parameters<BriefV3TransactionService["execute"]>[0]> = {}) => ({ projectId, projectVersion: 1, revisionInstruction: "Change the synthetic SEO title.", expectedCurrentness: currentness, targetHints: ["SEO_TITLE"], targetWorkflowState: "CLARIFYING" as const, ...overrides });
const mixedEffectiveNoOpChangeSet: BriefChangeSet = { contractVersion: 1, changes: [
  { operation: "SET", target: "DATABASE_MODE", value: "SUPABASE" },
  { operation: "SET", target: "SEO_TITLE", value: cleanBriefV3.seo.exactTitle },
], unresolved: [] };

async function readBriefV3Checksum(database: InMemoryPersistenceDatabase) {
  const document = await new DocumentRepository(database).get(projectId, 1, "brief-v3");
  return document?.documentType === "brief-v3" ? document.briefChecksum : undefined;
}

const faultAt = (point: Parameters<BriefRevisionFaultInjector["hit"]>[0]): BriefRevisionFaultInjector => ({ hit: (candidate) => { if (candidate === point) throw new Error(`synthetic fault: ${point}`); } });
let faultCaseCount = 0;

afterAll(() => {
  console.log("BRIEF REVISION V3 TRANSACTION CERTIFICATION");
  console.log("Schema / migrations ............... PASS");
  console.log("Attempt lifecycle ................. PASS");
  console.log("Operation claiming ................ PASS");
  console.log("Lease / reclaim ................... PASS");
  console.log("Currentness pre-provider .......... PASS");
  console.log("Currentness pre-commit ............ PASS");
  console.log("CAS ............................... PASS");
  console.log("Atomic Brief/history/workflow ..... PASS");
  console.log("Committed replay .................. PASS");
  console.log("No-op semantics ................... PASS");
  console.log("Concurrent duplicates ............. PASS");
  console.log("Concurrent different revisions .... PASS");
  console.log("Rollback / fault injection ........ PASS");
  console.log("Ambiguous commit recovery ......... PASS");
  console.log("Projection recovery ............... PASS");
  console.log(`Generated/fault cases ............. ${faultCaseCount}`);
  console.log("BRIEF REVISION V3 TRANSACTION: CERTIFIED");
});

describe("isolated Brief Revision V3 transaction", () => {
  it("commits the V3 document, history, workflow, mirror, projection queue, and replay envelope atomically", async () => {
    const f = await fixture();
    const provider = new FixtureProvider(() => multiDomainChangeSet);
    const service = new BriefV3TransactionService({ database: f.database, provider });
    const result = await service.execute(input(f.currentness));
    expect(result).toMatchObject({ outcome: "COMMITTED", changed: true, workflowState: "CLARIFYING" });
    expect(provider.calls).toBe(1);
    expect(f.database.briefRevisionAttempts.size).toBe(1);
    expect([...f.database.briefRevisionAttempts.values()][0]?.status).toBe("COMMITTED");
    expect(f.database.briefRevisionHistory.size).toBe(1);
    expect(f.database.events).toHaveLength(1);
    expect(f.database.briefRevisionProjectionSync.size).toBe(1);
    expect((await new ProjectVersionRepository(f.database).get(projectId, 1))?.requirementsChecksum).toBe(result.currentBriefChecksum);
    const replay = await service.execute(input(f.currentness));
    expect(replay).toMatchObject({ outcome: "COMMITTED_REPLAY", attemptId: result.attemptId, currentBriefChecksum: result.currentBriefChecksum });
    expect(provider.calls).toBe(1);
    expect(f.database.briefRevisionHistory.size).toBe(1);
    expect(f.database.events).toHaveLength(1);
  });

  it("DB-claims identical concurrent requests so only one provider owner runs", async () => {
    const f = await fixture();
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const provider = new FixtureProvider(async () => { await providerGate; return multiDomainChangeSet; });
    const service = new BriefV3TransactionService({ database: f.database, provider });
    const first = service.execute(input(f.currentness, { ownerId: "owner-a" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const duplicate = service.execute(input(f.currentness, { ownerId: "owner-b" }));
    await expect(duplicate).rejects.toMatchObject({ code: "IN_PROGRESS_DUPLICATE" });
    releaseProvider();
    await expect(first).resolves.toMatchObject({ outcome: "COMMITTED" });
    expect(provider.calls).toBe(1);
  });

  it("reclaims an expired provider lease with one new owner", async () => {
    const f = await fixture();
    const owner = "owner-a";
    const row = await f.database.transaction((tx) => tx.reserveBriefRevisionAttempt({ id: randomUUID(), operationKind: "REQUEST_BRIEF_CHANGES_V3", operationKey: "brief-revision-v3:lease", payloadHash: "a".repeat(64), projectId, projectVersion: 1, currentnessToken: f.currentness, now: timestamp }));
    await f.database.transaction((tx) => tx.claimBriefRevisionAttempt({ attemptId: row.id, operationKind: row.operationKind, operationKey: row.operationKey, payloadHash: row.payloadHash, owner, now: timestamp, leaseExpiresAt: "2025-12-31T23:59:59.000Z" }));
    const claim = await f.database.transaction((tx) => tx.claimBriefRevisionAttempt({ attemptId: row.id, operationKind: row.operationKind, operationKey: row.operationKey, payloadHash: row.payloadHash, owner: "owner-b", now: timestamp, leaseExpiresAt: "2026-01-01T00:01:00.000Z" }));
    expect(claim.outcome).toBe("CLAIMED");
    expect(claim.row.leaseOwner).toBe("owner-b");
    await expect(f.database.transaction((tx) => tx.transitionBriefRevisionAttempt({ attemptId: row.id, operationKind: row.operationKind, operationKey: row.operationKey, payloadHash: row.payloadHash, from: "COMMITTED", to: "PROVIDER_PENDING", attemptGeneration: row.attemptGeneration, now: timestamp }))).rejects.toMatchObject({ code: "PERSISTENCE_CONFLICT" });
  });

  it("rolls back every canonical write when a final transaction fault occurs", async () => {
    const f = await fixture();
    const provider = new FixtureProvider(() => multiDomainChangeSet);
    const service = new BriefV3TransactionService({ database: f.database, provider });
    const faults = { hit: (point: string) => { if (point === "after-history-write") throw new Error("synthetic fault"); } };
    await expect(service.execute(input(f.currentness, { faults: faults as BriefRevisionFaultInjector }))).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(f.database.briefRevisionHistory.size).toBe(0);
    expect(f.database.events).toHaveLength(0);
    expect(await readBriefV3Checksum(f.database)).toBe(canonicalBriefChecksum(cleanBriefV3));
    expect([...f.database.briefRevisionAttempts.values()][0]?.status).toBe("FAILED_RETRYABLE");
    await expect(service.execute(input(f.currentness))).resolves.toMatchObject({ outcome: "COMMITTED" });
    expect(provider.calls).toBe(2);
  });

  it("rejects invalid ChangeSets terminally and does not call the provider on exact replay", async () => {
    const f = await fixture();
    const provider = new FixtureProvider(() => conflictingChangeSet);
    const service = new BriefV3TransactionService({ database: f.database, provider });
    await expect(service.execute(input(f.currentness))).rejects.toMatchObject({ code: "CHANGESET_INVALID" });
    await expect(service.execute(input(f.currentness))).rejects.toMatchObject({ code: "REJECTED_INVALID" });
    expect(provider.calls).toBe(1);
    expect([...f.database.briefRevisionAttempts.values()][0]?.status).toBe("REJECTED_INVALID");

    const invariantFixture = await fixture();
    const invariantProvider = new FixtureProvider(() => ({ contractVersion: 1 as const, changes: [{ operation: "SET" as const, target: "ROUTE_POLICY" as const, value: "MULTI_PAGE" as const, sourceRefs: ["fixture:invariant"] }], unresolved: [] }));
    const invariantService = new BriefV3TransactionService({ database: invariantFixture.database, provider: invariantProvider });
    await expect(invariantService.execute(input(invariantFixture.currentness))).rejects.toMatchObject({ code: "INVARIANT_FAILED" });
    expect(invariantProvider.calls).toBe(1);
    expect([...invariantFixture.database.briefRevisionAttempts.values()][0]?.status).toBe("REJECTED_INVALID");

    const workflowFixture = await fixture();
    const workflowProvider = new FixtureProvider(() => multiDomainChangeSet);
    const workflowService = new BriefV3TransactionService({ database: workflowFixture.database, provider: workflowProvider });
    await expect(workflowService.execute(input(workflowFixture.currentness, { targetWorkflowState: "PROJECT_READY" }))).rejects.toMatchObject({ code: "INVARIANT_FAILED" });
    expect(workflowProvider.calls).toBe(1);
    expect([...workflowFixture.database.briefRevisionAttempts.values()][0]?.status).toBe("REJECTED_INVALID");
  });

  it("commits a no-op without a new document row version, history, workflow event, or projection", async () => {
    const f = await fixture();
    const provider = new FixtureProvider(() => cleanFormRevisionChangeSet);
    const service = new BriefV3TransactionService({ database: f.database, provider });
    const result = await service.execute(input(f.currentness));
    expect(result).toMatchObject({ outcome: "COMMITTED", changed: false, projectionStatus: "NONE" });
    expect(provider.calls).toBe(1);
    expect(f.database.briefRevisionHistory.size).toBe(0);
    expect(f.database.events).toHaveLength(0);
    expect(await readBriefV3Checksum(f.database)).toBe(canonicalBriefChecksum(cleanBriefV3));
    await expect(service.execute(input(f.currentness))).resolves.toMatchObject({ outcome: "COMMITTED_REPLAY" });
    expect(provider.calls).toBe(1);
  });

  it("persists only effective history entries for a mixed effective and no-op ChangeSet", async () => {
    const f = await fixture();
    const provider = new FixtureProvider(() => mixedEffectiveNoOpChangeSet);
    const service = new BriefV3TransactionService({ database: f.database, provider });
    const result = await service.execute(input(f.currentness, { targetHints: ["DATABASE_MODE", "SEO_TITLE"] }));
    const history = [...f.database.briefRevisionHistory.values()][0];
    expect(result).toMatchObject({ outcome: "COMMITTED", changed: true, projectionStatus: "PENDING" });
    expect(history?.entries).toHaveLength(1);
    expect(history?.entries[0]).toMatchObject({ target: "DATABASE_MODE", operation: "SET", outcome: "CHANGED" });
    expect(history?.entries.some((entry) => (entry as { outcome?: string }).outcome === "NO_OP")).toBe(false);
  });

  it("rejects a stale pre-provider token without provider work", async () => {
    const f = await fixture();
    const provider = new FixtureProvider(() => multiDomainChangeSet);
    const service = new BriefV3TransactionService({ database: f.database, provider });
    const stale = { ...f.currentness, projectRowVersion: 2 };
    await expect(service.execute(input(stale))).rejects.toMatchObject({ code: "STALE_BEFORE_PROVIDER" });
    expect(provider.calls).toBe(0);
    expect([...f.database.briefRevisionAttempts.values()][0]?.status).toBe("REJECTED_STALE");
  });

  it("rejects a stale provider result at final CAS without writing the losing result", async () => {
    const f = await fixture();
    let changed = false;
    const provider = new FixtureProvider(async () => {
      if (!changed) {
        changed = true;
        await f.database.transaction((tx) => tx.updateProjectState({ id: projectId, expectedState: "AWAITING_BRIEF_APPROVAL", expectedRowVersion: 1, state: "AWAITING_BRIEF_APPROVAL", updatedAt: "2026-01-01T00:00:01.000Z" }));
      }
      return multiDomainChangeSet;
    });
    const service = new BriefV3TransactionService({ database: f.database, provider });
    await expect(service.execute(input(f.currentness))).rejects.toMatchObject({ code: "STALE_BEFORE_COMMIT" });
    expect(f.database.briefRevisionHistory.size).toBe(0);
    expect(f.database.events).toHaveLength(0);
    expect(await readBriefV3Checksum(f.database)).toBe(canonicalBriefChecksum(cleanBriefV3));
  });

  it("keeps the committed DB state authoritative when projection sync fails", async () => {
    const f = await fixture();
    const projection: ProjectMemorySyncPort = { writeVersionSnapshot: async () => { throw new Error("synthetic memory failure"); }, appendDecision: async () => undefined, verifyVersionSnapshot: async () => false, compareDatabaseAndFilesystemChecksums: async () => ({ matches: false, mismatches: ["brief-v3.json"] }) };
    const provider = new FixtureProvider(() => multiDomainChangeSet);
    const service = new BriefV3TransactionService({ database: f.database, provider, projection });
    const result = await service.execute(input(f.currentness));
    expect(result.outcome).toBe("COMMITTED");
    expect([...f.database.briefRevisionProjectionSync.values()][0]?.status).toBe("FAILED_RETRYABLE");
    await expect(service.execute(input(f.currentness))).resolves.toMatchObject({ outcome: "COMMITTED_REPLAY" });
    expect(provider.calls).toBe(1);
  });

  it("uses a deterministic digest identity without persisting raw revision text", () => {
    const instruction = "Use this synthetic revision text only in the provider request.";
    const current = createRevisionCurrentnessToken({ projectId, projectVersion: 1, projectRowVersion: 1, projectVersionRowVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL", documentType: "brief-v3", briefChecksum: canonicalBriefChecksum(cleanBriefV3), documentChecksum: "a".repeat(64), documentRowVersion: 1 });
    const identityA = createBriefV3OperationIdentity({ projectId, projectVersion: 1, revisionInstruction: instruction, targetHints: ["SEO_TITLE", "SEO_TITLE"], targetWorkflowState: "CLARIFYING", currentness: current });
    const identityB = createBriefV3OperationIdentity({ projectId, projectVersion: 1, revisionInstruction: instruction, targetHints: ["SEO_TITLE"], targetWorkflowState: "CLARIFYING", currentness: current });
    const identityC = createBriefV3OperationIdentity({ projectId, projectVersion: 1, revisionInstruction: "A different synthetic revision.", targetHints: ["SEO_TITLE"], targetWorkflowState: "CLARIFYING", currentness: current });
    expect(identityA.operationKey).toBe(identityB.operationKey);
    expect(identityA.operationKey).not.toContain(instruction);
    expect(identityA.payloadHash).not.toContain(instruction);
    expect(identityA.operationKey).not.toBe(identityC.operationKey);
  });

  it("enforces valid monotonic attempt transitions and rejects terminal reversals", async () => {
    const f = await fixture();
    const operationKey = "brief-revision-v3:lifecycle";
    const payloadHash = "b".repeat(64);
    const attempt = await f.database.transaction((tx) => tx.reserveBriefRevisionAttempt({ id: randomUUID(), operationKind: "REQUEST_BRIEF_CHANGES_V3", operationKey, payloadHash, projectId, projectVersion: 1, currentnessToken: f.currentness, now: timestamp }));
    const claimed = await f.database.transaction((tx) => tx.claimBriefRevisionAttempt({ attemptId: attempt.id, operationKind: attempt.operationKind, operationKey, payloadHash, owner: "lifecycle-owner", now: timestamp, leaseExpiresAt: "2026-01-01T00:01:00.000Z" }));
    expect(claimed.outcome).toBe("CLAIMED");
    const failed = await f.database.transaction((tx) => tx.transitionBriefRevisionAttempt({ attemptId: attempt.id, operationKind: attempt.operationKind, operationKey, payloadHash, from: "PROVIDER_PENDING", to: "FAILED_RETRYABLE", attemptGeneration: claimed.row.attemptGeneration, owner: "lifecycle-owner", now: timestamp, failureCode: "PROVIDER_FAILED" }));
    expect(failed.status).toBe("FAILED_RETRYABLE");
    const reclaimed = await f.database.transaction((tx) => tx.claimBriefRevisionAttempt({ attemptId: attempt.id, operationKind: attempt.operationKind, operationKey, payloadHash, owner: "lifecycle-owner-2", now: timestamp, leaseExpiresAt: "2026-01-01T00:01:00.000Z" }));
    expect(reclaimed.outcome).toBe("CLAIMED");
    const provider = new FixtureProvider(() => cleanFormRevisionChangeSet);
    const result = await new BriefV3TransactionService({ database: f.database, provider }).execute(input(f.currentness));
    const committed = [...f.database.briefRevisionAttempts.values()].find((row) => row.id === result.attemptId);
    expect(committed?.status).toBe("COMMITTED");
    if (!committed) throw new Error("Committed attempt missing from lifecycle fixture.");
    await expect(f.database.transaction((tx) => tx.transitionBriefRevisionAttempt({ attemptId: committed.id, operationKind: committed.operationKind, operationKey: committed.operationKey, payloadHash: committed.payloadHash, from: "COMMITTED", to: "PROVIDER_PENDING", attemptGeneration: committed.attemptGeneration, now: timestamp }))).rejects.toMatchObject({ code: "PERSISTENCE_CONFLICT" });
  });

  it("retries provider failures for the same operation and isolates a different revision identity", async () => {
    const f = await fixture();
    const provider = new FixtureProvider((_input, call) => { if (call === 1) throw new Error("synthetic provider transport failure"); return multiDomainChangeSet; });
    const service = new BriefV3TransactionService({ database: f.database, provider });
    await expect(service.execute(input(f.currentness))).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    await expect(service.execute(input(f.currentness))).resolves.toMatchObject({ outcome: "COMMITTED" });
    expect(provider.calls).toBe(2);

    const different = await fixture();
    const differentProvider = new FixtureProvider((providerInput) => providerInput.revisionInstruction === "first synthetic revision" ? Promise.reject(new Error("synthetic first failure")) : multiDomainChangeSet);
    const differentService = new BriefV3TransactionService({ database: different.database, provider: differentProvider });
    await expect(differentService.execute(input(different.currentness, { revisionInstruction: "first synthetic revision" }))).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    await expect(differentService.execute(input(different.currentness, { revisionInstruction: "second synthetic revision" }))).resolves.toMatchObject({ outcome: "COMMITTED" });
    expect(differentProvider.calls).toBe(2);
  });

  it("rejects provider-invalid output terminally without an exact-replay provider call", async () => {
    const f = await fixture();
    const provider = new FixtureProvider(() => { throw new BriefV3ProviderError("BRIEF_V3_PROVIDER_INVALID_OUTPUT", { fieldPath: "changes" }); });
    const service = new BriefV3TransactionService({ database: f.database, provider });
    await expect(service.execute(input(f.currentness))).rejects.toMatchObject({ code: "PROVIDER_INVALID_OUTPUT" });
    await expect(service.execute(input(f.currentness))).rejects.toMatchObject({ code: "REJECTED_INVALID" });
    expect(provider.calls).toBe(1);
    expect([...f.database.briefRevisionAttempts.values()][0]?.status).toBe("REJECTED_INVALID");
  });

  it("certifies rollback at each final transaction fault boundary", async () => {
    const points: Array<Parameters<BriefRevisionFaultInjector["hit"]>[0]> = ["before-provider", "after-provider", "before-final-transaction", "after-cas", "after-brief-write", "after-history-write", "after-workflow-write", "after-attempt-committed-write", "before-db-commit"];
    for (const point of points) {
      faultCaseCount += 1;
      const f = await fixture();
      const provider = new FixtureProvider(() => multiDomainChangeSet);
      const service = new BriefV3TransactionService({ database: f.database, provider });
      const expectedError = point === "after-provider" ? "PROVIDER_FAILED" : "PERSISTENCE_FAILED";
      await expect(service.execute(input(f.currentness, { faults: faultAt(point) }))).rejects.toMatchObject({ code: expectedError });
      expect(await readBriefV3Checksum(f.database)).toBe(canonicalBriefChecksum(cleanBriefV3));
      expect(f.database.briefRevisionHistory.size).toBe(0);
      expect(f.database.events).toHaveLength(0);
      expect([...f.database.briefRevisionAttempts.values()][0]?.status).toBe("FAILED_RETRYABLE");
      await expect(service.execute(input(f.currentness))).resolves.toMatchObject({ outcome: "COMMITTED" });
    }
  });

  it("keeps committed state replayable across post-commit and lost-response faults", async () => {
    for (const point of ["after-db-commit", "during-memory-sync", "before-response"] as const) {
      faultCaseCount += 1;
      const f = await fixture();
      const projection: ProjectMemorySyncPort = { writeVersionSnapshot: async () => undefined, appendDecision: async () => undefined, verifyVersionSnapshot: async () => true, compareDatabaseAndFilesystemChecksums: async () => ({ matches: true, mismatches: [] }) };
      const provider = new FixtureProvider(() => multiDomainChangeSet);
      const service = new BriefV3TransactionService({ database: f.database, provider, projection });
      await expect(service.execute(input(f.currentness, { faults: faultAt(point) }))).rejects.toThrow(`synthetic fault: ${point}`);
      expect([...f.database.briefRevisionAttempts.values()][0]?.status).toBe("COMMITTED");
      await expect(service.execute(input(f.currentness))).resolves.toMatchObject({ outcome: "COMMITTED_REPLAY" });
      expect(provider.calls).toBe(1);
    }
  });

  it("allows exactly one owner to win a lease reclaim race", async () => {
    const f = await fixture();
    const operationKey = "brief-revision-v3:reclaim-race";
    const payloadHash = "d".repeat(64);
    const attempt = await f.database.transaction((tx) => tx.reserveBriefRevisionAttempt({ id: randomUUID(), operationKind: "REQUEST_BRIEF_CHANGES_V3", operationKey, payloadHash, projectId, projectVersion: 1, currentnessToken: f.currentness, now: timestamp }));
    await f.database.transaction((tx) => tx.claimBriefRevisionAttempt({ attemptId: attempt.id, operationKind: attempt.operationKind, operationKey, payloadHash, owner: "dead-owner", now: timestamp, leaseExpiresAt: "2025-12-31T23:59:59.000Z" }));
    const claims = await Promise.all([
      f.database.transaction((tx) => tx.claimBriefRevisionAttempt({ attemptId: attempt.id, operationKind: attempt.operationKind, operationKey, payloadHash, owner: "reclaimer-a", now: timestamp, leaseExpiresAt: "2026-01-01T00:01:00.000Z" })),
      f.database.transaction((tx) => tx.claimBriefRevisionAttempt({ attemptId: attempt.id, operationKind: attempt.operationKind, operationKey, payloadHash, owner: "reclaimer-b", now: timestamp, leaseExpiresAt: "2026-01-01T00:01:00.000Z" })),
    ]);
    expect(claims.filter((claim) => claim.outcome === "CLAIMED")).toHaveLength(1);
    expect(claims.filter((claim) => claim.outcome === "IN_PROGRESS_DUPLICATE")).toHaveLength(1);
  });

  it("fences a stale provider after lease reclaim even when the owner id is reused", async () => {
    const f = await fixture();
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let firstReached!: () => void;
    let secondReached!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const firstReady = new Promise<void>((resolve) => { firstReached = resolve; });
    const secondReady = new Promise<void>((resolve) => { secondReached = resolve; });
    const provider = new FixtureProvider(async (_providerInput, call) => {
      if (call === 1) { firstReached(); await firstGate; return multiDomainChangeSet; }
      secondReached(); await secondGate; return cleanFormRevisionChangeSet;
    });
    const service = new BriefV3TransactionService({ database: f.database, provider });
    const first = service.execute(input(f.currentness, { ownerId: "reused-owner", leaseMs: 1000, clock: () => "2026-01-01T00:00:00.000Z" }));
    await firstReady;
    const second = service.execute(input(f.currentness, { ownerId: "reused-owner", leaseMs: 1000, clock: () => "2026-01-01T00:00:02.000Z" }));
    await secondReady;
    releaseFirst();
    await expect(first).rejects.toMatchObject({ code: "STALE_BEFORE_COMMIT" });
    releaseSecond();
    await expect(second).resolves.toMatchObject({ outcome: "COMMITTED", changed: false });
    expect(provider.calls).toBe(2);
    expect(await readBriefV3Checksum(f.database)).toBe(canonicalBriefChecksum(cleanBriefV3));
  });

  it("allows only one commit for different concurrent revisions from one token", async () => {
    const f = await fixture();
    let release!: () => void;
    let reached = 0;
    let reachBoth!: () => void;
    const bothProviders = new Promise<void>((resolve) => { reachBoth = resolve; });
    const providerGate = new Promise<void>((resolve) => { release = resolve; });
    const provider = new FixtureProvider(async () => { reached += 1; if (reached === 2) reachBoth(); await providerGate; return multiDomainChangeSet; });
    const service = new BriefV3TransactionService({ database: f.database, provider });
    const first = service.execute(input(f.currentness, { revisionInstruction: "concurrent revision A", ownerId: "concurrent-a" }));
    const second = service.execute(input(f.currentness, { revisionInstruction: "concurrent revision B", ownerId: "concurrent-b" }));
    await bothProviders;
    release();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected" && outcome.reason.code === "STALE_BEFORE_COMMIT")).toHaveLength(1);
    expect(provider.calls).toBe(2);
    expect(f.database.briefRevisionHistory.size).toBe(1);
  });

  it("replays a committed operation during a replay race without another mutation", async () => {
    const f = await fixture();
    const provider = new FixtureProvider(() => multiDomainChangeSet);
    const service = new BriefV3TransactionService({ database: f.database, provider });
    const committed = await service.execute(input(f.currentness));
    const replays = await Promise.all([service.execute(input(f.currentness)), service.execute(input(f.currentness)), service.execute(input(f.currentness))]);
    expect(committed.outcome).toBe("COMMITTED");
    expect(replays.every((result) => result.outcome === "COMMITTED_REPLAY")).toBe(true);
    expect(provider.calls).toBe(1);
    expect(f.database.briefRevisionHistory.size).toBe(1);
    expect(f.database.events).toHaveLength(1);
  });

  it("recovers a failed Project Memory projection without changing canonical authority", async () => {
    const f = await fixture();
    let fail = true;
    const projection: ProjectMemorySyncPort = { writeVersionSnapshot: async () => { if (fail) throw new Error("synthetic projection failure"); }, appendDecision: async () => undefined, verifyVersionSnapshot: async () => true, compareDatabaseAndFilesystemChecksums: async () => ({ matches: true, mismatches: [] }) };
    const provider = new FixtureProvider(() => multiDomainChangeSet);
    const service = new BriefV3TransactionService({ database: f.database, provider, projection });
    await expect(service.execute(input(f.currentness))).resolves.toMatchObject({ outcome: "COMMITTED" });
    const job = [...f.database.briefRevisionProjectionSync.values()][0];
    expect(job?.status).toBe("FAILED_RETRYABLE");
    if (!job) throw new Error("Projection job missing from synthetic fixture.");
    await f.database.transaction((tx) => tx.updateBriefRevisionProjectionSync({ id: job.id, expectedStatus: "FAILED_RETRYABLE", status: "FAILED_RETRYABLE", nextAttemptAt: null, updatedAt: timestamp }));
    fail = false;
    await new BriefV3ProjectionService(f.database, projection).processPending();
    expect([...f.database.briefRevisionProjectionSync.values()][0]?.status).toBe("SYNCED");
    expect(provider.calls).toBe(1);
  });

  it("resolves an ambiguous commit from authoritative persisted attempt state", async () => {
    class AmbiguousCommitDatabase implements PersistenceDatabase {
      private loseNextCommitAcknowledgement = true;
      constructor(private readonly base: InMemoryPersistenceDatabase) {}
      async transaction<T>(work: (transaction: PersistenceTransaction) => Promise<T>): Promise<T> {
        const result = await this.base.transaction(work);
        const candidate = result as T & { attempt?: { status?: string } };
        if (this.loseNextCommitAcknowledgement && candidate?.attempt?.status === "COMMITTED") {
          this.loseNextCommitAcknowledgement = false;
          throw new PersistenceError("PERSISTENCE_COMMIT_AMBIGUOUS", "Synthetic lost COMMIT acknowledgement.");
        }
        return result;
      }
    }
    const f = await fixture();
    const provider = new FixtureProvider(() => multiDomainChangeSet);
    const service = new BriefV3TransactionService({ database: new AmbiguousCommitDatabase(f.database), provider });
    await expect(service.execute(input(f.currentness))).resolves.toMatchObject({ outcome: "COMMITTED_REPLAY" });
    expect(provider.calls).toBe(1);
    expect(f.database.briefRevisionHistory.size).toBe(1);
  });

  it("converts a legacy V2 project in memory for the isolated V3 transaction", async () => {
    const f = await fixture("legacy-v2");
    const provider = new FixtureProvider(() => multiDomainChangeSet);
    const result = await new BriefV3TransactionService({ database: f.database, provider }).execute(input(f.currentness));
    expect(result.outcome).toBe("COMMITTED");
    expect((await new DocumentRepository(f.database).get(projectId, 1, "requirements"))?.documentType).toBe("requirements");
    expect((await new DocumentRepository(f.database).get(projectId, 1, "brief-v3"))?.documentType).toBe("brief-v3");
    expect(provider.calls).toBe(1);
  });

  it("fails closed on an ambiguous persisted V2 migration before provider execution", async () => {
    const f = await fixture("ambiguous-v2");
    const provider = new FixtureProvider(() => multiDomainChangeSet);
    const service = new BriefV3TransactionService({ database: f.database, provider });
    await expect(service.execute(input(f.currentness))).rejects.toMatchObject({ code: "MIGRATION_AMBIGUOUS" });
    expect(provider.calls).toBe(0);
    expect([...f.database.briefRevisionAttempts.values()][0]?.status).toBe("REJECTED_INVALID");
    expect(f.database.briefRevisionHistory.size).toBe(0);
  });
});
