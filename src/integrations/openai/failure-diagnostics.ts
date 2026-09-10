import { KnownTransportCauseCodeSchema, ProviderFailureDiagnosticSchema, ProviderTransportElapsedBucketSchema, ProviderTransportFailureClassSchema, ProviderTransportPhaseSchema, type ProviderFailureDiagnostic } from "@/domain/shared/provider-failure";
import { isAiProviderError, type AiProviderErrorCode } from "./errors";
import type { ProviderDiagnostic } from "./usage";

type ProviderFailureDiagnosticInput = {
  errorCode: AiProviderErrorCode;
  model: string;
  schemaName: string;
  requestAttempted: boolean;
  diagnostic?: ProviderDiagnostic;
  error?: unknown;
};

const MAX_CAUSE_DEPTH = 6;

function safeTransportCauseCode(value: unknown) {
  const parsed = KnownTransportCauseCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function safeTransportPhase(value: unknown) {
  const parsed = ProviderTransportPhaseSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function safeTransportFailureClass(value: unknown) {
  const parsed = ProviderTransportFailureClassSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function safeElapsedBucket(value: unknown) {
  const parsed = ProviderTransportElapsedBucketSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function safeBoundedBytes(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 20_000_000 ? value : undefined;
}

function safeTimeout(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 86_400_000 ? value : undefined;
}

function safeRetryCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 8 ? value : undefined;
}

type TransportEvidence = { names: string[]; causeCodes: Array<NonNullable<ReturnType<typeof safeTransportCauseCode>>>; statuses: number[] };

function collectTransportEvidence(error: unknown, depth = 0, seen = new Set<object>(), evidence: TransportEvidence = { names: [], causeCodes: [], statuses: [] }): TransportEvidence {
  if (depth > MAX_CAUSE_DEPTH || !error || typeof error !== "object" || seen.has(error)) return evidence;
  seen.add(error);
  const value = error as Record<string, unknown>;
  const names = [value.name, (error as Error).constructor?.name];
  for (const name of names) if (typeof name === "string" && name.length <= 100 && !evidence.names.includes(name)) evidence.names.push(name);
  for (const candidate of [value.code, value.errno, (value.error as Record<string, unknown> | null | undefined)?.code]) {
    const code = safeTransportCauseCode(candidate);
    if (code && !evidence.causeCodes.includes(code)) evidence.causeCodes.push(code);
  }
  const status = safeStatus(value.status);
  if (status !== undefined && !evidence.statuses.includes(status)) evidence.statuses.push(status);
  collectTransportEvidence(value.cause, depth + 1, seen, evidence);
  collectTransportEvidence(value.error, depth + 1, seen, evidence);
  return evidence;
}

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);
const CONNECT_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"]);
const TLS_CODES = new Set(["ERR_TLS_HANDSHAKE_TIMEOUT", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED"]);

export function classifyProviderTransportFailure(input: Pick<ProviderFailureDiagnosticInput, "errorCode" | "requestAttempted" | "diagnostic" | "error">) {
  return transportObservation(input as ProviderFailureDiagnosticInput);
}

function transportObservation(input: ProviderFailureDiagnosticInput) {
  const diagnostic = input.diagnostic;
  const evidence = collectTransportEvidence(input.error);
  const status = safeStatus(diagnostic?.httpStatus) ?? evidence.statuses[0];
  if (status !== undefined) return { transportPhase: "RESPONSE_HEADERS" as const, transportFailureClass: "HTTP_ERROR_RESPONSE" as const };
  const structuredOutputFailure = STRUCTURED_OUTPUT_CODES.has(input.errorCode) || diagnostic?.stage === "api_response" || diagnostic?.stage === "structured_parse" || diagnostic?.stage === "domain_validation";
  const transportFailureCode = ["AI_PROVIDER_UNAVAILABLE", "AI_RATE_LIMITED", "AI_REQUEST_TIMEOUT", "AI_REQUEST_CANCELLED", "AI_NETWORK_ERROR", "AI_RETRY_EXHAUSTED"].includes(input.errorCode);
  const transportEvidencePresent = evidence.causeCodes.length > 0 || evidence.names.some((name) => name === "APIConnectionError" || name === "APIConnectionTimeoutError" || name === "APIUserAbortError" || name === "AbortError" || name === "ConnectTimeoutError" || name === "HeadersTimeoutError" || name === "BodyTimeoutError");
  if (structuredOutputFailure && !transportEvidencePresent) return undefined;
  if (!input.requestAttempted && !transportEvidencePresent) return undefined;
  if (!transportFailureCode && !transportEvidencePresent) return undefined;
  const existingClass = safeTransportFailureClass(diagnostic?.transportFailureClass);
  const existingPhase = safeTransportPhase(diagnostic?.transportPhase);
  const existingCause = safeTransportCauseCode(diagnostic?.transportCauseCode);
  if (existingClass) return { transportPhase: existingPhase ?? "UNKNOWN", transportFailureClass: existingClass, ...(existingCause ? { transportCauseCode: existingCause } : {}) };
  if (evidence.names.some((name) => name === "AbortError" || name === "APIUserAbortError") || evidence.causeCodes.includes("ABORT_ERR")) return { transportPhase: "UNKNOWN" as const, transportFailureClass: "REQUEST_ABORTED" as const, ...(evidence.causeCodes.includes("ABORT_ERR") ? { transportCauseCode: "ABORT_ERR" as const } : {}) };
  const causeCode = evidence.causeCodes.find((code) => DNS_CODES.has(code) || CONNECT_CODES.has(code) || TLS_CODES.has(code) || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ECONNRESET", "UND_ERR_SOCKET", "ERR_STREAM_PREMATURE_CLOSE"].includes(code));
  if (causeCode && DNS_CODES.has(causeCode)) return { transportPhase: "DNS" as const, transportFailureClass: "DNS_RESOLUTION_FAILED" as const, transportCauseCode: causeCode };
  if (causeCode && TLS_CODES.has(causeCode)) return { transportPhase: "TLS" as const, transportFailureClass: "TLS_HANDSHAKE_FAILED" as const, transportCauseCode: causeCode };
  if (causeCode === "UND_ERR_HEADERS_TIMEOUT" || causeCode === "UND_ERR_BODY_TIMEOUT" || evidence.names.some((name) => name === "HeadersTimeoutError" || name === "BodyTimeoutError")) return { transportPhase: "WAITING_FOR_RESPONSE" as const, transportFailureClass: "RESPONSE_TIMEOUT" as const, ...(causeCode ? { transportCauseCode: causeCode } : {}) };
  if (causeCode === "ETIMEDOUT" || causeCode === "UND_ERR_CONNECT_TIMEOUT" || evidence.names.some((name) => name === "ConnectTimeoutError" || name === "APIConnectionTimeoutError")) return { transportPhase: "CONNECT" as const, transportFailureClass: "CONNECT_TIMEOUT" as const, ...(causeCode ? { transportCauseCode: causeCode } : {}) };
  if (causeCode === "ECONNRESET" || causeCode === "UND_ERR_SOCKET") return { transportPhase: "UNKNOWN" as const, transportFailureClass: "CONNECTION_RESET" as const, transportCauseCode: causeCode };
  if (causeCode && CONNECT_CODES.has(causeCode)) return { transportPhase: "CONNECT" as const, transportFailureClass: "CONNECT_FAILED" as const, transportCauseCode: causeCode };
  if (causeCode === "ERR_STREAM_PREMATURE_CLOSE") return { transportPhase: "RESPONSE_BODY" as const, transportFailureClass: "RESPONSE_STREAM_FAILED" as const, transportCauseCode: causeCode };
  if (!input.requestAttempted && evidence.names.some((name) => name === "OpenAIError" || name === "OpenAI")) return { transportPhase: "CLIENT_INITIALIZATION" as const, transportFailureClass: "PROVIDER_CLIENT_INITIALIZATION_FAILED" as const };
  return { transportPhase: "UNKNOWN" as const, transportFailureClass: "UNKNOWN_TRANSPORT_FAILURE" as const };
}

export function providerFailureDiagnosticFromError(error: unknown, depth = 0, seen = new Set<object>()): ProviderFailureDiagnostic | undefined {
  if (depth > MAX_CAUSE_DEPTH || !error || typeof error !== "object" || seen.has(error)) return undefined;
  seen.add(error);
  if (isAiProviderError(error)) {
    const parsed = ProviderFailureDiagnosticSchema.safeParse(error.failureDiagnostic);
    if (parsed.success) return parsed.data;
  }
  const value = error as Record<string, unknown>;
  const direct = ProviderFailureDiagnosticSchema.safeParse(value.failureDiagnostic);
  if (direct.success) return direct.data;
  return providerFailureDiagnosticFromError(value.cause, depth + 1, seen);
}

const STRUCTURED_OUTPUT_CODES = new Set<AiProviderErrorCode>([
  "AI_OUTPUT_TRUNCATED",
  "AI_OUTPUT_REFUSED",
  "AI_OUTPUT_SCHEMA_MISMATCH",
  "AI_OUTPUT_NO_PARSED_OUTPUT",
  "AI_OUTPUT_DOMAIN_INVALID",
  "AI_STRUCTURED_PARSE_FAILED",
]);

const REQUEST_CONSTRUCTION_CODES = new Set<AiProviderErrorCode>([
  "AI_CONFIGURATION_INVALID",
  "AI_REQUEST_SCHEMA_INVALID",
  "AI_REQUEST_CONTEXT_CAPACITY_EXCEEDED",
]);

function safeToken(value: unknown) {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) ? value : undefined;
}

function safeMessage(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? normalized.slice(0, 500) : normalized || undefined;
}

function safeClassName(error: unknown) {
  const name = error instanceof Error && error.constructor?.name ? error.constructor.name : typeof error === "object" && error ? "SdkError" : "Error";
  return safeToken(name);
}

function safeStatus(value: unknown) {
  const status = typeof value === "number" ? value : Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function safeNonnegativeInt(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function safePositiveInt(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function safeChecksum(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

function safePath(value: unknown) {
  return typeof value === "string" && value.length >= 1 && value.length <= 240 && /^[A-Za-z0-9_$.[\]/:-]+$/.test(value) ? value : undefined;
}

function safeZodIssues(value: ProviderDiagnostic["zodIssuesBounded"]) {
  if (!Array.isArray(value)) return undefined;
  const issues = value.slice(0, 20).flatMap((issue) => {
    const path = safePath(issue?.path);
    const code = safeToken(issue?.code);
    const message = typeof issue?.message === "string" && issue.message.length >= 1 && issue.message.length <= 240 ? issue.message : undefined;
    if (!path || !code || !message) return [];
    const expected = safeToken(issue.expected);
    const received = safeToken(issue.received);
    return [{ path, code, message, ...(expected ? { expected } : {}), ...(received ? { received } : {}) }];
  });
  return issues.length ? issues : undefined;
}

function categoryFor(input: ProviderFailureDiagnosticInput, status: number | undefined, providerErrorCode: string | undefined, transportFailureClass?: ProviderFailureDiagnostic["transportFailureClass"]): ProviderFailureDiagnostic["category"] {
  if (status === 401 || status === 403 || input.errorCode === "AI_AUTHENTICATION_FAILED") return "AUTHENTICATION";
  if (status === 404 || input.errorCode === "AI_MODEL_ACCESS_FAILED") return "MODEL_ACCESS";
  if (status === 429 || input.errorCode === "AI_RATE_LIMITED") return "RATE_LIMIT";
  if (status !== undefined && status >= 500 || input.errorCode === "AI_PROVIDER_UNAVAILABLE") return "PROVIDER_UNAVAILABLE";
  if (input.errorCode === "AI_REQUEST_TIMEOUT" || providerErrorCode === "ETIMEDOUT" || transportFailureClass === "CONNECT_TIMEOUT" || transportFailureClass === "RESPONSE_TIMEOUT") return "TIMEOUT";
  if (input.errorCode === "AI_REQUEST_CANCELLED" || input.diagnostic?.sdkErrorClass === "AbortError" || transportFailureClass === "REQUEST_ABORTED") return "CANCELLED";
  if (input.errorCode === "AI_NETWORK_ERROR" || providerErrorCode === "ECONNRESET" || ["DNS_RESOLUTION_FAILED", "CONNECT_FAILED", "TLS_HANDSHAKE_FAILED", "CONNECTION_RESET", "RESPONSE_STREAM_FAILED", "UNKNOWN_TRANSPORT_FAILURE"].includes(transportFailureClass ?? "")) return "NETWORK";
  if (REQUEST_CONSTRUCTION_CODES.has(input.errorCode) || !input.requestAttempted) return "REQUEST_CONSTRUCTION";
  if (input.errorCode === "AI_REQUEST_INVALID" || input.errorCode === "AI_REQUEST_PARAMETER_UNSUPPORTED") return "REQUEST_REJECTED";
  if (STRUCTURED_OUTPUT_CODES.has(input.errorCode) || input.diagnostic?.stage === "api_response" || input.diagnostic?.stage === "structured_parse" || input.diagnostic?.stage === "domain_validation") return "STRUCTURED_OUTPUT";
  return "UNKNOWN";
}

function stageFor(input: ProviderFailureDiagnosticInput, category: ProviderFailureDiagnostic["category"]): ProviderFailureDiagnostic["stage"] {
  if (!input.requestAttempted || category === "REQUEST_CONSTRUCTION") return "REQUEST_CONSTRUCTION";
  if (input.diagnostic?.stage === "provider_normalization") return "PROVIDER_MAPPING";
  if (input.diagnostic?.stage === "api_response" || input.diagnostic?.stage === "structured_parse" || input.diagnostic?.stage === "domain_validation" || category === "STRUCTURED_OUTPUT") return "PROVIDER_RESPONSE";
  if (input.diagnostic?.stage === "api_request" || category === "AUTHENTICATION" || category === "MODEL_ACCESS" || category === "RATE_LIMIT" || category === "PROVIDER_UNAVAILABLE" || category === "NETWORK" || category === "TIMEOUT" || category === "CANCELLED" || category === "REQUEST_REJECTED") return "REQUEST_TRANSPORT";
  return "UNKNOWN";
}

function responseReceivedFor(input: ProviderFailureDiagnosticInput, category: ProviderFailureDiagnostic["category"], status: number | undefined) {
  if (!input.requestAttempted) return false;
  if (status !== undefined) return true;
  if (category === "NETWORK" || category === "TIMEOUT" || category === "CANCELLED") return false;
  if (input.diagnostic?.stage === "api_response" || input.diagnostic?.stage === "structured_parse" || input.diagnostic?.stage === "domain_validation") return input.diagnostic.responseReceived ?? input.diagnostic.apiResponseReceived;
  return undefined;
}

function structuredParsingReachedFor(input: ProviderFailureDiagnosticInput, category: ProviderFailureDiagnostic["category"]) {
  if (!input.requestAttempted || category === "REQUEST_CONSTRUCTION" || category === "AUTHENTICATION" || category === "MODEL_ACCESS" || category === "RATE_LIMIT" || category === "PROVIDER_UNAVAILABLE" || category === "NETWORK" || category === "TIMEOUT" || category === "CANCELLED" || category === "REQUEST_REJECTED") return false;
  if (category === "STRUCTURED_OUTPUT" || input.diagnostic?.stage === "api_response" || input.diagnostic?.stage === "structured_parse" || input.diagnostic?.stage === "domain_validation") return true;
  return undefined;
}

export function createProviderFailureDiagnostic(input: ProviderFailureDiagnosticInput): ProviderFailureDiagnostic {
  const transport = transportObservation(input);
  const providerErrorCode = safeToken(input.diagnostic?.openaiErrorCode);
  const status = safeStatus(input.diagnostic?.httpStatus);
  const category = categoryFor(input, status, providerErrorCode, transport?.transportFailureClass);
  const responseReceived = responseReceivedFor(input, category, status);
  const structuredParsingReached = structuredParsingReachedFor(input, category);
  const diagnostic = { ...input.diagnostic, ...(transport ?? {}) };
  const zodIssuesBounded = safeZodIssues(diagnostic?.zodIssuesBounded);
  return ProviderFailureDiagnosticSchema.parse({
    version: 1,
    category,
    stage: stageFor(input, category),
    requestAttempted: input.requestAttempted,
    ...(responseReceived === undefined ? {} : { responseReceived }),
    ...(structuredParsingReached === undefined ? {} : { structuredParsingReached }),
    retryabilityHint: ["AI_PROVIDER_UNAVAILABLE", "AI_RATE_LIMITED", "AI_NETWORK_ERROR", "AI_RETRY_EXHAUSTED"].includes(input.errorCode),
    provider: "openai",
    ...(safeToken(input.model) ? { model: safeToken(input.model) } : {}),
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(safeToken(input.diagnostic?.requestId) ? { requestId: safeToken(input.diagnostic?.requestId) } : {}),
    ...(safeToken(input.diagnostic?.sdkErrorClass) ?? safeClassName(input.error) ? { sdkErrorClass: safeToken(input.diagnostic?.sdkErrorClass) ?? safeClassName(input.error) } : {}),
    ...(providerErrorCode ? { providerErrorCode } : {}),
    ...(safeToken(input.diagnostic?.openaiErrorType) ? { providerErrorType: safeToken(input.diagnostic?.openaiErrorType) } : {}),
    ...(safeToken(input.diagnostic?.openaiErrorParam) ? { providerErrorParam: safeToken(input.diagnostic?.openaiErrorParam) } : {}),
    ...(safeMessage(input.diagnostic?.openaiErrorMessage) ? { safeProviderMessage: safeMessage(input.diagnostic?.openaiErrorMessage) } : {}),
    ...(transport?.transportPhase ? { transportPhase: transport.transportPhase } : {}),
    ...(transport?.transportFailureClass ? { transportFailureClass: transport.transportFailureClass } : {}),
    ...(transport?.transportCauseCode ? { transportCauseCode: transport.transportCauseCode } : {}),
    ...(safeToken(diagnostic?.endpointClass) ? { endpointClass: safeToken(diagnostic?.endpointClass) } : {}),
    ...(safeTimeout(diagnostic?.timeoutConfiguredMs) === undefined ? {} : { timeoutConfiguredMs: safeTimeout(diagnostic?.timeoutConfiguredMs) }),
    ...(safeRetryCount(diagnostic?.configuredMaxRetries) === undefined ? {} : { configuredMaxRetries: safeRetryCount(diagnostic?.configuredMaxRetries) }),
    ...(safeElapsedBucket(diagnostic?.elapsedBucket) ? { elapsedBucket: safeElapsedBucket(diagnostic?.elapsedBucket) } : {}),
    ...(safeBoundedBytes(diagnostic?.requestSizeBytes) === undefined ? {} : { requestSizeBytes: safeBoundedBytes(diagnostic?.requestSizeBytes) }),
    ...(safeBoundedBytes(diagnostic?.inputBytes) === undefined ? {} : { inputBytes: safeBoundedBytes(diagnostic?.inputBytes) }),
    ...(safeBoundedBytes(diagnostic?.schemaSizeBytes) === undefined ? {} : { schemaSizeBytes: safeBoundedBytes(diagnostic?.schemaSizeBytes) }),
    ...(safeToken(input.errorCode) ? { errorCode: safeToken(input.errorCode) } : {}),
    ...(safeToken(input.schemaName) ? { schemaName: safeToken(input.schemaName) } : {}),
    ...(safeNonnegativeInt(diagnostic?.choicesCount) === undefined ? {} : { choicesCount: safeNonnegativeInt(diagnostic?.choicesCount) }),
    ...(diagnostic?.finishReason === null ? { finishReason: null } : safeToken(diagnostic?.finishReason) ? { finishReason: safeToken(diagnostic?.finishReason) } : {}),
    ...(typeof diagnostic?.refusalPresent === "boolean" ? { refusalPresent: diagnostic.refusalPresent } : {}),
    ...(typeof diagnostic?.contentPresent === "boolean" ? { contentPresent: diagnostic.contentPresent } : {}),
    ...(typeof diagnostic?.outputComplete === "boolean" ? { outputComplete: diagnostic.outputComplete } : {}),
    ...(safeNonnegativeInt(diagnostic?.inputTokens) === undefined ? {} : { inputTokens: safeNonnegativeInt(diagnostic?.inputTokens) }),
    ...(safeNonnegativeInt(diagnostic?.outputTokens) === undefined ? {} : { outputTokens: safeNonnegativeInt(diagnostic?.outputTokens) }),
    ...(safeNonnegativeInt(diagnostic?.totalTokens) === undefined ? {} : { totalTokens: safeNonnegativeInt(diagnostic?.totalTokens) }),
    ...(safePositiveInt(diagnostic?.maxCompletionTokens) === undefined ? {} : { maxCompletionTokens: safePositiveInt(diagnostic?.maxCompletionTokens) }),
    ...(safeNonnegativeInt(diagnostic?.rawContentBytes) === undefined ? {} : { rawContentBytes: safeNonnegativeInt(diagnostic?.rawContentBytes) }),
    ...(safeChecksum(diagnostic?.rawContentChecksum) ? { rawContentChecksum: safeChecksum(diagnostic?.rawContentChecksum) } : {}),
    ...(typeof diagnostic?.jsonParseSucceeded === "boolean" ? { jsonParseSucceeded: diagnostic.jsonParseSucceeded } : {}),
    ...(safeNonnegativeInt(diagnostic?.zodIssueCount) === undefined ? {} : { zodIssueCount: safeNonnegativeInt(diagnostic?.zodIssueCount) }),
    ...(typeof diagnostic?.zodIssuesTruncated === "boolean" ? { zodIssuesTruncated: diagnostic.zodIssuesTruncated } : {}),
    ...(safeChecksum(diagnostic?.completeZodIssuesChecksum) ? { completeZodIssuesChecksum: safeChecksum(diagnostic?.completeZodIssuesChecksum) } : {}),
    ...(zodIssuesBounded ? { zodIssuesBounded } : {}),
  });
}
