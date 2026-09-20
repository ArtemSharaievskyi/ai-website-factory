import { createHash, randomUUID } from "node:crypto";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { PersistenceDatabase, OperationReservation } from "@/persistence/database/types";
import { PersistenceError } from "@/persistence/database/errors";
import { isStagedPlanningFailure } from "@/agents/planner/staged-failures";
import type { PlanningAdmissionBoundary, PlanningFinalAdmissionDiagnostics } from "@/agents/planner/final-admission-diagnostics";
import { createProviderTerminationMetadata, type ProviderDiagnostic, type ProviderInvocationLedgerHandle, type ProviderInvocationLedgerPort, type ProviderInvocationLedgerState, type ProviderInvocationStage, type ProviderTerminationMetadata, type ProviderTerminationParseStatus } from "@/integrations/openai/usage";
import { providerFailureDiagnosticFromError } from "@/integrations/openai/failure-diagnostics";
import type { ProviderFailureDiagnostic } from "@/domain/shared/provider-failure";
import type { PlanningAdmissionDiagnosticEnvelope } from "@/agents/planner/staged-admission-diagnostics";
import type { PlannerCoverageDiagnostics, PlannerDecompositionKindDomainDiagnostics } from "@/agents/planner/coverage-contract";
import type { PlanningGraphCycleDiagnostics } from "@/agents/planner/staged-contracts";
import type { DecompositionMinimumDiagnostics } from "@/agents/planner/decomposition-minimum";
import type { CoverageRepresentabilityAnchorDiagnostics } from "@/agents/planner/coverage-representability";
import type { StagedPlanningOperationSummary } from "@/agents/planner/staged-failures";
import { WorkbenchOperationFailure, type WorkbenchOperationFailureDetails, type WorkbenchOperationStage } from "./operation-context";

type ProviderCounters = {
  attempted: number;
  started: number;
  responseReceived: number;
  structuredParsePassed: number;
  semanticAdmissionPassed: number;
  completed: number;
  failed: number;
};

type Invocation = { id: string; stage: ProviderInvocationStage; providerContract: string; state: ProviderInvocationLedgerState };
type RecordState = {
  schemaVersion: 1;
  attemptId: string;
  correlationId: string;
  operationId: string;
  operationKind: "PLANNING_GENERATION";
  projectId: string;
  phase: "PLANNING";
  stage: WorkbenchOperationStage;
  providerContract: string | null;
  providerCallsTotal: number;
  providerCallsByStage: Record<ProviderInvocationStage, ProviderCounters>;
  providerInvocationState: ProviderInvocationLedgerState | null;
  providerDiagnostic: ProviderFailureDiagnostic | null;
  providerInvocations: Invocation[];
  canonicalPlanningPersisted: boolean;
  lifecycleMutated: boolean;
  currentness?: WorkbenchPlanningCurrentness;
  failureClass: string | null;
  outerCode: string | null;
  boundary: PlanningAdmissionBoundary | null;
  reasonCode: string | null;
  finalAdmissionDiagnostics: PlanningFinalAdmissionDiagnostics | null;
  kindDomainDiagnostics: PlannerDecompositionKindDomainDiagnostics | null;
  minimumDiagnostics: DecompositionMinimumDiagnostics | null;
  graphCycleDiagnostics: PlanningGraphCycleDiagnostics | null;
  coverageDiagnostics: PlannerCoverageDiagnostics | null;
  representabilityAnchorDiagnostics: CoverageRepresentabilityAnchorDiagnostics | null;
  stagedOperation: StagedPlanningOperationSummary | null;
  admissionDiagnostics: PlanningAdmissionDiagnosticEnvelope | null;
  providerTermination: ProviderTerminationMetadata | null;
  safeErrorFingerprint: string | null;
  semanticIntentHash: string | null;
  attemptRequestHash: string | null;
};

export type WorkbenchPlanningCurrentness = { projectVersion: number; rowVersion: number; briefChecksum: string };

