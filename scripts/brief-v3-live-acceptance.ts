import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { applyBriefChangeSet } from "@/domain/requirements/v3/reducer";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { OpenAiStructuredClient } from "@/integrations/openai/client";
import { readAiProviderConfig } from "@/integrations/openai/config";
import { OpenAiBriefV3RevisionProvider, type BriefV3ProviderEvidence } from "@/integrations/openai-v3/provider";
import type { BriefV3RevisionProviderInput } from "@/integrations/openai-v3/prompt";
import type { BriefChangeSet } from "@/domain/requirements/v3/changeset";
import { BriefV3DocumentSchema, createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { mapRowToDocument } from "@/persistence/database/mapping";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { AcceptanceWindowStore } from "@/runtime/brief-revision-v3/acceptance-window";
import { BRIEF_V3_LIVE_EXPECTED_OPERATION_OBSERVATIONS, assertCurrentBriefV3CertificationEvidence, createBriefV3CertificationEvidence, digestCertificationObject, serializeBriefV3CertificationEvidence, type LiveAcceptanceObservations } from "@/runtime/brief-revision-v3/certification-evidence";
import { verifyAcceptance, createSyntheticExpectedLocalityTargets, type AcceptanceSourceIdentity } from "@/runtime/brief-revision-v3/acceptance-verifier";
import { executeSyntheticCleanupTransaction, SYNTHETIC_CLEANUP_ARTIFACTS, verifySyntheticCleanup } from "@/runtime/brief-revision-v3/cleanup-policy";
import { createBriefV3OperationIdentity, createRevisionCurrentnessToken } from "@/runtime/brief-revision-v3/identity";
import { BriefV3TransactionService } from "@/runtime/brief-revision-v3/service";
import { assertCriticalSourceCoverage, assertSourceManifestCanonical, assertV3SourceClosureDoesNotReachV2, computeCriticalSourceFingerprint } from "@/runtime/brief-revision-v3/source-fingerprint";
import { readV2TripwireSnapshot, resetV2Tripwires, type V2TripwireSnapshot } from "@/runtime/brief-revision-v3/v2-tripwire";
import { FilesystemProjectMemorySyncPort } from "@/runtime/workspace/sync";

const revisionInstruction = "For the synthetic local atelier, make successful form behavior simulated after local validation, keep transmission and persistence disabled, and update the exact SEO title to Synthetic Atelier Contact.";
const targetHints = ["FORM_PERSISTENCE_MODE", "FORM_SIMULATED_SUCCESS_POLICY", "FORM_SUCCESS_MODE", "FORM_TRANSMISSION_MODE", "SEO_TITLE"] as const;
const syntheticChangeSet: BriefChangeSet = { contractVersion: 1, changes: [
  { operation: "SET", target: "FORM_PERSISTENCE_MODE", value: "NONE", sourceRefs: ["fixture:acceptance"] },
  { operation: "SET", target: "FORM_SIMULATED_SUCCESS_POLICY", value: "ALLOWED", sourceRefs: ["fixture:acceptance"] },
  { operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED", sourceRefs: ["fixture:acceptance"] },
  { operation: "SET", target: "FORM_TRANSMISSION_MODE", value: "NONE", sourceRefs: ["fixture:acceptance"] },
  { operation: "SET", target: "SEO_TITLE", value: "Synthetic Atelier Contact", sourceRefs: ["fixture:acceptance"] },
], unresolved: [] };

type SyntheticIdentity = { projectId: string; slug: string };
type SourceWithHead = AcceptanceSourceIdentity;

const syntheticBrief = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, decisions: { ...cleanBriefV3.decisions, form: { ...cleanBriefV3.decisions.form, mode: "REAL" as const, simulatedSuccessPolicy: "UNRESOLVED" as const, transmissionMode: "EMAIL" as const, persistenceMode: "DATABASE" as const } } });

class EvidenceProvider {
  calls = 0;
  evidence?: BriefV3ProviderEvidence;
  constructor(private readonly provider: OpenAiBriefV3RevisionProvider) {}
  async proposeChanges(input: BriefV3RevisionProviderInput) {
    this.calls += 1;
    if (this.calls !== 1) throw new Error("LIVE_PROVIDER_CALL_COUNT_EXCEEDED");
    const providerInput: BriefV3RevisionProviderInput = { revisionInstruction: input.revisionInstruction, currentCanonicalV3: input.currentCanonicalV3, supportingContext: input.supportingContext };
    const result = await this.provider.proposeChangesWithEvidence(providerInput);
    this.evidence = result;
    return result.changeSet;
  }
}

