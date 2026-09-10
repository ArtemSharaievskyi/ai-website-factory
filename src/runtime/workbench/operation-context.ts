import { AsyncLocalStorage } from "node:async_hooks";
import type { ProviderInvocationLedgerPort, ProviderInvocationLedgerState } from "@/integrations/openai/usage";
import type { PlanningAdmissionBoundary, PlanningFinalAdmissionDiagnostics } from "@/agents/planner/final-admission-diagnostics";
import type { ProviderFailureDiagnostic } from "@/domain/shared/provider-failure";

export const WORKBENCH_OPERATION_STAGES = [
  "WORKBENCH_DISPATCH",
  "OPERATION_INITIALIZATION",
  "PREFLIGHT",
  "PROVIDER_TRANSPORT",
  "DECOMPOSITION",
  "GRAPH",
  "COVERAGE",
  "FINAL_ASSEMBLY",
  "PERSISTENCE",
  "LIFECYCLE_TRANSITION",
  "RESPONSE_SERIALIZATION",
] as const;
export type WorkbenchOperationStage = (typeof WORKBENCH_OPERATION_STAGES)[number];

export type WorkbenchOperationFailureDetails = {
  correlationId: string;
  operationId: string;
  operationKind: string;
  projectId: string;
  phase: "PLANNING" | "ARCHITECTURE_REVIEW";
  operationStage: WorkbenchOperationStage;
  failureClass: string;
  outerCode: string;
  boundary?: PlanningAdmissionBoundary;
  reasonCode?: string;
  safeErrorFingerprint: string;
  providerContract?: string;
  providerDiagnostic?: ProviderFailureDiagnostic;
  providerCallsTotal: number;
  providerCallsByStage: Record<string, {
    attempted: number;
    started: number;
    responseReceived: number;
    structuredParsePassed: number;
    semanticAdmissionPassed: number;
    completed: number;
    failed: number;
  }>;
  providerInvocationState?: ProviderInvocationLedgerState;
  canonicalPlanningPersisted: boolean;
  canonicalArchitecturePersisted?: boolean;
  lifecycleMutated: boolean;
  stagedStage?: string;
  finalAdmissionDiagnostics?: PlanningFinalAdmissionDiagnostics;
  stagedOperation?: unknown;
  internalClassification?: "UNEXPECTED_EXCEPTION";
};

export class WorkbenchOperationFailure extends Error {
  readonly code: string;
  constructor(readonly details: WorkbenchOperationFailureDetails, message = "The Workbench operation failed safely.", cause?: unknown) {
    super(message, { cause });
    this.name = "WorkbenchOperationFailure";
    this.code = details.outerCode;
  }
}

export function isWorkbenchOperationFailure(error: unknown): error is WorkbenchOperationFailure {
  return error instanceof WorkbenchOperationFailure;
}

export type WorkbenchOperationContext = {
  correlationId: string;
  operationId?: string;
  operationKind?: string;
  projectId?: string;
  phase?: "PLANNING" | "ARCHITECTURE_REVIEW";
  stage?: WorkbenchOperationStage;
  providerInvocationLedger?: ProviderInvocationLedgerPort;
  bindCurrentness?: (input: { projectVersion: number; rowVersion: number; briefChecksum: string }) => void | Promise<void>;
  setStage?: (stage: WorkbenchOperationStage) => void | Promise<void>;
  markMutationCommitted?: () => void | Promise<void>;
};

const operationContext = new AsyncLocalStorage<WorkbenchOperationContext>();

export function withWorkbenchOperationContext<T>(context: WorkbenchOperationContext, callback: () => Promise<T>) {
  return operationContext.run(context, callback);
}

export function currentWorkbenchOperationContext() {
  return operationContext.getStore();
}
