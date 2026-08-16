export type BriefV3TransactionErrorCode = "IN_PROGRESS_DUPLICATE" | "STALE_BEFORE_PROVIDER" | "STALE_BEFORE_COMMIT" | "PROVIDER_FAILED" | "PROVIDER_REFUSED" | "PROVIDER_INVALID_OUTPUT" | "CHANGESET_INVALID" | "REDUCTION_FAILED" | "INVARIANT_FAILED" | "PERSISTENCE_FAILED" | "COMMITTED_REPLAY" | "REJECTED_INVALID" | "REJECTED_STALE";

export class BriefV3TransactionError extends Error {
  readonly name = "BriefV3TransactionError";

  constructor(readonly code: BriefV3TransactionErrorCode, readonly details: Readonly<Record<string, string | number | boolean>> = {}) {
    super(code);
  }
}