async function sourceIdentity(): Promise<SourceWithHead> {
  const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).trim();
  const source = await computeCriticalSourceFingerprint();
  assertSourceManifestCanonical(source.manifest);
  assertCriticalSourceCoverage(source.manifest, source.closure);
  assertV3SourceClosureDoesNotReachV2(source.closure);
  return { ...source, sourceHead };
}

async function createSyntheticProject(database: PersistenceDatabase, identity: SyntheticIdentity) {
  const timestamp = new Date().toISOString();
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId: identity.projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: identity.projectId, slug: identity.slug, originalPrompt: "Synthetic local atelier acceptance fixture. No customer data.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId: identity.projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(syntheticBrief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  await new DocumentRepository(database).save(createBriefV3Document({ projectId: identity.projectId, projectVersion: 1, brief: syntheticBrief, createdAt: timestamp, updatedAt: timestamp }));
  return database.transaction(async (tx) => {
    const projectRow = await tx.getProject(identity.projectId);
    const versionRow = await tx.getVersion(identity.projectId, 1);
    const documentRow = await tx.getDocument(identity.projectId, 1, "brief-v3");
    if (!projectRow || !versionRow || !documentRow) throw new Error("SYNTHETIC_FIXTURE_RELOAD_FAILED");
    const document = BriefV3DocumentSchema.parse(mapRowToDocument(documentRow));
    return createRevisionCurrentnessToken({ projectId: identity.projectId, projectVersion: 1, projectRowVersion: projectRow.row_version, projectVersionRowVersion: versionRow.rowVersion, workflowState: projectRow.workflow_state, documentType: documentRow.documentType, briefChecksum: canonicalBriefChecksum(document.brief), documentChecksum: documentRow.checksum, documentRowVersion: documentRow.rowVersion });
  });
}

async function cleanupSyntheticProject(input: { pool: ReturnType<typeof createPostgresPool>; env: Record<string, string | undefined>; projectId: string; root: string }) {
  const client = await input.pool.connect();
  const deletion = await executeSyntheticCleanupTransaction(client, input.projectId);
  client.release();
  let projectionRemaining = 0;
  try { await rm(input.root, { recursive: true, force: true }); await access(input.root); projectionRemaining = 1; } catch { projectionRemaining = 0; }
  const verificationPool = createPostgresPool({ ...input.env, NODE_ENV: "test" });
  let verification = { complete: false, remainingByArtifact: Object.fromEntries(SYNTHETIC_CLEANUP_ARTIFACTS.map((artifact) => [artifact, 1])) as Record<string, number> };
  let independentSession = false;
  try {
    const verificationClient = await verificationPool.connect();
    independentSession = true;
    try { verification = await verifySyntheticCleanup(verificationClient, input.projectId); } finally { verificationClient.release(); }
  } finally { await verificationPool.end(); }
  verification.remainingByArtifact.project_memory_projection = projectionRemaining;
  return { cleanupAttempted: deletion.attempted, independentSession, complete: deletion.succeeded && verification.complete && projectionRemaining === 0, remainingByArtifact: verification.remainingByArtifact };
}

function emptyObservations(input: { windowId: string; runId: string; source: SourceWithHead; identity: SyntheticIdentity; model: string; operationKey: string }): LiveAcceptanceObservations {
  return { schemaVersion: 1, windowId: input.windowId, runId: input.runId, sourceHead: input.source.sourceHead, sourceFingerprint: input.source.fingerprint, sourceManifest: [...input.source.manifest], syntheticProjectId: input.identity.projectId, syntheticSlug: input.identity.slug, provider: { schema: null, model: input.model, requestCount: 0, retryCount: 0, correctionCount: 0, requestAttempted: null, responseReceived: null, outputComplete: null, operations: [] }, transaction: { outcome: "NOT_RUN", operationKey: input.operationKey, attemptId: null, changed: null, resultChecksum: null, workflowState: null, projectionStatus: null }, exactReplay: { outcome: "NOT_RUN", providerCalls: 0, stateUnchanged: null }, reconstructionReplay: { outcome: "NOT_RUN", providerCalls: 0, stateUnchanged: null }, v2Runtime: { providerMutationCalls: 0, mergeCalls: 0, revisionPersistenceCalls: 0, idempotencyMutationCalls: 0, loadedLegacyMutationModules: [] }, v2FallbackSeamCalls: 0, cleanup: { ownershipId: input.identity.projectId, cleanupAttempted: false, independentSession: false, remainingByArtifact: Object.fromEntries(SYNTHETIC_CLEANUP_ARTIFACTS.map((artifact) => [artifact, 1])) }, failureCode: null };
}

