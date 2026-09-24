import { randomUUID } from "node:crypto";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { PersistenceDatabase, OperationReservation } from "@/persistence/database/types";
import type { ArchitectureReviewInput } from "@/agents/reviewers/architecture/contracts";
import type { ProviderDiagnostic, ProviderInvocationLedgerHandle, ProviderInvocationLedgerPort, ProviderInvocationLedgerState, ProviderInvocationStage, ProviderTerminationParseStatus } from "@/integrations/openai/usage";
import { createProviderFailureDiagnostic, providerFailureDiagnosticFromError } from "@/integrations/openai/failure-diagnostics";
import { ProviderFailureDiagnosticSchema, type ProviderFailureDiagnostic } from "@/domain/shared/provider-failure";
import { WorkbenchOperationFailure, type WorkbenchOperationFailureDetails, type WorkbenchOperationStage } from "./operation-context";
import { WorkbenchOperationConflict, safeOperationFingerprint } from "./operation-ledger";
import { attemptReadbackFromResult, currentRuntimeProvenance, MAX_WORKBENCH_ATTEMPT_HISTORY, type RuntimeProvenance, type WorkbenchAttemptReadback, type WorkbenchResponseMetadata, type WorkbenchResponseOrigin } from "./observability";

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
  operationKind: "ARCHITECTURE_REVIEW";
  projectId: string;
  phase: "ARCHITECTURE_REVIEW";
  stage: WorkbenchOperationStage;
  providerContract: string | null;
  providerCallsTotal: number;
  providerCallsByStage: Record<ProviderInvocationStage, ProviderCounters>;
  providerInvocationState: ProviderInvocationLedgerState | null;
  providerDiagnostic: ProviderFailureDiagnostic | null;
  providerInvocations: Invocation[];
  canonicalPlanningPersisted: false;
  canonicalArchitecturePersisted: boolean;
  lifecycleMutated: boolean;
  currentness: { projectVersion: number; rowVersion: number; briefChecksum: string; acceptedPlanningChecksum: string };
  failureClass: string | null;
  outerCode: string | null;
  reasonCode: string | null;
  safeErrorFingerprint: string | null;
  attemptCreatedAt: string;
  reservedAt: string | null;
  executionStartedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  failureStage: string | null;
  attemptTimeline: Array<{ type: "ATTEMPT_CREATED" | "ATTEMPT_RESERVED" | "EXECUTION_STARTED" | "PROVIDER_STAGE_RESERVED" | "PROVIDER_STAGE_STARTED" | "PROVIDER_STAGE_RESPONSE_RECEIVED" | "PROVIDER_STAGE_PARSE_PASSED" | "PROVIDER_STAGE_ADMISSION_PASSED" | "PROVIDER_STAGE_FAILED" | "EXECUTION_SUCCEEDED" | "EXECUTION_FAILED"; at: string; stage?: ProviderInvocationStage; invocationId?: string }>;
  runtimeProvenance: RuntimeProvenance;
};

const emptyCounters = (): ProviderCounters => ({ attempted: 0, started: 0, responseReceived: 0, structuredParsePassed: 0, semanticAdmissionPassed: 0, completed: 0, failed: 0 });

