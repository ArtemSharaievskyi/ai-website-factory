import type { BriefChangeSet } from "@/domain/requirements/v3/changeset";
import { deriveBriefProvenance } from "@/domain/requirements/v3/history";
import { applyBriefChangeSet } from "@/domain/requirements/v3/reducer";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { readSemanticTarget } from "@/domain/requirements/v3/state";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import type { SemanticTargetId } from "@/domain/requirements/v3/targets";
import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { mapRowToDocument } from "@/persistence/database/mapping";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { digestCertificationObject, digestCertificationValue, type LiveAcceptanceObservations, type VerifiedAcceptanceFacts } from "./certification-evidence";
import { SYNTHETIC_CLEANUP_ARTIFACTS } from "./cleanup-policy";
import { assertCriticalSourceCoverage, assertSourceManifestCanonical, assertV3SourceClosureDoesNotReachV2, computeCriticalSourceFingerprint, legacyMutationPathsInClosure, type SourceFingerprint } from "./source-fingerprint";
import type { BriefV3ProjectionPort } from "./ports";
import { readV2TripwireSnapshot, type V2TripwireSnapshot } from "./v2-tripwire";

export type CleanupVerification = { independentSession: boolean; complete: boolean; remainingByArtifact: Record<string, number> };
export type AcceptanceSourceIdentity = SourceFingerprint & { sourceHead: string };
export type AcceptanceProjectionReader = BriefV3ProjectionPort & { filesystemChecksums(projectVersion: number): Promise<Record<string, string>> };
export type AcceptanceAuthoritativeReaders = {
  database: PersistenceDatabase;
  projection?: AcceptanceProjectionReader;
  source?: () => Promise<AcceptanceSourceIdentity>;
  v2?: () => V2TripwireSnapshot;
  cleanup: () => Promise<CleanupVerification>;
};

export type AcceptanceExpectedState = {
  windowId: string;
  runId: string;
  projectId: string;
  projectVersion: number;
  syntheticSlug: string;
  operationKey: string;
  initialBrief: CanonicalBriefV3;
  expectedBrief: CanonicalBriefV3;
  expectedChangeSet: BriefChangeSet;
  expectedOperations: ReadonlyArray<{ operation: "SET" | "UPSERT" | "REMOVE"; targetId: string; valueDigest: string }>;
  expectedUnchangedTargets: readonly string[];
  expectedWorkflowTransition: string;
};

function sortedDigest(value: unknown) { return digestCertificationObject(value); }

function missingObservations(observations: LiveAcceptanceObservations) {
  const missing: string[] = [];
  if (!observations.windowId || !observations.runId || !observations.sourceFingerprint || observations.sourceManifest.length === 0) missing.push("SOURCE_OR_WINDOW_OBSERVATION_MISSING");
  if (observations.provider.requestCount === 0 || observations.provider.schema === null || observations.provider.operations.length === 0) missing.push("PROVIDER_OBSERVATION_MISSING");
  if (observations.transaction.outcome === "NOT_RUN" || !observations.transaction.attemptId || !observations.transaction.operationKey) missing.push("TRANSACTION_OBSERVATION_MISSING");
  if (observations.exactReplay.outcome === "NOT_RUN" || observations.reconstructionReplay.outcome === "NOT_RUN") missing.push("REPLAY_OBSERVATION_MISSING");
  if (observations.failureCode !== null) missing.push(`EXECUTOR_FAILURE:${observations.failureCode}`);
  return missing;
}

