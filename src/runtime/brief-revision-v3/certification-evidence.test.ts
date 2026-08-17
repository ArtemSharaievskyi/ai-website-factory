import { describe, expect, it } from "vitest";
import { BRIEF_V3_LIVE_EXPECTED_OPERATION_OBSERVATIONS, assertCertificationEvidenceIntegrity, assertCurrentBriefV3CertificationEvidence, createBriefV3CertificationEvidence, deriveAcceptanceVerdict, digestCertificationObject, type LiveAcceptanceObservations, type VerifiedAcceptanceFacts } from "./certification-evidence";
import { sourceFingerprintFromManifest } from "./source-fingerprint";

const windowId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const digest = "a".repeat(64);
const manifest = [{ path: "entry.ts", digest }];
const sourceFingerprint = sourceFingerprintFromManifest(manifest);

function observations(): LiveAcceptanceObservations {
  return { schemaVersion: 1, windowId, runId, sourceHead: "c318f7178aa130ae4402c3f97a402c5c8eb6acea", sourceFingerprint, sourceManifest: manifest, syntheticProjectId: projectId, syntheticSlug: "synthetic-evidence", provider: { schema: "brief-revision-v3", model: "fixture-model", requestCount: 1, retryCount: 0, correctionCount: 0, requestAttempted: true, responseReceived: true, outputComplete: true, operations: [...BRIEF_V3_LIVE_EXPECTED_OPERATION_OBSERVATIONS] }, transaction: { outcome: "COMMITTED", operationKey: "REQUEST_BRIEF_CHANGES_V3:synthetic", attemptId, changed: true, resultChecksum: digest, workflowState: "CLARIFYING", projectionStatus: "SYNCED" }, exactReplay: { outcome: "COMMITTED_REPLAY", providerCalls: 0, stateUnchanged: true }, reconstructionReplay: { outcome: "COMMITTED_REPLAY", providerCalls: 0, stateUnchanged: true }, v2Runtime: { providerMutationCalls: 0, mergeCalls: 0, revisionPersistenceCalls: 0, idempotencyMutationCalls: 0, loadedLegacyMutationModules: [] }, v2FallbackSeamCalls: 0, cleanup: { ownershipId: projectId, cleanupAttempted: false, independentSession: false, remainingByArtifact: { idempotency_records: 0 } }, failureCode: null };
}

function verified(): VerifiedAcceptanceFacts {
  return {
    schemaVersion: 1,
    source: { head: "c318f7178aa130ae4402c3f97a402c5c8eb6acea", fingerprint: sourceFingerprint, manifest, staticReachableLegacyMutationPaths: [], manifestMatchesWindow: true, manifestMatchesObservation: true, sourceHeadMatchesObservation: true },
    committed: { projectId, projectVersion: 1, attemptId, attemptStatus: "COMMITTED", transactionOutcome: "COMMITTED", changed: true, expectedBriefChecksum: digest, actualBriefChecksum: digest, semanticTargetDigests: {}, expectedTargetDigests: {}, semanticValuesMatch: true, localityDigests: {}, expectedLocalityDigests: {}, localityPreserved: true, documentChecksum: digest, documentReloadable: true, attemptBindingMatches: true, resultChecksumMatches: true, transactionObservationMatches: true, providerObservationValid: true },
    history: { count: 1, effectiveEntryCount: 1, expectedEffectiveEntryCount: 1, entriesDigest: digest, expectedEntriesDigest: digest, semanticEntriesMatch: true, provenanceChecksumMatch: true, noUnexpectedNoOpTargets: true, noDuplicateRevision: true },
    workflow: { count: 1, transition: "AWAITING_BRIEF_APPROVAL->CLARIFYING", expectedTransition: "AWAITING_BRIEF_APPROVAL->CLARIFYING", correspondsToCommit: true },
    projection: { status: "SYNCED", databaseDocumentChecksum: digest, projectionDocumentChecksum: digest, matchesDocumentAuthority: true, databaseRemainsCanonical: true },
    replay: { exactOutcome: "COMMITTED_REPLAY", exactProviderCalls: 0, exactStateUnchanged: true, reconstructionOutcome: "COMMITTED_REPLAY", reconstructionProviderCalls: 0, reconstructionStateUnchanged: true },
    v2: { staticReachableLegacyMutationPaths: [], runtime: { providerMutationCalls: 0, mergeCalls: 0, revisionPersistenceCalls: 0, idempotencyMutationCalls: 0, loadedLegacyMutationModules: [] }, fallbackSeamCalls: 0 },
    cleanup: { expectedArtifacts: ["idempotency_records"], independentSession: true, complete: true, remainingByArtifact: { idempotency_records: 0 } },
    missingMandatoryObservations: [],
    bindingMatches: true,
  } as unknown as VerifiedAcceptanceFacts;
}