export type WorkbenchPlanningIntentPayload = {
  action: "generate-planning";
  projectId: string;
  operationKind: "PLANNING_GENERATION";
  currentness: WorkbenchPlanningCurrentness | null;
};

/** The stable product/currentness identity. It deliberately excludes attempt and observability metadata. */
export function workbenchPlanningIntentPayload(projectId: string, currentness: WorkbenchPlanningCurrentness | null): WorkbenchPlanningIntentPayload {
  return { action: "generate-planning", projectId, operationKind: "PLANNING_GENERATION", currentness };
}

export function workbenchPlanningIntentHash(projectId: string, currentness: WorkbenchPlanningCurrentness | null) {
  return checksumPersistedDocument(workbenchPlanningIntentPayload(projectId, currentness));
}

/** Historical payload contracts accepted only for terminal failed rows during explicit re-execution. */
export function legacyWorkbenchPlanningIntentHash(projectId: string, action: "approve-planning" | "generate-planning", currentness: WorkbenchPlanningCurrentness | null) {
  return checksumPersistedDocument({ action, projectId, operationKind: "PLANNING_GENERATION", currentness });
}

/** Stable logical operation used for idempotency and current-result lookup. */
export const WORKBENCH_PLANNING_OPERATION = "workbench.planning";
/** Namespaced terminal records retain one bounded result per execution attempt. */
export const WORKBENCH_PLANNING_ATTEMPT_OPERATION = "workbench.planning.attempt";

export function workbenchPlanningAttemptKey(operationId: string, attemptId: string) {
  return `${operationId}:${attemptId}`;
}

/** Read one terminal Workbench Planning attempt without mutating it. */
export function readWorkbenchPlanningAttempt(database: PersistenceDatabase, operationId: string, attemptId: string) {
  return database.transaction((tx) => tx.getOperation({
    operation: WORKBENCH_PLANNING_ATTEMPT_OPERATION,
    key: workbenchPlanningAttemptKey(operationId, attemptId),
  }));
}

const emptyCounters = (): ProviderCounters => ({ attempted: 0, started: 0, responseReceived: 0, structuredParsePassed: 0, semanticAdmissionPassed: 0, completed: 0, failed: 0 });
const initialRecord = (operationId: string, projectId: string, correlationId: string): RecordState => ({
  schemaVersion: 1,
  attemptId: randomUUID(),
  correlationId,
  operationId,
  operationKind: "PLANNING_GENERATION",
  projectId,
  phase: "PLANNING",
  stage: "WORKBENCH_DISPATCH",
  providerContract: null,
  providerCallsTotal: 0,
  providerCallsByStage: { decomposition: emptyCounters(), coverage: emptyCounters(), "architecture-review": emptyCounters() },
  providerInvocationState: null,
  providerDiagnostic: null,
  providerInvocations: [],
  canonicalPlanningPersisted: false,
  lifecycleMutated: false,
  failureClass: null,
  outerCode: null,
  boundary: null,
  reasonCode: null,
  finalAdmissionDiagnostics: null,
  kindDomainDiagnostics: null,
  minimumDiagnostics: null,
  graphCycleDiagnostics: null,
  coverageDiagnostics: null,
  representabilityAnchorDiagnostics: null,
  stagedOperation: null,
  admissionDiagnostics: null,
  providerTermination: null,
  safeErrorFingerprint: null,
  semanticIntentHash: null,
  attemptRequestHash: null,
});

const safeCode = (error: unknown) => {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(error.code)) return error.code;
  if (error instanceof Error) {
    const candidate = error.message.split(":", 1)[0];
    if (/^[A-Z][A-Z0-9_]+$/.test(candidate)) return candidate;
  }
  return undefined;
};

const safeErrorClass = (error: unknown) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "UnknownError";
};