const initialRecord = (input: ArchitectureReviewInput, correlationId: string, runtimeProvenance: RuntimeProvenance): RecordState => ({
  schemaVersion: 1,
  attemptId: randomUUID(),
  correlationId,
  operationId: input.idempotencyKey,
  operationKind: "ARCHITECTURE_REVIEW",
  projectId: input.projectId,
  phase: "ARCHITECTURE_REVIEW",
  stage: "WORKBENCH_DISPATCH",
  providerContract: null,
  providerCallsTotal: 0,
  providerCallsByStage: { decomposition: emptyCounters(), coverage: emptyCounters(), "architecture-review": emptyCounters() },
  providerInvocationState: null,
  providerDiagnostic: null,
  providerInvocations: [],
  canonicalPlanningPersisted: false,
  canonicalArchitecturePersisted: false,
  lifecycleMutated: false,
  currentness: { projectVersion: input.projectVersion, rowVersion: input.expectedRowVersion, briefChecksum: input.approvedBriefChecksum, acceptedPlanningChecksum: input.acceptedPlanningChecksum },
  failureClass: null,
  outerCode: null,
  reasonCode: null,
  safeErrorFingerprint: null,
  attemptCreatedAt: new Date().toISOString(),
  reservedAt: null,
  executionStartedAt: null,
  completedAt: null,
  failedAt: null,
  failureStage: null,
  attemptTimeline: [{ type: "ATTEMPT_CREATED", at: new Date().toISOString() }],
  runtimeProvenance,
});

const safeCode = (error: unknown) => {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(error.code)) return error.code;
  if (error instanceof Error) {
    const candidate = error.message.split(":", 1)[0];
    if (/^[A-Z][A-Z0-9_]+$/.test(candidate)) return candidate;
  }
  return undefined;
};

function hasErrorCode(error: unknown, code: string, depth = 0): boolean {
  if (depth > 6 || !error || typeof error !== "object") return false;
  const value = error as { code?: unknown; cause?: unknown };
  return value.code === code || hasErrorCode(value.cause, code, depth + 1);
}

function safeErrorClass(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "UnknownError";
}

/** Durable, one-call Workbench accounting for the Architecture Review boundary. */
export class ArchitectureReviewOperationLedger implements ProviderInvocationLedgerPort {
  private record: RecordState;
  private readonly operation = "workbench.architecture-review";
  private readonly attemptOperation = "workbench.architecture-review.attempt";
  private readonly key: string;
  private readonly payloadHash: string;
  private reserved = false;
  private attemptEvidencePersisted = false;

  constructor(private readonly database: PersistenceDatabase, input: ArchitectureReviewInput, correlationId: string = randomUUID(), runtimeProvenance: RuntimeProvenance = currentRuntimeProvenance(), private readonly responseSink?: { metadata?: WorkbenchResponseMetadata }) {
    this.record = initialRecord(input, correlationId, runtimeProvenance);
    this.key = input.projectId;
    this.payloadHash = checksumPersistedDocument({ action: "generate-architecture-review", projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: input.approvedBriefChecksum, acceptedPlanningChecksum: input.acceptedPlanningChecksum, policyVersion: input.factoryArchitecturePolicy.policyVersion, providerContract: "architecture-review-result", expectedRowVersion: input.expectedRowVersion });
  }

  private appendTimeline(type: RecordState["attemptTimeline"][number]["type"], stage?: ProviderInvocationStage, invocationId?: string) {
    const event = { type, at: new Date().toISOString(), ...(stage ? { stage } : {}), ...(invocationId ? { invocationId } : {}) };
    this.record.attemptTimeline = [...this.record.attemptTimeline, event].slice(-64);
  }

  private publishResponse(responseOrigin: WorkbenchResponseOrigin, attemptStatus: "IN_PROGRESS" | "SUCCEEDED" | "FAILED" = "IN_PROGRESS") {
    if (!this.responseSink) return;
    this.responseSink.metadata = {
      schemaVersion: 1,
      responseOrigin,
      attemptCreated: this.reserved,
      ...(this.reserved ? { operationId: this.record.operationId, attemptId: this.record.attemptId, attemptStatus } : {}),
      correlationId: this.record.correlationId,
      runtimeProvenance: this.record.runtimeProvenance,
    };
  }

  private attemptKey() { return `${this.record.operationId}:${this.record.attemptId}`; }

  private attemptPayloadHash() {
    return checksumPersistedDocument({ operationId: this.record.operationId, attemptId: this.record.attemptId, projectId: this.record.projectId, correlationId: this.record.correlationId, currentness: this.record.currentness });
  }

