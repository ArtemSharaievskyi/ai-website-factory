import type { ProviderDiagnostic } from "./usage";

export type AiProviderErrorCode = "AI_OUTPUT_INVALID" | "AI_OUTPUT_TRUNCATED" | "AI_OUTPUT_REFUSED" | "AI_OUTPUT_SCHEMA_MISMATCH" | "AI_OUTPUT_NO_PARSED_OUTPUT" | "AI_OUTPUT_DOMAIN_INVALID" | "AI_STRUCTURED_PARSE_FAILED" | "AI_PROVIDER_UNAVAILABLE" | "AI_RATE_LIMITED" | "AI_REQUEST_TIMEOUT" | "AI_AUTHENTICATION_FAILED" | "AI_MODEL_ACCESS_FAILED" | "AI_CONFIGURATION_INVALID" | "AI_REQUEST_INVALID" | "AI_REQUEST_SCHEMA_INVALID" | "AI_REQUEST_PARAMETER_UNSUPPORTED" | "AI_NETWORK_ERROR" | "AI_RETRY_EXHAUSTED" | "AI_REQUEST_CANCELLED" | "AI_CONCURRENCY_LIMIT_REACHED" | "AI_IDEMPOTENCY_CONFLICT" | "AI_REQUEST_CONTEXT_CAPACITY_EXCEEDED";

export class AiProviderError extends Error {
  constructor(public readonly code: AiProviderErrorCode, message: string, public readonly cause?: unknown, public readonly diagnostic?: ProviderDiagnostic) { super(message); this.name = "AiProviderError"; }
}

export function isAiProviderError(error: unknown): error is AiProviderError { return error instanceof AiProviderError; }
