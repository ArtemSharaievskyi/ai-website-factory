export type SkillErrorCode =
  | "SKILL_NOT_FOUND"
  | "SKILL_NOT_APPROVED"
  | "SKILL_REVOKED"
  | "SKILL_SUPERSEDED"
  | "SKILL_CHECKSUM_MISMATCH"
  | "SKILL_ROLE_NOT_ALLOWED"
  | "SKILL_TASK_NOT_ALLOWED"
  | "SKILL_TOOL_NOT_ALLOWED"
  | "SKILL_NOT_ALLOWED_FOR_AGENT"
  | "SKILL_CONTEXT_LIMIT_EXCEEDED"
  | "SKILL_SOURCE_INVALID"
  | "SKILL_REVIEW_BLOCKED"
  | "SKILL_APPROVAL_REQUIRED"
  | "SKILL_IMMUTABLE"
  | "SKILL_PATH_INVALID"
  | "SKILL_LIMIT_EXCEEDED"
  | "SKILL_IDEMPOTENCY_CONFLICT"
  | "SKILLS_SH_SOURCE_UNAVAILABLE"
  | "SKILLS_SH_AUTH_REQUIRED"
  | "SKILLS_SH_AUTH_INVALID"
  | "SKILLS_SH_ACCESS_FORBIDDEN"
  | "SKILLS_SH_RATE_LIMITED"
  | "SKILLS_SH_NETWORK_FAILED"
  | "SKILLS_SH_REQUEST_TIMEOUT"
  | "SKILLS_SH_API_CONTRACT_MISMATCH"
  | "SKILLS_SH_RESPONSE_INVALID"
  | "SKILLS_SH_RESPONSE_TOO_LARGE"
  | "SKILLS_SH_UNSAFE_REDIRECT"
  | "SKILLS_SH_CONTENT_INVALID"
  | "SKILL_IMPORT_REJECTED";

export class SkillError extends Error {
  readonly code: SkillErrorCode;
  readonly details?: Record<string, string | number | boolean>;
  readonly cause?: unknown;
  constructor(
    code: SkillErrorCode,
    message: string,
    details?: Record<string, string | number | boolean>,
    cause?: unknown,
  ) {
    super(message);
    this.name = "SkillError";
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

export function serializeSkillError(error: unknown) {
  if (error instanceof SkillError)
    return { code: error.code, message: error.message };
  return {
    code: "SKILL_SOURCE_INVALID" as const,
    message: "The skill operation could not be completed.",
  };
}
