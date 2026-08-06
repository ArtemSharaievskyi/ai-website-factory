export type AiProviderErrorCode = "AI_OUTPUT_INVALID" | "AI_OUTPUT_TRUNCATED" | "AI_OUTPUT_REFUSED" | "AI_OUTPUT_SCHEMA_MISMATCH" | "AI_PROVIDER_UNAVAILABLE" | "AI_RATE_LIMITED" | "AI_REQUEST_TIMEOUT" | "AI_AUTHENTICATION_FAILED" | "AI_CONFIGURATION_INVALID" | "AI_RETRY_EXHAUSTED" | "AI_REQUEST_CANCELLED" | "AI_CONCURRENCY_LIMIT_REACHED" | "AI_IDEMPOTENCY_CONFLICT";

export class AiProviderError extends Error {
  constructor(public readonly code: AiProviderErrorCode, message: string, public readonly cause?: unknown) { super(message); this.name = "AiProviderError"; }
}

export function isAiProviderError(error: unknown): error is AiProviderError { return error instanceof AiProviderError; }