  private async persistAttemptTerminal(status: "SUCCEEDED" | "FAILED") {
    if (!this.reserved || this.attemptEvidencePersisted) return;
    const key = this.attemptKey();
    const payloadHash = this.attemptPayloadHash();
    const result = structuredClone(this.record);
    try {
      await this.database.transaction(async (tx) => {
        if (await tx.getOperation({ operation: this.attemptOperation, key })) return;
        const reservation = await tx.reserveOperation({ operation: this.attemptOperation, key, payloadHash, initialResult: result });
        if (reservation.status === "NEW" || reservation.status === "IN_PROGRESS") {
          const terminal = status === "FAILED" ? tx.failOperation.bind(tx) : tx.completeOperation.bind(tx);
          await terminal({ operation: this.attemptOperation, key, payloadHash, result, leaseId: this.record.attemptId });
        }
      });
      this.attemptEvidencePersisted = true;
    } catch {
      // Stable operation state remains the compatibility path if history cannot be recorded.
    }
  }

  static async readAttemptHistory(database: PersistenceDatabase, operationId: string, limit = MAX_WORKBENCH_ATTEMPT_HISTORY): Promise<WorkbenchAttemptReadback[]> {
    const rows = await database.transaction((tx) => tx.listOperations({ operation: "workbench.architecture-review.attempt", keyPrefix: `${operationId}:`, limit }));
    return rows.map((row) => attemptReadbackFromResult({ operationId, status: row.status, result: row.result, createdAt: row.createdAt })).filter((row): row is WorkbenchAttemptReadback => row !== null);
  }

  async reserve(): Promise<OperationReservation> {
    const reservation = await this.database.transaction((tx) => tx.reserveOperation({ operation: this.operation, key: this.key, payloadHash: this.payloadHash, initialResult: this.record }));
    if (reservation.status === "IN_PROGRESS") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_IN_PROGRESS", "A current Architecture Review operation is already active.");
    if (reservation.status === "SUCCEEDED") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_REPLAY", "The current Architecture Review operation was already completed.");
    this.reserved = true;
    this.record.reservedAt = new Date().toISOString();
    this.record.executionStartedAt = new Date().toISOString();
    this.appendTimeline("ATTEMPT_RESERVED");
    this.appendTimeline("EXECUTION_STARTED");
    await this.persist();
    this.publishResponse("NEW_EXECUTION");
    return reservation;
  }

  private async persist() {
    if (!this.reserved) throw new Error("WORKBENCH_OPERATION_NOT_RESERVED");
    await this.database.transaction((tx) => tx.updateOperationResult({ operation: this.operation, key: this.key, payloadHash: this.payloadHash, result: structuredClone(this.record), leaseId: this.record.attemptId }));
  }

  async setStage(stage: WorkbenchOperationStage) {
    this.record.stage = stage;
    await this.persist();
  }

