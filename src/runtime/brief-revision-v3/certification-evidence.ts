import { createHash } from "node:crypto";
import { z } from "zod";
import { ProviderBriefChangeSetSchema } from "@/integrations/openai-v3/changeset";
import { assertSourceManifestCanonical, sourceFingerprintFromManifest, type SourceManifestEntry } from "./source-fingerprint";
import type { BriefV3ProjectionPort } from "./ports";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const GitHeadSchema = z.string().regex(/^[a-f0-9]{40}$/);
const UuidSchema = z.string().uuid();
const SafePathSchema = z.string().regex(/^(?![A-Za-z]:)[^\\]+$/);
const OperationSchema = z.enum(["SET", "UPSERT", "REMOVE"]);

const OperationObservationSchema = z.object({ operation: OperationSchema, targetId: z.string().min(1).max(180), valueDigest: Sha256Schema }).strict();
const SourceManifestSchema = z.array(z.object({ path: SafePathSchema, digest: Sha256Schema }).strict()).min(1);
const ProviderObservationSchema = z.object({ schema: z.string().min(1).max(120).nullable(), model: z.string().min(1).max(160), requestCount: z.number().int().nonnegative(), retryCount: z.number().int().nonnegative(), correctionCount: z.number().int().nonnegative(), requestAttempted: z.boolean().nullable(), responseReceived: z.boolean().nullable(), outputComplete: z.boolean().nullable(), operations: z.array(OperationObservationSchema), rawProviderChangeSet: ProviderBriefChangeSetSchema.nullable().optional() }).strict();
const TransactionObservationSchema = z.object({ outcome: z.enum(["NOT_RUN", "COMMITTED", "FAILED"]), operationKey: z.string().min(1).max(300).nullable(), attemptId: UuidSchema.nullable(), changed: z.boolean().nullable(), resultChecksum: Sha256Schema.nullable(), workflowState: z.string().min(1).max(100).nullable(), projectionStatus: z.string().min(1).max(80).nullable() }).strict();
const ReplayObservationSchema = z.object({ outcome: z.enum(["NOT_RUN", "COMMITTED_REPLAY", "FAILED"]), providerCalls: z.number().int().nonnegative(), stateUnchanged: z.boolean().nullable() }).strict();
const CleanupObservationSchema = z.object({ ownershipId: UuidSchema, cleanupAttempted: z.boolean(), independentSession: z.boolean(), remainingByArtifact: z.record(z.string().min(1).max(120), z.number().int().nonnegative()) }).strict();

export const LiveAcceptanceObservationsSchema = z.object({
  schemaVersion: z.literal(1),
  windowId: UuidSchema,
  runId: UuidSchema,
  sourceHead: GitHeadSchema,
  sourceFingerprint: Sha256Schema,
  sourceManifest: SourceManifestSchema,
  syntheticProjectId: UuidSchema,
  syntheticSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  provider: ProviderObservationSchema,
  transaction: TransactionObservationSchema,
  exactReplay: ReplayObservationSchema,
  reconstructionReplay: ReplayObservationSchema,
  cleanup: CleanupObservationSchema,
  failureCode: z.string().regex(/^[A-Z0-9_:-]{1,120}$/).nullable(),
}).strict();

export type LiveAcceptanceObservations = z.infer<typeof LiveAcceptanceObservationsSchema>;
export const BRIEF_V3_PROVIDER_SCHEMA_NAME = "brief-revision-v3" as const;

const expectedOperationValues: ReadonlyArray<{ operation: "SET"; targetId: string; value: unknown }> = [
  { operation: "SET", targetId: "FORM_PERSISTENCE_MODE", value: "NONE" },
  { operation: "SET", targetId: "FORM_SIMULATED_SUCCESS_POLICY", value: "ALLOWED" },
  { operation: "SET", targetId: "FORM_SUCCESS_MODE", value: "SIMULATED" },
  { operation: "SET", targetId: "FORM_TRANSMISSION_MODE", value: "NONE" },
  { operation: "SET", targetId: "SEO_TITLE", value: "Synthetic Atelier Contact" },
];

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stableValue(child)]));
  return value;
}

