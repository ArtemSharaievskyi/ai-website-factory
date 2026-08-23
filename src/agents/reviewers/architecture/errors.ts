import { PersistenceError } from "@/persistence/database/errors";

export type ArchitectureReviewErrorCode = "ARCHITECTURE_REVIEW_INPUT_INVALID" | "ARCHITECTURE_REVIEW_BLOCKED" | "ARCHITECTURE_REVIEW_CHANGES_REQUIRED" | "ARCHITECTURE_REVIEW_PROVIDER_FAILED" | "ARCHITECTURE_REVIEW_OUTPUT_INVALID" | "ARCHITECTURE_REVIEW_EXHAUSTED" | "ARCHITECTURE_REVIEW_STALE" | "ARCHITECTURE_REVIEW_WORKFLOW_INVALID" | "ARCHITECTURE_REVIEW_IDEMPOTENCY_CONFLICT" | "ARCHITECTURE_REVIEW_PROJECTION_FAILED";
export class ArchitectureReviewError extends Error { constructor(readonly code: ArchitectureReviewErrorCode, message: string, readonly cause?: unknown) { super(message); this.name = "ArchitectureReviewError"; } }

export function rethrowWrappedArchitectureReviewError(error: unknown): never {
  if (error instanceof PersistenceError && error.cause instanceof ArchitectureReviewError)
    throw error.cause;
  throw error;
}
