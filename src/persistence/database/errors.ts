export type PersistenceErrorCode =
  | "PERSISTENCE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "PERSISTENCE_NOT_FOUND"
  | "PERSISTENCE_VALIDATION_FAILED"
  | "PERSISTENCE_PROVIDER_ERROR"
  | "PERSISTENCE_IMMUTABLE"
  | "PERSISTENCE_UNSUPPORTED";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly details?: Record<string, string | number | boolean>;
  readonly cause?: unknown;

  constructor(code: PersistenceErrorCode, message: string, details?: Record<string, string | number | boolean>, cause?: unknown) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

export function serializePersistenceError(error: unknown) {
  if (error instanceof PersistenceError) return { code: error.code, message: error.message, details: error.details };
  return { code: "PERSISTENCE_PROVIDER_ERROR" as const, message: "The persistence operation could not be completed." };
}
