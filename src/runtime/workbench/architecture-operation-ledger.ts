import { randomUUID } from "node:crypto";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { PersistenceDatabase, OperationReservation } from "@/persistence/database/types";
import type { ArchitectureReviewInput } from "@/agents/reviewers/architecture/contracts";
import type { ProviderInvocationLedgerHandle, ProviderInvocationLedgerPort, ProviderInvocationLedgerState, ProviderInvocationStage } from "@/integrations/openai/usage";
import { WorkbenchOperationFailure, type WorkbenchOperationFailureDetails, type WorkbenchOperationStage } from "./operation-context";
import { WorkbenchOperationConflict, safeOperationFingerprint } from "./operation-ledger";

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
  providerInvocations: Invocation[];
  canonicalPlanningPersisted: false;
  canonicalArchitecturePersisted: boolean;
  lifecycleMutated: boolean;
  currentness: { projectVersion: number; rowVersion: number; briefChecksum: string; acceptedPlanningChecksum: string };
  failureClass: string | null;
  outerCode: string | null;
  reasonCode: string | null;
  safeErrorFingerprint: string | null;
};

const emptyCounters = (): ProviderCounters => ({ attempted: 0, started: 0, responseReceived: 0, structuredParsePassed: 0, semanticAdmissionPassed: 0, completed: 0, failed: 0 });

const initialRecord = (input: ArchitectureReviewInput, correlationId: string): RecordState => ({
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
  providerInvocations: [],
  canonicalPlanningPersisted: false,
  canonicalArchitecturePersisted: false,
  lifecycleMutated: false,
  currentness: { projectVersion: input.projectVersion, rowVersion: input.expectedRowVersion, briefChecksum: input.approvedBriefChecksum, acceptedPlanningChecksum: input.acceptedPlanningChecksum },
  failureClass: null,
  outerCode: null,
  reasonCode: null,
  safeErrorFingerprint: null,
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

/** Durable, one-call Workbench accounting for the Architecture Review boundary. */
export class ArchitectureReviewOperationLedger implements ProviderInvocationLedgerPort {
  private record: RecordState;
  private readonly operation = "workbench.architecture-review";
  private readonly key: string;
  private readonly payloadHash: string;
  private reserved = false;

  constructor(private readonly database: PersistenceDatabase, input: ArchitectureReviewInput, correlationId: string = randomUUID()) {
    this.record = initialRecord(input, correlationId);
    this.key = input.projectId;
    this.payloadHash = checksumPersistedDocument({ action: "generate-architecture-review", projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: input.approvedBriefChecksum, acceptedPlanningChecksum: input.acceptedPlanningChecksum, policyVersion: input.factoryArchitecturePolicy.policyVersion, providerContract: "architecture-review-result", expectedRowVersion: input.expectedRowVersion });
  }

  async reserve(): Promise<OperationReservation> {
    const reservation = await this.database.transaction((tx) => tx.reserveOperation({ operation: this.operation, key: this.key, payloadHash: this.payloadHash, initialResult: this.record }));
    if (reservation.status === "IN_PROGRESS") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_IN_PROGRESS", "A current Architecture Review operation is already active.");
    if (reservation.status === "SUCCEEDED") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_REPLAY", "The current Architecture Review operation was already completed.");
    this.reserved = true;
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
    return structuredClone({ providerCallsTotal: this.record.providerCallsTotal, providerCallsByStage: this.record.providerCallsByStage, ...(this.record.providerInvocationState ? { providerInvocationState: this.record.providerInvocationState } : {}) });
  }

  async markCanonicalArchitecturePersisted(lifecycleMutated: boolean) {
    this.record.canonicalArchitecturePersisted = true;
    this.record.lifecycleMutated = lifecycleMutated;
    await this.persist();
  }

  async complete() {
    this.record.stage = "LIFECYCLE_TRANSITION";
    await this.database.transaction((tx) => tx.completeOperation({ operation: this.operation, key: this.key, payloadHash: this.payloadHash, result: structuredClone(this.record), leaseId: this.record.attemptId }));
  }

  async fail(error: unknown): Promise<WorkbenchOperationFailure> {
    const code = safeCode(error) ?? "WORKBENCH_INTERNAL_ERROR";
    const operationStage = hasErrorCode(error, "PERSISTENCE_COMMIT_AMBIGUOUS") ? "PERSISTENCE" : this.record.stage;
    const failureClass = code === "WORKBENCH_INTERNAL_ERROR" ? "UNEXPECTED_EXCEPTION" : "KNOWN_WORKFLOW_FAILURE";
    const safeErrorFingerprint = safeOperationFingerprint(error, operationStage);
    const mutationAmbiguous = hasErrorCode(error, "PERSISTENCE_COMMIT_AMBIGUOUS");
    this.record = { ...this.record, stage: operationStage, failureClass, outerCode: code, reasonCode: code, safeErrorFingerprint, canonicalArchitecturePersisted: this.record.canonicalArchitecturePersisted || mutationAmbiguous, lifecycleMutated: this.record.lifecycleMutated || mutationAmbiguous };
    const details: WorkbenchOperationFailureDetails = {
      correlationId: this.record.correlationId,
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
      providerCallsTotal: this.record.providerCallsTotal,
      providerCallsByStage: structuredClone(this.record.providerCallsByStage),
      ...(this.record.providerInvocationState ? { providerInvocationState: this.record.providerInvocationState } : {}),
      canonicalPlanningPersisted: false,
      canonicalArchitecturePersisted: this.record.canonicalArchitecturePersisted,
      lifecycleMutated: this.record.lifecycleMutated,
      ...(failureClass === "UNEXPECTED_EXCEPTION" ? { internalClassification: "UNEXPECTED_EXCEPTION" as const } : {}),
    };
    try {
      if (this.reserved) await this.database.transaction((tx) => tx.failOperation({ operation: this.operation, key: this.key, payloadHash: this.payloadHash, result: structuredClone(this.record), leaseId: this.record.attemptId }));
    } catch {
      // Keep the bounded safe envelope even if failure recording is unavailable.
    }
    const message = details.canonicalArchitecturePersisted || details.lifecycleMutated ? "The Workbench Architecture Review operation reached a mutation boundary; inspect the current project state before retrying." : "The Workbench Architecture Review operation failed safely; the project was not changed.";
    return new WorkbenchOperationFailure(details, message, error);
  }
}
