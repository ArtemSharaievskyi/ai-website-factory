import { ProviderFailureDiagnosticSchema, type ProviderFailureDiagnostic } from "@/domain/shared/provider-failure";
import type { AiProviderErrorCode } from "./errors";
import type { ProviderDiagnostic } from "./usage";

type ProviderFailureDiagnosticInput = {
  errorCode: AiProviderErrorCode;
  model: string;
  schemaName: string;
  requestAttempted: boolean;
  diagnostic?: ProviderDiagnostic;
  error?: unknown;
};

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

function categoryFor(input: ProviderFailureDiagnosticInput, status: number | undefined, providerErrorCode: string | undefined): ProviderFailureDiagnostic["category"] {
  if (status === 401 || status === 403 || input.errorCode === "AI_AUTHENTICATION_FAILED") return "AUTHENTICATION";
  if (status === 404 || input.errorCode === "AI_MODEL_ACCESS_FAILED") return "MODEL_ACCESS";
  if (status === 429 || input.errorCode === "AI_RATE_LIMITED") return "RATE_LIMIT";
  if (status !== undefined && status >= 500 || input.errorCode === "AI_PROVIDER_UNAVAILABLE") return "PROVIDER_UNAVAILABLE";
  if (input.errorCode === "AI_REQUEST_TIMEOUT" || providerErrorCode === "ETIMEDOUT") return "TIMEOUT";
  if (input.errorCode === "AI_REQUEST_CANCELLED" || input.diagnostic?.sdkErrorClass === "AbortError") return "CANCELLED";
  if (input.errorCode === "AI_NETWORK_ERROR" || providerErrorCode === "ECONNRESET") return "NETWORK";
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
  const providerErrorCode = safeToken(input.diagnostic?.openaiErrorCode);
  const status = safeStatus(input.diagnostic?.httpStatus);
  const category = categoryFor(input, status, providerErrorCode);
  const responseReceived = responseReceivedFor(input, category, status);
  const structuredParsingReached = structuredParsingReachedFor(input, category);
  const diagnostic = input.diagnostic;
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
