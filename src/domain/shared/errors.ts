export type DomainErrorCode =
  | "VALIDATION_FAILED"
  | "WORKFLOW_TRANSITION_INVALID"
  | "BLOCKING_CLARIFICATIONS_REMAIN"
  | "REQUIREMENTS_NOT_APPROVED"
  | "REQUIREMENTS_CHECKSUM_MISMATCH"
  | "DESIGN_DIRECTIONS_INVALID"
  | "DESIGN_NOT_SELECTED"
  | "DESIGN_CHECKSUM_MISMATCH"
  | "ARCHITECTURE_NOT_ACCEPTED"
  | "UNAPPROVED_REQUIREMENT_CHANGE"
  | "QUALITY_GATES_INCOMPLETE"
  | "KNOWN_ERRORS_REMAIN"
  | "PROJECT_VERSION_IMMUTABLE"
  | "PATH_TRAVERSAL_REJECTED"
  | "ABSOLUTE_PATH_REJECTED"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_UNKNOWN"
  | "INTEGRITY_CHECK_FAILED"
  | "SCHEMA_VERSION_MISMATCH"
  | "TASK_GRAPH_INVALID"
  | "RELEASE_INVALID";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, string | number | boolean>;
  readonly cause?: unknown;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, string | number | boolean>, cause?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

export function serializeDomainError(error: unknown) {
  if (error instanceof DomainError) return { code: error.code, message: error.message, details: error.details };
  return { code: "VALIDATION_FAILED" as const, message: "The operation could not be completed." };
}
