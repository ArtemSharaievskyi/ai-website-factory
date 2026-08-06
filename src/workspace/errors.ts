export type WorkspaceErrorCode =
  | "WORKSPACE_ROOT_INVALID" | "WORKSPACE_PROJECT_EXISTS" | "WORKSPACE_PROJECT_NOT_FOUND"
  | "WORKSPACE_VERSION_EXISTS" | "WORKSPACE_VERSION_NOT_FOUND" | "WORKSPACE_VERSION_RESERVED"
  | "WORKSPACE_STAGING_FAILED" | "WORKSPACE_PROMOTION_FAILED" | "WORKSPACE_CROSS_DEVICE_MOVE"
  | "WORKSPACE_INTEGRITY_FAILED" | "WORKSPACE_IMMUTABLE" | "WORKSPACE_LOCKED" | "WORKSPACE_CLEANUP_FAILED"
  | "MEMORY_SYNC_CHECKSUM_MISMATCH" | "MEMORY_SYNC_DOCUMENT_MISSING" | "MEMORY_SYNC_SCHEMA_MISMATCH" | "MEMORY_SYNC_VERSION_IMMUTABLE" | "MEMORY_SYNC_CONFLICT"
  | "WORKSPACE_TEST_ROOT_REJECTED" | "WORKSPACE_RECONCILIATION_REQUIRED";

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly details?: Record<string, string | number | boolean>;
  readonly cause?: unknown;
  constructor(code: WorkspaceErrorCode, message: string, details?: Record<string, string | number | boolean>, cause?: unknown) { super(message); this.name = "WorkspaceError"; this.code = code; this.details = details; this.cause = cause; }
}

export function serializeWorkspaceError(error: unknown) { if (error instanceof WorkspaceError) return { code: error.code, message: error.message, details: error.details }; return { code: "WORKSPACE_INTEGRITY_FAILED" as const, message: "The workspace operation could not be completed." }; }
