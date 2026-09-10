export type SafeRepairErrorCode = "REPAIR_INVALID_STATUS_TRANSITION" | "REPAIR_INTENT_REQUIRED" | "REPAIR_BASELINE_REQUIRED" | "REPAIR_BASELINE_STALE" | "REPAIR_SCOPE_EXCEEDED" | "REPAIR_TARGET_PROOF_FAILED" | "REPAIR_INTEGRATION_BLOCKED" | "REPAIR_PROVIDER_BUDGET_EXCEEDED" | "REPAIR_WORKSPACE_BINDING_INVALID" | "REPAIR_INCIDENT_MISMATCH";

export class SafeRepairError extends Error {
  constructor(readonly code: SafeRepairErrorCode | string, message: string, readonly details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "SafeRepairError";
  }
}