export const safeOperationFingerprint = (error: unknown, stage: WorkbenchOperationStage, boundary?: PlanningAdmissionBoundary, reasonCode?: string) => {
  const category = safeCode(error)?.split("_", 1)[0] ?? "UNEXPECTED";
  const providerDiagnostic = providerFailureDiagnosticFromError(error);
  const transportIdentity = providerDiagnostic ? `${providerDiagnostic.transportPhase ?? ""}|${providerDiagnostic.transportFailureClass ?? ""}|${providerDiagnostic.transportCauseCode ?? ""}` : "";
  return `${safeErrorClass(error)}@${stage}:${createHash("sha256").update(`${safeErrorClass(error)}|${stage}|${category}|${boundary ?? ""}|${reasonCode ?? ""}|${transportIdentity}`, "utf8").digest("hex").slice(0, 16)}`;
};

export class WorkbenchOperationConflict extends Error {
  constructor(readonly code: "WORKBENCH_OPERATION_IN_PROGRESS" | "WORKBENCH_OPERATION_REPLAY", message: string) {
    super(message);
    this.name = "WorkbenchOperationConflict";
  }
}

function outerStageForStaged(stage: string): WorkbenchOperationStage {
  if (stage.startsWith("DECOMPOSITION")) return "DECOMPOSITION";
  if (stage.startsWith("GRAPH") || stage === "PE_ASSIGNMENT") return "GRAPH";
  if (stage.startsWith("COVERAGE")) return "COVERAGE";
  if (stage.startsWith("FINAL")) return "FINAL_ASSEMBLY";
  if (stage === "PERSISTENCE") return "PERSISTENCE";
  if (stage === "LIFECYCLE_TRANSITION") return "LIFECYCLE_TRANSITION";
  return "PREFLIGHT";
}

export class WorkbenchOperationLedger implements ProviderInvocationLedgerPort {
  private record: RecordState;
  private readonly operation = WORKBENCH_PLANNING_OPERATION;
  private readonly key: string;
  private reservationPayloadHash?: string;
  private reserved = false;
  private attemptEvidencePersisted = false;

  constructor(private readonly database: PersistenceDatabase, projectId: string, operationId = `workbench-planning:${projectId}`, correlationId: string = randomUUID()) {
    this.record = initialRecord(operationId, projectId, correlationId);
    this.key = projectId;
  }

  private payloadHash() {
    return workbenchPlanningIntentHash(this.record.projectId, this.record.currentness ?? null);
  }

  private attemptPayloadHash() {
    return checksumPersistedDocument({
      schemaVersion: 1,
      logicalOperationId: this.record.operationId,
      semanticIntentHash: this.record.semanticIntentHash,
      action: "generate-planning",
      attemptId: this.record.attemptId,
      projectId: this.record.projectId,
      operationKind: this.record.operationKind,
      correlationId: this.record.correlationId,
      currentness: this.record.currentness ?? null,
    });
  }

  private historicalCurrentness(result: unknown): WorkbenchPlanningCurrentness | null {
    if (!result || typeof result !== "object" || Array.isArray(result)) return null;
    const currentness = (result as { currentness?: unknown }).currentness;
    if (!currentness || typeof currentness !== "object" || Array.isArray(currentness)) return null;
    const value = currentness as Record<string, unknown>;
    if (typeof value.projectVersion !== "number" || typeof value.rowVersion !== "number" || typeof value.briefChecksum !== "string") return null;
    return { projectVersion: value.projectVersion, rowVersion: value.rowVersion, briefChecksum: value.briefChecksum };
  }

  private failedAttemptReexecutionDecision(existing: { payloadHash: string; result?: unknown }) {
    const historical = this.historicalCurrentness(existing.result);
    if (!historical) return { allowed: false as const, reasonCode: "HISTORICAL_CURRENTNESS_UNAVAILABLE" as const };
    if (!this.record.currentness) return { allowed: false as const, reasonCode: "CURRENTNESS_UNAVAILABLE" as const };
    const sameCurrentness = historical.projectVersion === this.record.currentness.projectVersion
      && historical.rowVersion === this.record.currentness.rowVersion
      && historical.briefChecksum === this.record.currentness.briefChecksum;
    if (!sameCurrentness) return { allowed: false as const, reasonCode: "CURRENTNESS_MISMATCH" as const };
    const knownHistoricalPayload = [null, historical].some((legacyCurrentness) =>
      (["approve-planning", "generate-planning"] as const).some((action) => existing.payloadHash === legacyWorkbenchPlanningIntentHash(this.record.projectId, action, legacyCurrentness)));
    if (!knownHistoricalPayload) return { allowed: false as const, reasonCode: "HISTORICAL_PAYLOAD_INCOMPATIBLE" as const };
    return { allowed: true as const };
  }