describe("Brief Revision V3 evidence verdict", () => {
  it("keeps PASS derived and denies it before finalization", () => {
    const facts = verified();
    expect(deriveAcceptanceVerdict(facts)).toEqual({ status: "INCONCLUSIVE", reason: "EVIDENCE_FINALIZATION_INCOMPLETE" });
    const evidence = createBriefV3CertificationEvidence({ executionMode: "DETERMINISTIC_FIXTURE", observations: observations(), verified: facts, createdAt: "2026-08-16T00:00:00.000Z" });
    expect(evidence.status).toBe("PASS");
    expect(assertCertificationEvidenceIntegrity(evidence)).toBe(true);
  });

  it("rejects a caller-mutated verdict or evidence body", () => {
    const evidence = createBriefV3CertificationEvidence({ executionMode: "DETERMINISTIC_FIXTURE", observations: observations(), verified: verified(), createdAt: "2026-08-16T00:00:00.000Z" });
    expect(() => assertCertificationEvidenceIntegrity({ ...evidence, status: "INCONCLUSIVE", statusReason: "caller override" })).toThrow("CERTIFICATION_VERDICT_NOT_DERIVED");
    expect(() => assertCertificationEvidenceIntegrity({ ...evidence, evidenceBody: { ...evidence.evidenceBody, status: "INCONCLUSIVE" } })).toThrow("CERTIFICATION_EVIDENCE_MUTATED");
  });

  it("classifies source drift as stale and V2/runtime violations as failures", () => {
    const base = verified();
    expect(deriveAcceptanceVerdict({ ...base, source: { ...base.source, manifestMatchesObservation: false } }, "FINALIZED")).toEqual({ status: "INCONCLUSIVE", reason: "LIVE_EVIDENCE_STALE" });
    expect(deriveAcceptanceVerdict({ ...base, source: { ...base.source, sourceHeadMatchesObservation: false } }, "FINALIZED")).toEqual({ status: "INCONCLUSIVE", reason: "LIVE_EVIDENCE_STALE" });
    expect(deriveAcceptanceVerdict({ ...base, v2: { ...base.v2, staticReachableLegacyMutationPaths: ["src/agents/lead/service.ts"] } }, "FINALIZED")).toEqual({ status: "FAIL", reason: "V2_MUTATION_PATH_INVOKED_OR_REACHABLE" });
    expect(deriveAcceptanceVerdict({ ...base, v2: { ...base.v2, runtime: { ...base.v2.runtime, mergeCalls: 1 } } }, "FINALIZED")).toEqual({ status: "FAIL", reason: "V2_MUTATION_PATH_INVOKED_OR_REACHABLE" });
    expect(deriveAcceptanceVerdict({ ...base, v2: { ...base.v2, runtime: { ...base.v2.runtime, loadedLegacyMutationModules: ["src/agents/lead/service.ts"] } } }, "FINALIZED")).toEqual({ status: "FAIL", reason: "V2_MUTATION_PATH_INVOKED_OR_REACHABLE" });
    expect(deriveAcceptanceVerdict({ ...base, committed: { ...base.committed, attemptBindingMatches: false } }, "FINALIZED")).toEqual({ status: "INCONCLUSIVE", reason: "TRANSACTION_ATTEMPT_BINDING_MISMATCH" });
    expect(deriveAcceptanceVerdict({ ...base, committed: { ...base.committed, transactionObservationMatches: false } }, "FINALIZED")).toEqual({ status: "FAIL", reason: "TRANSACTION_OBSERVATION_MISMATCH" });
  });

  it("reports provenance checksum drift separately from semantic history failure", () => {
    expect(deriveAcceptanceVerdict({ ...verified(), history: { ...verified().history, provenanceChecksumMatch: false } }, "FINALIZED")).toEqual({ status: "FAIL", reason: "HISTORY_PROVENANCE_CHECKSUM_FAILED" });
  });

  it("invalidates a finalized artifact when the certified critical manifest changes", () => {
    const evidence = createBriefV3CertificationEvidence({ executionMode: "DETERMINISTIC_FIXTURE", observations: observations(), verified: verified(), createdAt: "2026-08-16T00:00:00.000Z" });
    expect(() => assertCurrentBriefV3CertificationEvidence(evidence, { sourceHead: observations().sourceHead, sourceFingerprint: "b".repeat(64), sourceManifest: [{ path: "entry.ts", digest: "b".repeat(64) }] })).toThrow("CERTIFICATION_EVIDENCE_STALE");
  });

  it("retains only structural, digest-bound observation data", () => {
    expect(observations().provider.operations.every((operation) => operation.valueDigest === digestCertificationObject("NONE") || operation.valueDigest === digestCertificationObject("ALLOWED") || operation.valueDigest === digestCertificationObject("SIMULATED") || operation.valueDigest === digestCertificationObject("Synthetic Atelier Contact"))).toBe(true);
  });
});