function safeFailureCode(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (code && /^[A-Z0-9_:-]{1,120}$/.test(code)) return code;
  if (error instanceof Error && /^[A-Z0-9_:-]{1,120}$/.test(error.message)) return error.message;
  return error instanceof Error ? error.name.toUpperCase().replaceAll(" ", "_") : "SYNTHETIC_LIVE_ACCEPTANCE_FAILED";
}

async function main() {
  if (process.env.BRIEF_V3_LIVE_ACCEPTANCE !== "1") { console.log("SYNTHETIC LIVE ACCEPTANCE: SKIPPED (set BRIEF_V3_LIVE_ACCEPTANCE=1 to opt in)"); return; }
  loadEnvConfig(process.cwd());
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL || !process.env.DATABASE_URL) { console.log("SYNTHETIC LIVE ACCEPTANCE: SKIPPED (provider credentials/model/database are not configured)"); return; }
  resetV2Tripwires();
  const identity: SyntheticIdentity = (() => { const projectId = randomUUID(); return { projectId, slug: `brief-v3-live-${projectId.slice(0, 8)}` }; })();
  const runId = randomUUID();
  const source = await sourceIdentity();
  const windowStore = new AcceptanceWindowStore(path.join(os.tmpdir(), "brief-v3-acceptance-windows"));
  const window = await windowStore.create({ sourceFingerprint: source.fingerprint, runId });
  await windowStore.consume(window.windowId);
  const initialExpected = syntheticBrief;
  const expectedBrief = applyBriefChangeSet(initialExpected, syntheticChangeSet);
  const pool = createPostgresPool({ ...process.env, NODE_ENV: "test" });
  const database = new PostgresPersistenceDatabase(pool);
  const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-live-"));
  let cleanupPromise: ReturnType<typeof cleanupSyntheticProject> | undefined;
  const cleanupOnce = () => cleanupPromise ??= cleanupSyntheticProject({ pool, env: { ...process.env, NODE_ENV: "test" }, projectId: identity.projectId, root });
  let currentness: Awaited<ReturnType<typeof createSyntheticProject>>;
  try {
    currentness = await createSyntheticProject(database, identity);
  } catch (error) {
    await cleanupOnce().catch(() => undefined);
    await pool.end();
    throw error;
  }
  const operationKey = createBriefV3OperationIdentity({ projectId: identity.projectId, projectVersion: 1, revisionInstruction, targetHints, targetWorkflowState: "CLARIFYING", currentness }).operationKey;
  const observations = emptyObservations({ windowId: window.windowId, runId, source, identity, model: process.env.OPENAI_MODEL, operationKey });
  let provider: EvidenceProvider | undefined;
  try {
    try {
    const projection = new FilesystemProjectMemorySyncPort(root, identity.slug);
    provider = new EvidenceProvider(new OpenAiBriefV3RevisionProvider(new OpenAiStructuredClient(readAiProviderConfig(process.env, true))));
    const input = { projectId: identity.projectId, projectVersion: 1, revisionInstruction, expectedCurrentness: currentness, targetHints, targetWorkflowState: "CLARIFYING" as const, actor: "brief-v3-live-acceptance" };
    const first = await new BriefV3TransactionService({ database, provider, projection }).execute(input);
    const providerEvidence = provider.evidence;
    if (!providerEvidence) throw new Error("LIVE_PROVIDER_EVIDENCE_MISSING");
    const diagnostic = providerEvidence.diagnostic;
    observations.provider = { schema: diagnostic?.schemaName ?? null, model: process.env.OPENAI_MODEL, requestCount: providerEvidence.usage.requestCount, retryCount: providerEvidence.usage.retryCount, correctionCount: providerEvidence.usage.correctionCount, requestAttempted: diagnostic?.requestAttempted ?? null, responseReceived: diagnostic ? (diagnostic.responseReceived ?? diagnostic.apiResponseReceived ?? null) : null, outputComplete: diagnostic?.outputComplete ?? null, operations: providerEvidence.changeSet.changes.map((change) => ({ operation: change.operation, targetId: change.target, valueDigest: digestCertificationObject("value" in change ? change.value : null) })) };
    observations.transaction = { outcome: first.outcome === "COMMITTED" ? "COMMITTED" : "FAILED", operationKey, attemptId: first.attemptId, changed: first.changed, resultChecksum: digestCertificationObject(first.currentBriefChecksum), workflowState: first.workflowState, projectionStatus: first.projectionStatus };
    let exactCalls = 0;
    const replay = await new BriefV3TransactionService({ database, provider: { proposeChanges: async () => { exactCalls += 1; throw new Error("REPLAY_PROVIDER_INVOKED"); } }, projection }).execute(input);
    observations.exactReplay = { outcome: replay.outcome === "COMMITTED_REPLAY" ? "COMMITTED_REPLAY" : "FAILED", providerCalls: exactCalls, stateUnchanged: replay.attemptId === first.attemptId };
    const reconstructedPool = createPostgresPool({ ...process.env, NODE_ENV: "test" });
    try {
      let reconstructionCalls = 0;
      const reconstructed = await new BriefV3TransactionService({ database: new PostgresPersistenceDatabase(reconstructedPool), provider: { proposeChanges: async () => { reconstructionCalls += 1; throw new Error("RECONSTRUCTION_REPLAY_PROVIDER_INVOKED"); } }, projection }).execute(input);
      observations.reconstructionReplay = { outcome: reconstructed.outcome === "COMMITTED_REPLAY" ? "COMMITTED_REPLAY" : "FAILED", providerCalls: reconstructionCalls, stateUnchanged: true };
    } finally { await reconstructedPool.end(); }
    } catch (error) {
    observations.failureCode = safeFailureCode(error);
    if (provider?.evidence) observations.provider = { ...observations.provider, schema: provider.evidence.diagnostic?.schemaName ?? null, requestCount: provider.evidence.usage.requestCount, retryCount: provider.evidence.usage.retryCount, correctionCount: provider.evidence.usage.correctionCount };
    } finally {
    const snapshot: V2TripwireSnapshot = readV2TripwireSnapshot();
    observations.v2Runtime = { ...snapshot, loadedLegacyMutationModules: [...snapshot.loadedLegacyMutationModules] };
    observations.v2FallbackSeamCalls = snapshot.providerMutationCalls + snapshot.mergeCalls + snapshot.revisionPersistenceCalls + snapshot.idempotencyMutationCalls;
    }
  const postSource = await sourceIdentity();
  const verified = await verifyAcceptance({ observations, expected: { windowId: window.windowId, runId, projectId: identity.projectId, projectVersion: 1, syntheticSlug: identity.slug, operationKey, initialBrief: initialExpected, expectedBrief, expectedChangeSet: syntheticChangeSet, expectedOperations: BRIEF_V3_LIVE_EXPECTED_OPERATION_OBSERVATIONS, expectedUnchangedTargets: createSyntheticExpectedLocalityTargets(syntheticChangeSet), expectedWorkflowTransition: "AWAITING_BRIEF_APPROVAL->CLARIFYING" }, readers: { database, projection: new FilesystemProjectMemorySyncPort(root, identity.slug), source: async () => postSource, v2: readV2TripwireSnapshot, cleanup: cleanupOnce } });
  const evidence = createBriefV3CertificationEvidence({ executionMode: "LIVE_OPENAI_SYNTHETIC", observations, verified });
  assertCurrentBriefV3CertificationEvidence(evidence, { sourceHead: postSource.sourceHead, sourceFingerprint: postSource.fingerprint, sourceManifest: postSource.manifest });
  await windowStore.finalize({ windowId: window.windowId, runId, sourceFingerprint: source.fingerprint, evidenceDigest: evidence.evidenceDigest, evidenceSerialized: serializeBriefV3CertificationEvidence(evidence) });
  console.log("LIVE_ACCEPTANCE_MANIFEST");
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`SYNTHETIC LIVE ACCEPTANCE: ${evidence.status}`);
  if (evidence.status !== "PASS") process.exitCode = 1;
  } finally {
    await cleanupOnce().catch(() => undefined);
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`SYNTHETIC LIVE ACCEPTANCE: INCONCLUSIVE (${safeFailureCode(error)})`);
  process.exitCode = 1;
});