  private async persistAttemptTerminal(status: "SUCCEEDED" | "FAILED") {
    if (!this.reserved || this.attemptEvidencePersisted) return;
    const key = workbenchPlanningAttemptKey(this.record.operationId, this.record.attemptId);
    const payloadHash = this.attemptPayloadHash();
    this.record.attemptRequestHash = payloadHash;
    const result = structuredClone(this.record);
    try {
      await this.database.transaction(async (tx) => {
        // Generic FAILED operations are retryable. Attempt records are not:
        // never reset an already persisted attempt and risk overwriting it.
        if (await tx.getOperation({ operation: WORKBENCH_PLANNING_ATTEMPT_OPERATION, key })) return;
        const reservation = await tx.reserveOperation({ operation: WORKBENCH_PLANNING_ATTEMPT_OPERATION, key, payloadHash, initialResult: result });
        if (reservation.status === "NEW" || reservation.status === "IN_PROGRESS") {
          const terminal = status === "FAILED" ? tx.failOperation.bind(tx) : tx.completeOperation.bind(tx);
          await terminal({ operation: WORKBENCH_PLANNING_ATTEMPT_OPERATION, key, payloadHash, result, leaseId: this.record.attemptId });
        }
      });
      this.attemptEvidencePersisted = true;
    } catch {
      // The stable current-result row remains the compatibility path; attempt
      // history must not expose persistence internals on a failure response.
    }
  }