  async reserveInvocation(input: { stage: ProviderInvocationStage; providerContract: string }): Promise<ProviderInvocationLedgerHandle> {
    if (!this.reserved) throw new Error("WORKBENCH_OPERATION_NOT_RESERVED");
    if (input.stage !== "architecture-review") throw new Error("WORKBENCH_PROVIDER_STAGE_INVALID");
    if (!/^[a-z0-9-]{1,100}$/.test(input.providerContract)) throw new Error("WORKBENCH_PROVIDER_CONTRACT_INVALID");
    if (this.record.providerInvocations.length > 0) throw new Error("WORKBENCH_PROVIDER_BUDGET_EXHAUSTED");
    const invocation: Invocation = { id: randomUUID(), stage: input.stage, providerContract: input.providerContract, state: "RESERVED" };
    this.record.providerContract = input.providerContract;
    this.record.providerInvocationState = "RESERVED";
    this.record.providerInvocations = [...this.record.providerInvocations, invocation];
    this.appendTimeline("PROVIDER_STAGE_RESERVED", input.stage, invocation.id);
    await this.persist();
    const transition = async (state: ProviderInvocationLedgerState) => {
      const current = this.record.providerInvocations.find((candidate) => candidate.id === invocation.id);
      if (!current || current.state === "FAILED") return;
      const rank: Record<ProviderInvocationLedgerState, number> = { RESERVED: 0, ATTEMPTING: 1, TRANSPORT_STARTED: 2, RESPONSE_RECEIVED: 3, PARSE_PASSED: 4, ADMISSION_PASSED: 5, FAILED: 6 };
      if (state !== "FAILED" && rank[state] <= rank[current.state]) return;
      current.state = state;
      this.record.providerInvocationState = state;
      const timelineType = state === "TRANSPORT_STARTED" ? "PROVIDER_STAGE_STARTED" : state === "RESPONSE_RECEIVED" ? "PROVIDER_STAGE_RESPONSE_RECEIVED" : state === "PARSE_PASSED" ? "PROVIDER_STAGE_PARSE_PASSED" : state === "ADMISSION_PASSED" ? "PROVIDER_STAGE_ADMISSION_PASSED" : state === "FAILED" ? "PROVIDER_STAGE_FAILED" : undefined;
      if (timelineType) this.appendTimeline(timelineType, invocation.stage, invocation.id);
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
    return structuredClone({ providerCallsTotal: this.record.providerCallsTotal, providerCallsByStage: this.record.providerCallsByStage, ...(this.record.providerInvocationState ? { providerInvocationState: this.record.providerInvocationState } : {}) });
  }

  async recordProviderDiagnostic(diagnostic: ProviderDiagnostic, parseStatus: ProviderTerminationParseStatus, failureDiagnostic?: ProviderFailureDiagnostic) {
    if (!this.reserved || parseStatus === "PASSED") return;
    const parsed = failureDiagnostic ? ProviderFailureDiagnosticSchema.safeParse(failureDiagnostic) : null;
    this.record.providerDiagnostic = parsed?.success
      ? parsed.data
      : createProviderFailureDiagnostic({
        errorCode: "AI_OUTPUT_INVALID",
        model: "unknown",
        schemaName: diagnostic.schemaName ?? this.record.providerContract ?? "architecture-review-result",
        requestAttempted: diagnostic.requestAttempted,
        diagnostic,
      });
    await this.persist();
  }

  async markCanonicalArchitecturePersisted(lifecycleMutated: boolean) {
    this.record.canonicalArchitecturePersisted = true;
    this.record.lifecycleMutated = lifecycleMutated;
    await this.persist();
  }

  async complete() {
    this.record.stage = "LIFECYCLE_TRANSITION";
    this.record.completedAt = new Date().toISOString();
    this.appendTimeline("EXECUTION_SUCCEEDED");
    await this.database.transaction((tx) => tx.completeOperation({ operation: this.operation, key: this.key, payloadHash: this.payloadHash, result: structuredClone(this.record), leaseId: this.record.attemptId }));
    await this.persistAttemptTerminal("SUCCEEDED");
    this.publishResponse("NEW_EXECUTION", "SUCCEEDED");
  }

  async fail(error: unknown): Promise<WorkbenchOperationFailure> {
    const code = safeCode(error) ?? "WORKBENCH_INTERNAL_ERROR";
    const operationStage = hasErrorCode(error, "PERSISTENCE_COMMIT_AMBIGUOUS") ? "PERSISTENCE" : this.record.stage;
    const failureClass = code === "WORKBENCH_INTERNAL_ERROR" ? "UNEXPECTED_EXCEPTION" : "KNOWN_WORKFLOW_FAILURE";
    const safeErrorFingerprint = safeOperationFingerprint(error, operationStage);
    const providerDiagnostic = providerFailureDiagnosticFromError(error)
      ?? this.record.providerDiagnostic
      ?? (this.reserved && this.record.providerCallsTotal > 0
        ? ProviderFailureDiagnosticSchema.parse({
          version: 1,
          category: "UNKNOWN",
          stage: operationStage === "PROVIDER_TRANSPORT" ? "REQUEST_TRANSPORT" : "UNKNOWN",
          requestAttempted: true,
          responseReceived: false,
          structuredParsingReached: false,
          retryabilityHint: false,
          provider: "openai",
          sdkErrorClass: safeErrorClass(error),
          ...(safeCode(error) ? { errorCode: safeCode(error) } : {}),
          ...(this.record.providerContract ? { schemaName: this.record.providerContract } : {}),
        })
        : undefined);
    const mutationAmbiguous = hasErrorCode(error, "PERSISTENCE_COMMIT_AMBIGUOUS");
    this.record = { ...this.record, stage: operationStage, failureStage: operationStage, failureClass, outerCode: code, reasonCode: code, safeErrorFingerprint, providerDiagnostic: providerDiagnostic ?? this.record.providerDiagnostic, canonicalArchitecturePersisted: this.record.canonicalArchitecturePersisted || mutationAmbiguous, lifecycleMutated: this.record.lifecycleMutated || mutationAmbiguous };
    if (this.reserved) { this.record.failedAt = new Date().toISOString(); this.appendTimeline("EXECUTION_FAILED"); }
    const details: WorkbenchOperationFailureDetails = {
      correlationId: this.record.correlationId,
      ...(this.reserved ? { attemptId: this.record.attemptId } : {}),
      operationId: this.record.operationId,
      operationKind: this.record.operationKind,
      projectId: this.record.projectId,
      phase: this.record.phase,
      operationStage,
      failureClass,
      outerCode: code,
      reasonCode: code,
      safeErrorFingerprint,
      ...(this.record.providerContract ? { providerContract: this.record.providerContract } : {}),
      ...(this.record.providerDiagnostic ? { providerDiagnostic: this.record.providerDiagnostic } : {}),
      providerCallsTotal: this.record.providerCallsTotal,
      providerCallsByStage: structuredClone(this.record.providerCallsByStage),
      ...(this.record.providerInvocationState ? { providerInvocationState: this.record.providerInvocationState } : {}),
      canonicalPlanningPersisted: false,
      canonicalArchitecturePersisted: this.record.canonicalArchitecturePersisted,
      lifecycleMutated: this.record.lifecycleMutated,
      ...(failureClass === "UNEXPECTED_EXCEPTION" ? { internalClassification: "UNEXPECTED_EXCEPTION" as const } : {}),
      responseOrigin: this.reserved ? "NEW_EXECUTION" : "PREFLIGHT_REJECTION",
      attemptCreated: this.reserved,
      ...(this.reserved ? { attemptStatus: "FAILED" as const } : {}),
      runtimeProvenance: this.record.runtimeProvenance,
    };
    try {
      if (this.reserved) await this.database.transaction((tx) => tx.failOperation({ operation: this.operation, key: this.key, payloadHash: this.payloadHash, result: structuredClone(this.record), leaseId: this.record.attemptId }));
    } catch {
      // Keep the bounded safe envelope even if failure recording is unavailable.
    }
    await this.persistAttemptTerminal("FAILED");
    this.publishResponse(details.responseOrigin, "FAILED");
    const message = details.canonicalArchitecturePersisted || details.lifecycleMutated ? "The Workbench Architecture Review operation reached a mutation boundary; inspect the current project state before retrying." : "The Workbench Architecture Review operation failed safely; the project was not changed.";
    return new WorkbenchOperationFailure(details, message, error);
  }
}

export function readWorkbenchArchitectureReviewAttemptHistory(database: PersistenceDatabase, operationId: string, limit = MAX_WORKBENCH_ATTEMPT_HISTORY) {
  return ArchitectureReviewOperationLedger.readAttemptHistory(database, operationId, limit);
}