export function stableCertificationSerialize(value: unknown) { return JSON.stringify(stableValue(value)); }
export function digestCertificationValue(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
export function digestCertificationObject(value: unknown) { return digestCertificationValue(stableCertificationSerialize(value)); }

export function serializeLiveAcceptanceObservations(observations: LiveAcceptanceObservations) {
  return stableCertificationSerialize(LiveAcceptanceObservationsSchema.parse(observations));
}

export function deserializeLiveAcceptanceObservations(serialized: string): LiveAcceptanceObservations {
  try {
    return LiveAcceptanceObservationsSchema.parse(JSON.parse(serialized));
  } catch {
    throw new Error("CERTIFICATION_PROVIDER_EVIDENCE_INVALID");
  }
}

export const BRIEF_V3_LIVE_EXPECTED_OPERATION_OBSERVATIONS = Object.freeze(expectedOperationValues.map(({ operation, targetId, value }) => ({ operation, targetId, valueDigest: digestCertificationObject(value) })));

const VerifiedSourceSchema = z.object({ head: GitHeadSchema, fingerprint: Sha256Schema, manifest: SourceManifestSchema, staticReachableLegacyMutationPaths: z.array(SafePathSchema), manifestMatchesWindow: z.boolean(), manifestMatchesObservation: z.boolean(), sourceHeadMatchesObservation: z.boolean() }).strict();
const VerifiedCommittedSchema = z.object({ projectId: UuidSchema, projectVersion: z.number().int().positive(), attemptId: UuidSchema, attemptStatus: z.string().min(1).max(80), transactionOutcome: z.enum(["COMMITTED", "FAILED", "NOT_RUN"]), changed: z.boolean(), expectedBriefChecksum: Sha256Schema, actualBriefChecksum: Sha256Schema, semanticTargetDigests: z.record(z.string(), Sha256Schema), expectedTargetDigests: z.record(z.string(), Sha256Schema), semanticValuesMatch: z.boolean(), localityDigests: z.record(z.string(), Sha256Schema), expectedLocalityDigests: z.record(z.string(), Sha256Schema), localityPreserved: z.boolean(), documentChecksum: Sha256Schema, documentReloadable: z.boolean(), attemptBindingMatches: z.boolean(), resultChecksumMatches: z.boolean(), transactionObservationMatches: z.boolean(), providerObservationValid: z.boolean() }).strict();
const VerifiedHistorySchema = z.object({ count: z.number().int().nonnegative(), effectiveEntryCount: z.number().int().nonnegative(), expectedEffectiveEntryCount: z.number().int().nonnegative(), entriesDigest: Sha256Schema, expectedEntriesDigest: Sha256Schema, expectedChangeSetChecksum: Sha256Schema.nullable().optional(), observedChangeSetChecksum: Sha256Schema.nullable().optional(), semanticEntriesMatch: z.boolean(), provenanceChecksumMatch: z.boolean(), noUnexpectedNoOpTargets: z.boolean(), noDuplicateRevision: z.boolean() }).strict();
const VerifiedWorkflowSchema = z.object({ count: z.number().int().nonnegative(), transition: z.string().min(1).max(160).nullable(), expectedTransition: z.string().min(1).max(160), correspondsToCommit: z.boolean() }).strict();
const VerifiedProjectionSchema = z.object({ status: z.string().min(1).max(80), databaseDocumentChecksum: Sha256Schema, projectionDocumentChecksum: Sha256Schema.nullable(), matchesDocumentAuthority: z.boolean(), databaseRemainsCanonical: z.boolean() }).strict();
const VerifiedReplaySchema = z.object({ exactOutcome: z.string().min(1).max(80), exactProviderCalls: z.number().int().nonnegative(), exactStateUnchanged: z.boolean(), reconstructionOutcome: z.string().min(1).max(80), reconstructionProviderCalls: z.number().int().nonnegative(), reconstructionStateUnchanged: z.boolean() }).strict();
const VerifiedV2Schema = z.object({ staticReachableLegacyMutationPaths: z.array(SafePathSchema) }).strict();
const VerifiedCleanupSchema = z.object({ expectedArtifacts: z.array(z.string().min(1).max(120)).min(1), independentSession: z.boolean(), complete: z.boolean(), remainingByArtifact: z.record(z.string(), z.number().int().nonnegative()) }).strict();

const VerifiedAcceptanceFactsSchema = z.object({
  schemaVersion: z.literal(1),
  source: VerifiedSourceSchema,
  committed: VerifiedCommittedSchema,
  history: VerifiedHistorySchema,
  workflow: VerifiedWorkflowSchema,
  projection: VerifiedProjectionSchema,
  replay: VerifiedReplaySchema,
  v2: VerifiedV2Schema,
  cleanup: VerifiedCleanupSchema,
  missingMandatoryObservations: z.array(z.string().min(1).max(120)),
  bindingMatches: z.boolean(),
}).strict();

export type VerifiedAcceptanceFacts = z.infer<typeof VerifiedAcceptanceFactsSchema> & { readonly __verifiedAcceptanceFacts: unique symbol };

export type BriefV3CertificationStatus = "NOT_RUN" | "PASS" | "FAIL" | "INCONCLUSIVE";
export type BriefV3CertificationVerdict = { status: BriefV3CertificationStatus; reason: string | null };

export function deriveAcceptanceVerdict(input: VerifiedAcceptanceFacts, finalizationState: "UNFINALIZED" | "FINALIZED" = "UNFINALIZED"): BriefV3CertificationVerdict {
  const facts = VerifiedAcceptanceFactsSchema.parse(input);
  if (finalizationState !== "FINALIZED") return { status: "INCONCLUSIVE", reason: "EVIDENCE_FINALIZATION_INCOMPLETE" };
  if (facts.v2.staticReachableLegacyMutationPaths.length) return { status: "FAIL", reason: "V2_MUTATION_PATH_INVOKED_OR_REACHABLE" };
  if (!facts.bindingMatches || facts.missingMandatoryObservations.length) return { status: "INCONCLUSIVE", reason: facts.missingMandatoryObservations[0] ?? "ACCEPTANCE_BINDING_MISMATCH" };
  if (!facts.source.manifestMatchesWindow || !facts.source.manifestMatchesObservation || !facts.source.sourceHeadMatchesObservation || facts.source.fingerprint !== sourceFingerprintFromManifest(facts.source.manifest)) return { status: "INCONCLUSIVE", reason: "LIVE_EVIDENCE_STALE" };
  if (!facts.committed.attemptBindingMatches) return { status: "INCONCLUSIVE", reason: "TRANSACTION_ATTEMPT_BINDING_MISMATCH" };
  if (!facts.committed.transactionObservationMatches) return { status: "FAIL", reason: "TRANSACTION_OBSERVATION_MISMATCH" };
  if (!facts.committed.semanticValuesMatch || !facts.committed.localityPreserved || !facts.committed.resultChecksumMatches) return { status: "FAIL", reason: "COMMITTED_SEMANTIC_VALUE_MISMATCH" };
  if (!facts.committed.providerObservationValid) return { status: "FAIL", reason: "PROVIDER_OBSERVATION_MISMATCH" };
  if (!facts.history.semanticEntriesMatch || !facts.history.noUnexpectedNoOpTargets || !facts.history.noDuplicateRevision || facts.history.effectiveEntryCount !== facts.history.expectedEffectiveEntryCount) return { status: "FAIL", reason: "HISTORY_VERIFICATION_FAILED" };
  if (!facts.history.provenanceChecksumMatch) return { status: "FAIL", reason: "HISTORY_PROVENANCE_CHECKSUM_FAILED" };
  if (!facts.workflow.correspondsToCommit) return { status: "FAIL", reason: "WORKFLOW_VERIFICATION_FAILED" };
  if (!facts.projection.matchesDocumentAuthority || !facts.projection.databaseRemainsCanonical) return { status: "FAIL", reason: "PROJECTION_VERIFICATION_FAILED" };
  if (facts.replay.exactProviderCalls > 0 || facts.replay.reconstructionProviderCalls > 0) return { status: "FAIL", reason: "REPLAY_PROVIDER_CALL_NONZERO" };
  if (!facts.replay.exactStateUnchanged || !facts.replay.reconstructionStateUnchanged) return { status: "FAIL", reason: "REPLAY_STATE_MUTATED" };
  if (!facts.cleanup.complete || !facts.cleanup.independentSession) return { status: "INCONCLUSIVE", reason: "SYNTHETIC_CLEANUP_INCOMPLETE" };
  if (facts.committed.transactionOutcome !== "COMMITTED" || facts.committed.attemptStatus !== "COMMITTED" || !facts.committed.changed || !facts.committed.documentReloadable || facts.replay.exactOutcome !== "COMMITTED_REPLAY" || facts.replay.reconstructionOutcome !== "COMMITTED_REPLAY") return { status: "INCONCLUSIVE", reason: "MANDATORY_VERIFIED_FACT_MISSING" };
  return { status: "PASS", reason: null };
}

const evidenceBody = (evidence: { schemaVersion: number; certification: string; executionMode: string; windowId: string; runId: string; sourceFingerprint: string; status: BriefV3CertificationStatus; statusReason: string | null; observations: LiveAcceptanceObservations; verified: z.infer<typeof VerifiedAcceptanceFactsSchema>; createdAt: string }) => ({ schemaVersion: evidence.schemaVersion, certification: evidence.certification, executionMode: evidence.executionMode, windowId: evidence.windowId, runId: evidence.runId, sourceFingerprint: evidence.sourceFingerprint, status: evidence.status, statusReason: evidence.statusReason, observations: evidence.observations, verified: evidence.verified, createdAt: evidence.createdAt });

const BriefV3CertificationEvidenceSchema = z.object({
  schemaVersion: z.literal(3),
  certification: z.literal("BRIEF_REVISION_V3_E1_EVIDENCE"),
  executionMode: z.enum(["DETERMINISTIC_FIXTURE", "LIVE_OPENAI_SYNTHETIC"]),
  windowId: UuidSchema,
  runId: UuidSchema,
  sourceFingerprint: Sha256Schema,
  status: z.enum(["NOT_RUN", "PASS", "FAIL", "INCONCLUSIVE"]),
  statusReason: z.string().min(1).max(160).nullable(),
  observations: LiveAcceptanceObservationsSchema,
  verified: VerifiedAcceptanceFactsSchema,
  evidenceBody: z.record(z.string(), z.unknown()),
  evidenceDigest: Sha256Schema,
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type BriefV3CertificationEvidence = z.infer<typeof BriefV3CertificationEvidenceSchema>;

export function createBriefV3CertificationEvidence(input: { executionMode: "DETERMINISTIC_FIXTURE" | "LIVE_OPENAI_SYNTHETIC"; observations: LiveAcceptanceObservations; verified: VerifiedAcceptanceFacts; createdAt?: string }): BriefV3CertificationEvidence {
  const observations = LiveAcceptanceObservationsSchema.parse(input.observations);
  assertSourceManifestCanonical(observations.sourceManifest);
  const verified = VerifiedAcceptanceFactsSchema.parse(input.verified);
  const verdict = deriveAcceptanceVerdict(verified as VerifiedAcceptanceFacts, "FINALIZED");
  const body = evidenceBody({ schemaVersion: 3, certification: "BRIEF_REVISION_V3_E1_EVIDENCE", executionMode: input.executionMode, windowId: observations.windowId, runId: observations.runId, sourceFingerprint: observations.sourceFingerprint, status: verdict.status, statusReason: verdict.reason, observations, verified, createdAt: input.createdAt ?? new Date().toISOString() });
  return BriefV3CertificationEvidenceSchema.parse({ ...body, evidenceBody: body, evidenceDigest: digestCertificationObject(body), createdAt: body.createdAt });
}

export function assertCertificationEvidenceIntegrity(evidence: BriefV3CertificationEvidence) {
  const parsed = BriefV3CertificationEvidenceSchema.parse(evidence);
  const verdict = deriveAcceptanceVerdict(parsed.verified as VerifiedAcceptanceFacts, "FINALIZED");
  if (parsed.status !== verdict.status || parsed.statusReason !== verdict.reason) throw new Error("CERTIFICATION_VERDICT_NOT_DERIVED");
  if (parsed.windowId !== parsed.observations.windowId || parsed.runId !== parsed.observations.runId || parsed.sourceFingerprint !== parsed.observations.sourceFingerprint) throw new Error("CERTIFICATION_BINDING_MISMATCH");
  const body = evidenceBody({ ...parsed, verified: parsed.verified });
  if (stableCertificationSerialize(parsed.evidenceBody) !== stableCertificationSerialize(body) || parsed.evidenceDigest !== digestCertificationObject(body)) throw new Error("CERTIFICATION_EVIDENCE_MUTATED");
  return true;
}

export function serializeBriefV3CertificationEvidence(evidence: BriefV3CertificationEvidence) {
  assertCertificationEvidenceIntegrity(evidence);
  return stableCertificationSerialize({ windowId: evidence.windowId, runId: evidence.runId, sourceFingerprint: evidence.sourceFingerprint, status: evidence.status, evidenceBody: evidence.evidenceBody, evidenceDigest: evidence.evidenceDigest });
}

export function assertCurrentBriefV3CertificationEvidence(evidence: BriefV3CertificationEvidence, current: { sourceHead: string; sourceFingerprint: string; sourceManifest: readonly SourceManifestEntry[] }) {
  assertCertificationEvidenceIntegrity(evidence);
  if (evidence.observations.sourceHead !== current.sourceHead || evidence.sourceFingerprint !== current.sourceFingerprint || stableCertificationSerialize(evidence.observations.sourceManifest) !== stableCertificationSerialize(current.sourceManifest)) throw new Error("CERTIFICATION_EVIDENCE_STALE");
}

export async function assertBriefV3Projection(input: { projection: BriefV3ProjectionPort & { filesystemChecksums(projectVersion: number): Promise<Record<string, string>> }; projectId: string; projectVersion: number; expectedDocumentChecksum: string }) {
  const verified = await input.projection.verifyVersionSnapshot(input.projectId, input.projectVersion);
  const filesystemChecksums = await input.projection.filesystemChecksums(input.projectVersion);
  const comparison = await input.projection.compareDatabaseAndFilesystemChecksums({ "brief-v3.json": input.expectedDocumentChecksum }, filesystemChecksums);
  if (!verified || !comparison.matches) throw new Error("PROJECT_MEMORY_DOCUMENT_CHECKSUM_MISMATCH");
  return { verified, comparison, projectionChecksum: filesystemChecksums["brief-v3.json"] };
}