  async reserve(): Promise<OperationReservation> {
    const currentHash = this.payloadHash();
    this.record.semanticIntentHash = currentHash;
    this.reservationPayloadHash = currentHash;
    const reservation = await this.database.transaction(async (tx) => {
      const existing = await tx.getOperation({ operation: this.operation, key: this.key });
      if (existing?.status === "IN_PROGRESS") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_IN_PROGRESS", "A current Planning operation is already active.");
      if (existing?.status === "SUCCEEDED" && existing.payloadHash !== currentHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The current Planning operation is bound to a different semantic intent.");
      let reservationHash = currentHash;
      if (existing?.status === "FAILED") {
        const decision = this.failedAttemptReexecutionDecision(existing);
        if (!decision.allowed) {
          const message = decision.reasonCode === "CURRENTNESS_MISMATCH"
            ? "The failed Planning operation is bound to stale canonical currentness."
            : decision.reasonCode === "HISTORICAL_CURRENTNESS_UNAVAILABLE"
              ? "The failed Planning operation has no historical currentness evidence for reexecution."
              : "The failed Planning operation is bound to stale or incompatible canonical intent.";
          throw new PersistenceError("IDEMPOTENCY_CONFLICT", message, { reasonCode: decision.reasonCode });
        }
        // Keep the historical logical-row hash as the compatibility binding;
        // the new attempt gets its own currentness-bound request hash below.
        if (existing.payloadHash !== currentHash) reservationHash = existing.payloadHash;
      }
      this.reservationPayloadHash = reservationHash;
      return tx.reserveOperation({ operation: this.operation, key: this.key, payloadHash: reservationHash, initialResult: this.record });
    });
    if (reservation.status === "IN_PROGRESS") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_IN_PROGRESS", "A current Planning operation is already active.");
    if (reservation.status === "SUCCEEDED") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_REPLAY", "The current Planning operation was already completed.");
    this.reserved = true;
    return reservation;
  }

  async hasActiveOperation() {
    const current = await this.database.transaction((tx) => tx.getOperation({ operation: this.operation, key: this.key }));
    return current?.status === "IN_PROGRESS";
  }

  private async persist() {
    if (!this.reserved || !this.reservationPayloadHash) throw new Error("WORKBENCH_OPERATION_NOT_RESERVED");
    const result = structuredClone(this.record);
    await this.database.transaction((tx) => tx.updateOperationResult({ operation: this.operation, key: this.key, payloadHash: this.reservationPayloadHash!, result, leaseId: this.record.attemptId }));
  }

  async setStage(stage: WorkbenchOperationStage) {
    this.record.stage = stage;
    await this.persist();
  }

  async bindCurrentness(input: { projectVersion: number; rowVersion: number; briefChecksum: string }) {
    if (!Number.isInteger(input.projectVersion) || input.projectVersion < 1 || !Number.isInteger(input.rowVersion) || input.rowVersion < 1 || !/^[a-f0-9]{64}$/.test(input.briefChecksum)) throw new Error("WORKBENCH_CURRENTNESS_INVALID");
    if (this.record.currentness && (this.record.currentness.projectVersion !== input.projectVersion || this.record.currentness.rowVersion !== input.rowVersion || this.record.currentness.briefChecksum !== input.briefChecksum)) throw new Error("WORKBENCH_CURRENTNESS_CONFLICT");
    if (this.record.currentness) return;
    if (this.reserved) throw new Error("WORKBENCH_CURRENTNESS_LATE");
    this.record.currentness = { ...input };
  }

  async assertProviderBoundaryReady() {
    if (!this.record.currentness) throw new Error("WORKBENCH_PROVIDER_CONTEXT_UNBOUND");
  }

  async markCanonicalPlanningPersisted() {
    this.record.canonicalPlanningPersisted = true;
    this.record.lifecycleMutated = true;
    await this.persist();
  }

  async reserveInvocation(input: { stage: ProviderInvocationStage; providerContract: string }): Promise<ProviderInvocationLedgerHandle> {
    if (!this.reserved) throw new Error("WORKBENCH_OPERATION_NOT_RESERVED");
    await this.assertProviderBoundaryReady();
    if (!/^[a-z0-9-]{1,100}$/.test(input.providerContract)) throw new Error("WORKBENCH_PROVIDER_CONTRACT_INVALID");
    if (this.record.providerInvocations.some((candidate) => candidate.stage === input.stage)) throw new Error("WORKBENCH_PROVIDER_BUDGET_EXHAUSTED");
    const invocation: Invocation = { id: randomUUID(), stage: input.stage, providerContract: input.providerContract, state: "RESERVED" };
    this.record.providerContract = input.providerContract;
    this.record.providerInvocationState = "RESERVED";
    this.record.providerInvocations = [...this.record.providerInvocations, invocation].slice(-8);
    await this.persist();
    const transition = async (state: ProviderInvocationLedgerState) => {
      const current = this.record.providerInvocations.find((candidate) => candidate.id === invocation.id);
      if (!current || current.state === "FAILED") return;
      const rank: Record<ProviderInvocationLedgerState, number> = { RESERVED: 0, ATTEMPTING: 1, TRANSPORT_STARTED: 2, RESPONSE_RECEIVED: 3, PARSE_PASSED: 4, ADMISSION_PASSED: 5, FAILED: 6 };
      if (state !== "FAILED" && rank[state] <= rank[current.state]) return;
      current.state = state;
      this.record.providerInvocationState = state;
      const counters = this.record.providerCallsByStage[invocation.stage];
      if (state === "TRANSPORT_STARTED" && counters.attempted === counters.started) {
        counters.attempted += 1;
        counters.started += 1;
        this.record.providerCallsTotal += 1;
      }
      if (state === "RESPONSE_RECEIVED" && counters.responseReceived < counters.attempted) counters.responseReceived += 1;
      if (state === "PARSE_PASSED" && counters.structuredParsePassed < counters.attempted) {
        counters.structuredParsePassed += 1;
        counters.completed += 1;
      }
      if (state === "ADMISSION_PASSED" && counters.semanticAdmissionPassed < counters.attempted) counters.semanticAdmissionPassed += 1;
      if (state === "FAILED" && counters.failed < counters.attempted + 1) counters.failed += 1;
      await this.persist();
    };
    return {
      stage: input.stage,
      providerContract: input.providerContract,
      beforeTransport: async () => { await transition("ATTEMPTING"); await transition("TRANSPORT_STARTED"); },
      responseReceived: () => transition("RESPONSE_RECEIVED"),
      parsePassed: () => transition("PARSE_PASSED"),
      admissionPassed: () => transition("ADMISSION_PASSED"),
      failed: () => transition("FAILED"),
    };
  }

  snapshot() {
    return structuredClone({
      providerCallsTotal: this.record.providerCallsTotal,
      providerCallsByStage: this.record.providerCallsByStage,
      ...(this.record.providerInvocationState ? { providerInvocationState: this.record.providerInvocationState } : {}),
    });
  }

  async recordProviderDiagnostic(diagnostic: ProviderDiagnostic, parseStatus: ProviderTerminationParseStatus) {
    if (!this.reserved) return;
    this.record.providerTermination = createProviderTerminationMetadata(diagnostic, parseStatus);
    await this.persist();
  }

  async complete() {
    this.record.stage = "LIFECYCLE_TRANSITION";
    await this.database.transaction((tx) => tx.completeOperation({ operation: this.operation, key: this.key, payloadHash: this.reservationPayloadHash!, result: structuredClone(this.record), leaseId: this.record.attemptId }));
    await this.persistAttemptTerminal("SUCCEEDED");
  }

  async fail(error: unknown): Promise<WorkbenchOperationFailure> {
    const stagedFailure = isStagedPlanningFailure(error) ? error : undefined;
    const commitOutcomeAmbiguous = hasErrorCode(error, "PERSISTENCE_COMMIT_AMBIGUOUS");
    const operationStage = stagedFailure ? outerStageForStaged(stagedFailure.details.stage) : this.record.stage;
    const outerCode = stagedFailure ? stagedFailure.details.outerCode : safeCode(error) ?? "WORKBENCH_INTERNAL_ERROR";
    const failureClass = stagedFailure ? stagedFailure.details.failureClass : safeCode(error) ? "KNOWN_WORKFLOW_FAILURE" : "UNEXPECTED_EXCEPTION";
    const reasonCode = stagedFailure ? stagedFailure.details.reasonCode : safeCode(error);
    const boundary = stagedFailure?.details.boundary ?? (stagedFailure?.details.stage === "FINAL_ASSEMBLY" || stagedFailure?.details.stage === "FINAL_ADMISSION" ? stagedFailure.details.stage : undefined);
    const finalAdmissionDiagnostics = stagedFailure?.details.finalAdmissionDiagnostics;
    const kindDomainDiagnostics = stagedFailure?.details.kindDomainDiagnostics;
    const minimumDiagnostics = stagedFailure?.details.minimumDiagnostics;
    const graphCycleDiagnostics = stagedFailure?.details.graphCycleDiagnostics;
    const coverageDiagnostics = stagedFailure?.details.coverageDiagnostics;
    const representabilityAnchorDiagnostics = stagedFailure?.details.representabilityAnchorDiagnostics;
    const stagedOperation = stagedFailure?.details.operation;
    const admissionDiagnostics = stagedFailure?.details.admissionDiagnostics;
    const safeErrorFingerprint = safeOperationFingerprint(error, operationStage, boundary, finalAdmissionDiagnostics?.primary.reasonCode ?? reasonCode);
    const providerDiagnostic = providerFailureDiagnosticFromError(error);
    this.record = {
      ...this.record,
      stage: operationStage,
      providerContract: stagedFailure ? stagedFailure.details.providerContract ?? this.record.providerContract : this.record.providerContract,
      providerDiagnostic: providerDiagnostic ?? this.record.providerDiagnostic,
      failureClass,
      outerCode,
      boundary: boundary ?? null,
      reasonCode: reasonCode ?? null,
      finalAdmissionDiagnostics: finalAdmissionDiagnostics ?? null,
      kindDomainDiagnostics: kindDomainDiagnostics ?? null,
      minimumDiagnostics: minimumDiagnostics ?? null,
      graphCycleDiagnostics: graphCycleDiagnostics ?? null,
      coverageDiagnostics: coverageDiagnostics ?? null,
      representabilityAnchorDiagnostics: representabilityAnchorDiagnostics ?? null,
      stagedOperation: stagedOperation ?? null,
      admissionDiagnostics: admissionDiagnostics ?? null,
      safeErrorFingerprint,
      canonicalPlanningPersisted: this.record.canonicalPlanningPersisted || commitOutcomeAmbiguous,
      lifecycleMutated: this.record.lifecycleMutated || commitOutcomeAmbiguous,
    };
    const details: WorkbenchOperationFailureDetails = {
      correlationId: this.record.correlationId,
      attemptId: this.record.attemptId,
      operationId: this.record.operationId,
      operationKind: this.record.operationKind,
      projectId: this.record.projectId,
      phase: this.record.phase,
      operationStage,
      failureClass,
      outerCode,
      ...(boundary ? { boundary } : {}),
      ...(reasonCode ? { reasonCode } : {}),
      ...(finalAdmissionDiagnostics ? { finalAdmissionDiagnostics } : {}),
      ...(kindDomainDiagnostics ? { kindDomainDiagnostics } : {}),
      ...(minimumDiagnostics ? { minimumDiagnostics } : {}),
      ...(graphCycleDiagnostics ? { graphCycleDiagnostics } : {}),
      ...(coverageDiagnostics ? { coverageDiagnostics } : {}),
      ...(representabilityAnchorDiagnostics ? { representabilityAnchorDiagnostics } : {}),
      ...(stagedOperation ? { stagedOperation } : {}),
      ...(admissionDiagnostics ? { admissionDiagnostics } : {}),
      ...(this.record.providerTermination ? { providerTermination: this.record.providerTermination } : {}),
      safeErrorFingerprint,
      ...(this.record.providerContract ? { providerContract: this.record.providerContract } : {}),
      ...(this.record.providerDiagnostic ? { providerDiagnostic: this.record.providerDiagnostic } : {}),
      providerCallsTotal: this.record.providerCallsTotal,
      providerCallsByStage: structuredClone(this.record.providerCallsByStage),
      ...(this.record.providerInvocationState ? { providerInvocationState: this.record.providerInvocationState } : {}),
      canonicalPlanningPersisted: this.record.canonicalPlanningPersisted,
      lifecycleMutated: this.record.lifecycleMutated,
      ...(stagedFailure ? { stagedStage: stagedFailure.details.stage } : {}),
      ...(failureClass === "UNEXPECTED_EXCEPTION" ? { internalClassification: "UNEXPECTED_EXCEPTION" as const } : {}),
    };
    try {
      if (this.reserved && this.reservationPayloadHash)
        await this.database.transaction((tx) => tx.failOperation({ operation: this.operation, key: this.key, payloadHash: this.reservationPayloadHash!, result: structuredClone(this.record), leaseId: this.record.attemptId }));
    } catch {
      // The in-memory envelope is still returned; the persistence failure is
      // deliberately not allowed to expose raw database details.
    }
    await this.persistAttemptTerminal("FAILED");
    const message = details.canonicalPlanningPersisted || details.lifecycleMutated
      ? "The Workbench operation reached a mutation boundary; inspect the current project state before retrying."
      : "The Workbench operation failed safely; the project was not changed.";
    return new WorkbenchOperationFailure(details, message, error);
  }
}

function hasErrorCode(error: unknown, code: string, depth = 0): boolean {
  if (depth > 6 || !error || typeof error !== "object") return false;
  const value = error as { code?: unknown; cause?: unknown };
  return value.code === code || hasErrorCode(value.cause, code, depth + 1);
}
