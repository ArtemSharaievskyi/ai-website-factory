import type { ContextBundle } from "@/runtime/context";
export type ProviderUsage = { inputTokens?: number; cachedInputTokens?: number; uncachedInputTokens?: number; outputTokens?: number; totalTokens?: number; actualUsageCaptured: boolean; cacheTelemetryUnavailable: boolean; requestCount: number; retryCount: number; correctionCount: number; provider: string; model: string; role: string; promptVersion: string; invocationId?: string; invocationFingerprint?: string; contextBundleId?: string; contextChecksum?: string; prefixChecksum?: string; prefixBytes?: number; contextMetrics?: ContextBundle["metrics"] };
export type ProviderDiagnosticStage = "request_construction" | "api_request" | "api_response" | "structured_parse" | "domain_validation" | "provider_normalization";
export const PROVIDER_OUTPUT_STAGES = [
  "REQUEST_SCHEMA_CONSTRUCTION_FAILED",
  "PROVIDER_REQUEST_FAILED",
  "PROVIDER_REFUSAL",
  "PROVIDER_OUTPUT_INCOMPLETE",
  "STRUCTURED_OUTPUT_PARSE_FAILED",
  "TRANSPORT_SCHEMA_VALIDATION_FAILED",
  "HOST_MAPPING_FAILED",
  "CANONICAL_BRIEF_V2_VALIDATION_FAILED",
  "REVISION_SEMANTIC_VALIDATION_FAILED",
  "BRIEF_CONTRADICTION_DETECTED",
] as const;
export type ProviderOutputStage = (typeof PROVIDER_OUTPUT_STAGES)[number];
export type ProviderDiagnostic = {
  stage: ProviderDiagnosticStage;
  outputStage?: ProviderOutputStage;
  requestAttempted: boolean;
  apiResponseReceived: boolean;
  /** Alias used by safe operational reports; it never contains response content. */
  responseReceived?: boolean;
  /** False for refusal, truncation, empty choices, or an unparsed response. */
  outputComplete?: boolean;
  tokenExhaustion?: boolean;
  httpStatus?: number;
  requestId?: string;
  sdkErrorClass?: string;
  openaiErrorType?: string;
  openaiErrorCode?: string;
  openaiErrorParam?: string;
  choicesCount?: number;
  finishReason?: string | null;
  refusalPresent?: boolean;
  parsedPresent?: boolean;
  contentPresent?: boolean;
  contentLength?: number;
  schemaName?: string;
  issueCode?: string;
  fieldPath?: string;
  issueCount?: number;
  domainValidationIssuePaths?: string[];
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  maxCompletionTokens?: number;
  contextCapacity?: { budgetProfile: string; requestBytes: number; requestTokens: number; totalBytesWithReserve: number; totalTokensWithReserve: number; maxBytes: number; maxTokens: number; canonicalRequirementBytes: number; supportingContextBytes: number };
};
export type SafeProviderEvent = { type: "request.started" | "request.completed" | "request.failed"; provider: string; model: string; role: string; promptVersion: string; requestId?: string; code?: string; retryCount?: number; startedAt?: string; completedAt?: string; elapsedMs?: number; diagnostic?: ProviderDiagnostic };
export type ProviderEventSink = (event: SafeProviderEvent) => void;
export type ProviderUsageSink = (usage: ProviderUsage) => void | Promise<void>;