export async function verifyAcceptance(input: { observations: LiveAcceptanceObservations; expected: AcceptanceExpectedState; readers: AcceptanceAuthoritativeReaders }): Promise<VerifiedAcceptanceFacts> {
  const observations = input.observations;
  const expected = input.expected;
  const source = await (input.readers.source ?? (async () => ({ ...await computeCriticalSourceFingerprint(), sourceHead: "0000000000000000000000000000000000000000" })))();
  assertSourceManifestCanonical(source.manifest);
  assertCriticalSourceCoverage(source.manifest, source.closure);
  try { assertV3SourceClosureDoesNotReachV2(source.closure); } catch { /* The derived path list below is the verifier's authoritative failure fact. */ }
  const staticReachableLegacyMutationPaths = legacyMutationPathsInClosure(source.closure);

  const committed = await input.readers.database.transaction(async (tx) => {
    const project = await tx.getProject(expected.projectId);
    const version = await tx.getVersion(expected.projectId, expected.projectVersion);
    const documentRow = await tx.getDocument(expected.projectId, expected.projectVersion, "brief-v3");
    const attempt = await tx.getBriefRevisionAttempt({ operationKind: "REQUEST_BRIEF_CHANGES_V3", operationKey: expected.operationKey });
    const historyRows = await tx.listBriefRevisionHistory(expected.projectId, expected.projectVersion);
    const events = await tx.listWorkflowEvents(expected.projectId, expected.projectVersion);
    const projection = attempt ? await tx.getBriefRevisionProjectionSync(attempt.id) : null;
    if (!project || !version || !documentRow || !attempt) throw new Error("ACCEPTANCE_AUTHORITATIVE_STATE_MISSING");
    const document = BriefV3DocumentSchema.parse(mapRowToDocument(documentRow));
    return { project, version, documentRow, document, attempt, historyRows, events, projection };
  });

  const actualBrief = committed.document.brief;
  const observedOperations = [...observations.provider.operations].sort((left, right) => `${left.operation}:${left.targetId}:${left.valueDigest}`.localeCompare(`${right.operation}:${right.targetId}:${right.valueDigest}`));
  const expectedOperations = [...expected.expectedOperations].sort((left, right) => `${left.operation}:${left.targetId}:${left.valueDigest}`.localeCompare(`${right.operation}:${right.targetId}:${right.valueDigest}`));
  const providerObservationValid = observations.provider.schema === "brief-revision-v3" && observations.provider.requestCount === 1 && observations.provider.retryCount === 0 && observations.provider.correctionCount === 0 && observations.provider.requestAttempted === true && observations.provider.responseReceived === true && observations.provider.outputComplete === true && sortedDigest(observedOperations) === sortedDigest(expectedOperations);
  const expectedTargetDigests = Object.fromEntries(input.expected.expectedOperations.map((operation) => [operation.targetId, operation.valueDigest]));
  const semanticTargetDigests = Object.fromEntries(input.expected.expectedOperations.map((operation) => [operation.targetId, sortedDigest(readSemanticTarget(actualBrief, operation.targetId as SemanticTargetId))]));
  const expectedLocalityDigests = Object.fromEntries(expected.expectedUnchangedTargets.map((target) => [target, sortedDigest(readSemanticTarget(expected.initialBrief, target as SemanticTargetId))]));
  const localityDigests = Object.fromEntries(expected.expectedUnchangedTargets.map((target) => [target, sortedDigest(readSemanticTarget(actualBrief, target as SemanticTargetId))]));
  const semanticValuesMatch = canonicalBriefChecksum(actualBrief) === canonicalBriefChecksum(expected.expectedBrief) && expected.expectedOperations.every((operation) => semanticTargetDigests[operation.targetId] === operation.valueDigest);
  const localityPreserved = expected.expectedUnchangedTargets.every((target) => localityDigests[target] === expectedLocalityDigests[target]);
  const expectedHistory = deriveBriefProvenance(expected.initialBrief, expected.expectedBrief, expected.expectedChangeSet, committed.attempt.id);
  const actualHistory = committed.historyRows.filter((row) => row.attemptId === committed.attempt.id);
  const actualEntries = actualHistory[0]?.entries ?? [];
  const historySemantics = committed.historyRows.length === 1 && actualHistory.length === 1 && actualHistory[0]?.revisionReference === committed.attempt.id && actualHistory[0]?.previousCurrentChecksum === canonicalBriefChecksum(expected.initialBrief) && actualHistory[0]?.nextCurrentChecksum === canonicalBriefChecksum(expected.expectedBrief) && actualHistory[0]?.changeSetChecksum === expectedHistory.changeSetChecksum;
  const historyEntriesMatch = sortedDigest(actualEntries) === sortedDigest(expectedHistory.entries);
  const noUnexpectedNoOpTargets = expectedHistory.entries.every((entry) => entry.outcome === "CHANGED" || !input.expected.expectedOperations.some((operation) => operation.targetId === entry.target));
  const noDuplicateRevision = new Set(committed.historyRows.map((row) => row.attemptId)).size === committed.historyRows.length && actualHistory.length === 1;
  const transition = committed.events.find((event) => event.revisionAttemptId === committed.attempt.id);
  const actualTransition = transition ? `${transition.fromState}->${transition.toState}` : null;
  const workflowEvents = committed.events.filter((event) => event.revisionAttemptId === committed.attempt.id);
  const workflowCorresponds = workflowEvents.length === 1 && actualTransition === expected.expectedWorkflowTransition && transition?.revisionAttemptId === committed.attempt.id && committed.attempt.status === "COMMITTED";
  const projectionChecksums = input.readers.projection ? await input.readers.projection.filesystemChecksums(expected.projectVersion) : {};
  const projectionDocumentChecksum = projectionChecksums["brief-v3.json"] ?? null;
  const projectionMatches = committed.projection?.documentChecksum === committed.documentRow.checksum && projectionDocumentChecksum === committed.documentRow.checksum;
  const databaseRemainsCanonical = checksumPersistedDocument(committed.documentRow.payload) === committed.documentRow.checksum;
  const v2 = (input.readers.v2 ?? readV2TripwireSnapshot)();
  const cleanup = await input.readers.cleanup();
  const remaining = Object.fromEntries(SYNTHETIC_CLEANUP_ARTIFACTS.map((artifact) => [artifact, cleanup.remainingByArtifact[artifact] ?? 1]));
  const bindingMatches = observations.windowId === expected.windowId && observations.runId === expected.runId && observations.syntheticProjectId === expected.projectId && observations.syntheticSlug === expected.syntheticSlug && observations.transaction.attemptId === committed.attempt.id && observations.transaction.operationKey === expected.operationKey;
  const committedResult = committed.attempt.committedResult && typeof committed.attempt.committedResult === "object" ? committed.attempt.committedResult as Record<string, unknown> : null;
  const actualChanged = canonicalBriefChecksum(expected.initialBrief) !== canonicalBriefChecksum(actualBrief);
  const transactionObservationMatches = observations.transaction.outcome === "COMMITTED" && observations.transaction.changed === actualChanged && observations.transaction.resultChecksum === digestCertificationObject(canonicalBriefChecksum(actualBrief)) && observations.transaction.workflowState === committed.project.workflow_state && observations.transaction.projectionStatus === (typeof committedResult?.projectionStatus === "string" ? committedResult.projectionStatus : null);
  const replayStateUnchanged = committed.historyRows.length === 1 && workflowEvents.length <= 1 && actualHistory.length === 1 && committed.attempt.id === observations.transaction.attemptId;
  const verifiedSource = { head: source.sourceHead, fingerprint: source.fingerprint, manifest: source.manifest, staticReachableLegacyMutationPaths, manifestMatchesWindow: observations.sourceFingerprint === source.fingerprint, manifestMatchesObservation: sortedDigest(observations.sourceManifest) === sortedDigest(source.manifest), sourceHeadMatchesObservation: observations.sourceHead === source.sourceHead };
  return ({
    schemaVersion: 1,
    source: { ...verifiedSource, manifest: [...verifiedSource.manifest] },
    committed: { projectId: expected.projectId, projectVersion: expected.projectVersion, attemptId: committed.attempt.id, attemptStatus: committed.attempt.status, transactionOutcome: committed.attempt.status === "COMMITTED" ? "COMMITTED" : "FAILED", changed: actualChanged, expectedBriefChecksum: canonicalBriefChecksum(expected.expectedBrief), actualBriefChecksum: canonicalBriefChecksum(actualBrief), semanticTargetDigests, expectedTargetDigests, semanticValuesMatch, localityDigests, expectedLocalityDigests, localityPreserved, documentChecksum: committed.documentRow.checksum, documentReloadable: true, attemptBindingMatches: bindingMatches, resultChecksumMatches: observations.transaction.resultChecksum === digestCertificationObject(canonicalBriefChecksum(actualBrief)), transactionObservationMatches, providerObservationValid },
    history: { count: actualHistory.length, entriesDigest: sortedDigest(actualEntries), expectedEntriesDigest: sortedDigest(expectedHistory.entries), semanticEntriesMatch: historySemantics && historyEntriesMatch, noUnexpectedNoOpTargets, noDuplicateRevision },
    workflow: { count: workflowEvents.length, transition: actualTransition, expectedTransition: expected.expectedWorkflowTransition, correspondsToCommit: workflowCorresponds },
    projection: { status: committed.projection?.status ?? "NONE", databaseDocumentChecksum: committed.documentRow.checksum, projectionDocumentChecksum, matchesDocumentAuthority: Boolean(projectionMatches), databaseRemainsCanonical },
    replay: { exactOutcome: observations.exactReplay.outcome, exactProviderCalls: observations.exactReplay.providerCalls, exactStateUnchanged: observations.exactReplay.stateUnchanged === true && replayStateUnchanged, reconstructionOutcome: observations.reconstructionReplay.outcome, reconstructionProviderCalls: observations.reconstructionReplay.providerCalls, reconstructionStateUnchanged: observations.reconstructionReplay.stateUnchanged === true && replayStateUnchanged },
    v2: { staticReachableLegacyMutationPaths, runtime: { providerMutationCalls: v2.providerMutationCalls, mergeCalls: v2.mergeCalls, revisionPersistenceCalls: v2.revisionPersistenceCalls, idempotencyMutationCalls: v2.idempotencyMutationCalls, loadedLegacyMutationModules: [...v2.loadedLegacyMutationModules] }, fallbackSeamCalls: observations.v2FallbackSeamCalls },
    cleanup: { expectedArtifacts: [...SYNTHETIC_CLEANUP_ARTIFACTS], independentSession: cleanup.independentSession, complete: cleanup.complete && Object.values(remaining).every((count) => count === 0), remainingByArtifact: remaining },
    missingMandatoryObservations: missingObservations(observations),
    bindingMatches,
  } as unknown as VerifiedAcceptanceFacts);
}

export function expectedBriefFromChangeSet(initialBrief: CanonicalBriefV3, changeSet: BriefChangeSet) { return applyBriefChangeSet(initialBrief, changeSet); }

export function createSyntheticExpectedLocalityTargets(changeSet: BriefChangeSet) {
  const changed = new Set<string>(changeSet.changes.map((change) => change.target));
  return ["FORM_SERVER_PROCESSING_MODE", "DATABASE_MODE", "AUTH_MODE", "ANALYTICS_MODE", "ROUTE_POLICY", "SEO_META_DESCRIPTION", "BRAND_REFERENCE_STRATEGY", "IMAGE_SOURCE_STRATEGY"].filter((target) => !changed.has(target));
}

export function digestTargetValue(value: unknown) { return digestCertificationObject(value); }
export function digestSourceManifest(source: SourceFingerprint) { return digestCertificationValue(source.manifest.map((entry) => `${entry.path}:${entry.digest}`).join("\n")); }
