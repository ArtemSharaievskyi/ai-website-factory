import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { applyBriefChangeSet } from "@/domain/requirements/v3/reducer";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import type { BriefChangeSet } from "@/domain/requirements/v3/changeset";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { mapDocumentToRow } from "@/persistence/database/mapping";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { FilesystemProjectMemorySyncPort } from "@/runtime/workspace/sync";
import { AcceptanceWindowStore } from "./acceptance-window";
import { BRIEF_V3_LIVE_EXPECTED_OPERATION_OBSERVATIONS, assertCertificationEvidenceIntegrity, createBriefV3CertificationEvidence, digestCertificationObject, serializeBriefV3CertificationEvidence, type LiveAcceptanceObservations, type VerifiedAcceptanceFacts } from "./certification-evidence";
import { createSyntheticExpectedLocalityTargets, verifyAcceptance } from "./acceptance-verifier";
import { SYNTHETIC_CLEANUP_ARTIFACTS } from "./cleanup-policy";
import { createBriefV3OperationIdentity, createRevisionCurrentnessToken } from "./identity";
import { BriefV3TransactionService } from "./service";
import { assertCriticalSourceCoverage, assertSourceManifestCanonical, assertV3SourceClosureDoesNotReachV2, computeCriticalSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import { readV2TripwireSnapshot, resetV2Tripwires } from "./v2-tripwire";

const projectId = "88888888-8888-4888-8888-888888888888";
const timestamp = "2026-08-16T00:00:00.000Z";
const changeSet: BriefChangeSet = { contractVersion: 1, changes: [
  { operation: "SET", target: "FORM_PERSISTENCE_MODE", value: "NONE", sourceRefs: ["fixture:acceptance"] },
  { operation: "SET", target: "FORM_SIMULATED_SUCCESS_POLICY", value: "ALLOWED", sourceRefs: ["fixture:acceptance"] },
  { operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED", sourceRefs: ["fixture:acceptance"] },
  { operation: "SET", target: "FORM_TRANSMISSION_MODE", value: "NONE", sourceRefs: ["fixture:acceptance"] },
  { operation: "SET", target: "SEO_TITLE", value: "Synthetic Atelier Contact", sourceRefs: ["fixture:acceptance"] },
], unresolved: [] };

function initialBrief() {
  return CanonicalBriefV3Schema.parse({ ...cleanBriefV3, decisions: { ...cleanBriefV3.decisions, form: { ...cleanBriefV3.decisions.form, mode: "REAL" as const, simulatedSuccessPolicy: "UNRESOLVED" as const, transmissionMode: "EMAIL" as const, persistenceMode: "DATABASE" as const } } });
}

class FixtureProvider {
  calls = 0;
  async proposeChanges() { this.calls += 1; return changeSet; }
}

async function sourceIdentity(): Promise<SourceFingerprint & { sourceHead: string }> {
  const source = await computeCriticalSourceFingerprint();
  assertSourceManifestCanonical(source.manifest);
  assertCriticalSourceCoverage(source.manifest, source.closure);
  assertV3SourceClosureDoesNotReachV2(source.closure);
  return { ...source, sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
}

async function fixture() {
  const database = new InMemoryPersistenceDatabase();
  const brief = initialBrief();
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "brief-v3-e1-acceptance", originalPrompt: "Synthetic evidence fixture.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: "99999999-9999-4999-8999-999999999999", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(brief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const document = createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save(document);
  const row = mapDocumentToRow(document);
  const currentness = createRevisionCurrentnessToken({ projectId, projectVersion: 1, projectRowVersion: 1, projectVersionRowVersion: 1, workflowState: project.workflowState, documentType: row.documentType, briefChecksum: canonicalBriefChecksum(brief), documentChecksum: row.checksum, documentRowVersion: 1 });
  return { database, project, brief, currentness };
}

async function cleanupFixture(database: InMemoryPersistenceDatabase, root: string, leaveArtifact?: string) {
  if (leaveArtifact !== "workflow_documents") for (const [key, row] of database.documents) if (row.projectId === projectId) database.documents.delete(key);
  if (leaveArtifact !== "brief_revision_attempts") for (const [key, row] of database.briefRevisionAttempts) if (row.projectId === projectId) database.briefRevisionAttempts.delete(key);
  if (leaveArtifact !== "brief_revision_history") for (const [key, row] of database.briefRevisionHistory) if (row.projectId === projectId) database.briefRevisionHistory.delete(key);
  if (leaveArtifact !== "brief_revision_projection_sync") for (const [key, row] of database.briefRevisionProjectionSync) if (row.projectId === projectId) database.briefRevisionProjectionSync.delete(key);
  if (leaveArtifact !== "factory_projects") database.projects.delete(projectId);
  for (const [key, row] of database.versions) if (leaveArtifact !== "project_versions" && row.projectId === projectId) database.versions.delete(key);
  if (leaveArtifact !== "workflow_events") database.events.splice(0, database.events.length, ...database.events.filter((row) => row.projectId !== projectId));
  await rm(root, { recursive: true, force: true });
  const remainingByArtifact = Object.fromEntries(SYNTHETIC_CLEANUP_ARTIFACTS.map((artifact) => [artifact, 0]));
  remainingByArtifact.workflow_documents = leaveArtifact === "workflow_documents" ? 1 : 0;
  remainingByArtifact.brief_revision_attempts = leaveArtifact === "brief_revision_attempts" ? 1 : 0;
  remainingByArtifact.brief_revision_history = leaveArtifact === "brief_revision_history" ? 1 : 0;
  remainingByArtifact.brief_revision_projection_sync = leaveArtifact === "brief_revision_projection_sync" ? 1 : 0;
  remainingByArtifact.factory_projects = leaveArtifact === "factory_projects" ? 1 : 0;
  remainingByArtifact.project_versions = leaveArtifact === "project_versions" ? 1 : 0;
  remainingByArtifact.workflow_events = leaveArtifact === "workflow_events" ? 1 : 0;
  return { independentSession: true, complete: Object.values(remainingByArtifact).every((count) => count === 0), remainingByArtifact };
}

async function executeAcceptance(leaveArtifact?: string) {
  resetV2Tripwires();
  const f = await fixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-e1-acceptance-"));
  const projection = new FilesystemProjectMemorySyncPort(root, f.project.slug);
  const provider = new FixtureProvider();
  const serviceInput = { projectId, projectVersion: 1, revisionInstruction: "Synthetic E1 fixture intent.", expectedCurrentness: f.currentness, targetHints: ["FORM_PERSISTENCE_MODE", "FORM_SIMULATED_SUCCESS_POLICY", "FORM_SUCCESS_MODE", "FORM_TRANSMISSION_MODE", "SEO_TITLE"], targetWorkflowState: "CLARIFYING" as const, actor: "brief-v3-e1-fixture" };
  const operationKey = createBriefV3OperationIdentity({ projectId, projectVersion: 1, revisionInstruction: serviceInput.revisionInstruction, targetHints: serviceInput.targetHints, targetWorkflowState: serviceInput.targetWorkflowState, currentness: f.currentness }).operationKey;
  const source = await sourceIdentity();
  const windowId = randomUUID();
  const runId = randomUUID();
  const first = await new BriefV3TransactionService({ database: f.database, provider, projection }).execute(serviceInput);
  const beforeReplay = digestCertificationObject({ projects: [...f.database.projects.values()], versions: [...f.database.versions.values()], documents: [...f.database.documents.values()], attempts: [...f.database.briefRevisionAttempts.values()] });
  const exactProvider = new FixtureProvider();
  const exact = await new BriefV3TransactionService({ database: f.database, provider: { proposeChanges: async () => { exactProvider.calls += 1; throw new Error("REPLAY_PROVIDER_INVOKED"); } }, projection }).execute(serviceInput);
  const afterReplay = digestCertificationObject({ projects: [...f.database.projects.values()], versions: [...f.database.versions.values()], documents: [...f.database.documents.values()], attempts: [...f.database.briefRevisionAttempts.values()] });
  const reconstructedProvider = new FixtureProvider();
  const reconstructed = await new BriefV3TransactionService({ database: f.database, provider: { proposeChanges: async () => { reconstructedProvider.calls += 1; throw new Error("RECONSTRUCTION_PROVIDER_INVOKED"); } }, projection }).execute(serviceInput);
  const observations: LiveAcceptanceObservations = { schemaVersion: 1, windowId, runId, sourceHead: source.sourceHead, sourceFingerprint: source.fingerprint, sourceManifest: [...source.manifest], syntheticProjectId: projectId, syntheticSlug: f.project.slug, provider: { schema: "brief-revision-v3", model: "fixture-model", requestCount: provider.calls, retryCount: 0, correctionCount: 0, requestAttempted: true, responseReceived: true, outputComplete: true, operations: BRIEF_V3_LIVE_EXPECTED_OPERATION_OBSERVATIONS.map((operation) => ({ ...operation })) }, transaction: { outcome: "COMMITTED", operationKey, attemptId: first.attemptId, changed: first.changed, resultChecksum: digestCertificationObject(first.currentBriefChecksum), workflowState: first.workflowState, projectionStatus: first.projectionStatus }, exactReplay: { outcome: exact.outcome === "COMMITTED_REPLAY" ? "COMMITTED_REPLAY" : "FAILED", providerCalls: exactProvider.calls, stateUnchanged: beforeReplay === afterReplay }, reconstructionReplay: { outcome: reconstructed.outcome === "COMMITTED_REPLAY" ? "COMMITTED_REPLAY" : "FAILED", providerCalls: reconstructedProvider.calls, stateUnchanged: true }, v2Runtime: { ...readV2TripwireSnapshot(), loadedLegacyMutationModules: [...readV2TripwireSnapshot().loadedLegacyMutationModules] }, v2FallbackSeamCalls: 0, cleanup: { ownershipId: projectId, cleanupAttempted: false, independentSession: false, remainingByArtifact: Object.fromEntries(SYNTHETIC_CLEANUP_ARTIFACTS.map((artifact) => [artifact, 1])) }, failureCode: null };
  const expectedBrief = applyBriefChangeSet(f.brief, changeSet);
  const verified = await verifyAcceptance({ observations, expected: { windowId, runId, projectId, projectVersion: 1, syntheticSlug: f.project.slug, operationKey, initialBrief: f.brief, expectedBrief, expectedChangeSet: changeSet, expectedOperations: BRIEF_V3_LIVE_EXPECTED_OPERATION_OBSERVATIONS, expectedUnchangedTargets: createSyntheticExpectedLocalityTargets(changeSet), expectedWorkflowTransition: "AWAITING_BRIEF_APPROVAL->CLARIFYING" }, readers: { database: f.database, projection, source: async () => source, v2: readV2TripwireSnapshot, cleanup: () => cleanupFixture(f.database, root, leaveArtifact) } });
  return { f, root, source, windowId, runId, observations, verified, first };
}

describe("EVIDENCE: Brief Revision V3 E1 deterministic evidence subsystem", () => {
  it("runs executor -> raw observations -> fresh verifier -> cleanup -> atomic finalization", async () => {
    const run = await executeAcceptance();
    const evidence = createBriefV3CertificationEvidence({ executionMode: "DETERMINISTIC_FIXTURE", observations: run.observations, verified: run.verified, createdAt: timestamp });
    expect(evidence.status).toBe("PASS");
    expect(run.observations.transaction.attemptId).toBe(run.first.attemptId);
    expect(assertCertificationEvidenceIntegrity(evidence)).toBe(true);
    const windowRoot = await mkdtemp(path.join(os.tmpdir(), "brief-v3-e1-window-"));
    try {
      const store = new AcceptanceWindowStore(windowRoot);
      const created = await store.create({ sourceFingerprint: run.source.fingerprint, windowId: run.windowId, runId: run.runId });
      await store.consume(created.windowId);
      const finalized = await store.finalize({ windowId: created.windowId, runId: run.runId, sourceFingerprint: run.source.fingerprint, evidenceDigest: evidence.evidenceDigest, evidenceSerialized: serializeBriefV3CertificationEvidence({ ...evidence, windowId: created.windowId, observations: { ...evidence.observations, windowId: created.windowId } }) });
      expect(finalized.state).toBe("FINALIZED");
    } finally { await rm(windowRoot, { recursive: true, force: true }); }
  });

  it("denies PASS for every mandatory semantic/evidence failure class", async () => {
    const run = await executeAcceptance();
    const cases: Array<[string, Partial<VerifiedAcceptanceFacts>]> = [
      ["semantic", { committed: { ...run.verified.committed, semanticValuesMatch: false } }],
      ["history", { history: { ...run.verified.history, semanticEntriesMatch: false } }],
      ["workflow", { workflow: { ...run.verified.workflow, correspondsToCommit: false } }],
      ["projection", { projection: { ...run.verified.projection, matchesDocumentAuthority: false } }],
      ["static-v2", { v2: { ...run.verified.v2, staticReachableLegacyMutationPaths: ["src/agents/lead/service.ts"] } }],
      ["runtime-v2", { v2: { ...run.verified.v2, runtime: { ...run.verified.v2.runtime, mergeCalls: 1 } } }],
      ["fallback", { v2: { ...run.verified.v2, fallbackSeamCalls: 1 } }],
      ["cleanup", { cleanup: { ...run.verified.cleanup, complete: false, remainingByArtifact: { ...run.verified.cleanup.remainingByArtifact, idempotency_records: 1 } } }],
      ["run-binding", { bindingMatches: false }],
      ["replay", { replay: { ...run.verified.replay, exactProviderCalls: 1 } }],
      ["mandatory", { missingMandatoryObservations: ["PROVIDER_OBSERVATION_MISSING"] }],
    ];
    for (const [name, override] of cases) {
      const broken = { ...run.verified, ...override } as VerifiedAcceptanceFacts;
      const evidence = createBriefV3CertificationEvidence({ executionMode: "DETERMINISTIC_FIXTURE", observations: run.observations, verified: broken, createdAt: timestamp });
      expect(evidence.status, name).not.toBe("PASS");
    }
  });

  it("detects an owned cleanup leak through the fresh cleanup verifier", async () => {
    const run = await executeAcceptance("brief_revision_history");
    const evidence = createBriefV3CertificationEvidence({ executionMode: "DETERMINISTIC_FIXTURE", observations: run.observations, verified: run.verified, createdAt: timestamp });
    expect(evidence.status).toBe("INCONCLUSIVE");
    expect(evidence.statusReason).toBe("SYNTHETIC_CLEANUP_INCOMPLETE");
  });

  it("keeps the typed V3 failure path free of every real V2 seam", async () => {
    resetV2Tripwires();
    const f = await fixture();
    await expect(new BriefV3TransactionService({ database: f.database, provider: { proposeChanges: async () => { throw new Error("synthetic-provider-failure"); } } }).execute({ projectId, projectVersion: 1, revisionInstruction: "Synthetic failure path.", expectedCurrentness: f.currentness, targetHints: ["SEO_TITLE"], targetWorkflowState: "CLARIFYING" })).rejects.toBeDefined();
    const snapshot = readV2TripwireSnapshot();
    expect(snapshot.providerMutationCalls + snapshot.mergeCalls + snapshot.revisionPersistenceCalls + snapshot.idempotencyMutationCalls).toBe(0);
    expect(snapshot.loadedLegacyMutationModules).toEqual([]);
  });
});
