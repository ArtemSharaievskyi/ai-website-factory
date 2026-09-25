import { z } from "zod";
import type { ContextBundle } from "@/runtime/context";
import type { KnownTransportCauseCode, ProviderTransportElapsedBucket, ProviderTransportFailureClass, ProviderTransportPhase } from "@/domain/shared/provider-failure";
import type { ProviderFailureDiagnostic } from "@/domain/shared/provider-failure";
export type ProviderUsage = { inputTokens?: number; cachedInputTokens?: number; uncachedInputTokens?: number; outputTokens?: number; totalTokens?: number; actualUsageCaptured: boolean; cacheTelemetryUnavailable: boolean; requestCount: number; retryCount: number; correctionCount: number; provider: string; model: string; role: string; promptVersion: string; reasoningEffort?: "xhigh"; invocationId?: string; invocationFingerprint?: string; contextBundleId?: string; contextChecksum?: string; prefixChecksum?: string; prefixBytes?: number; contextMetrics?: ContextBundle["metrics"] };
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
  /** Provider-supplied error text, normalized and capped; never a prompt or payload. */
  openaiErrorMessage?: string;
  transportPhase?: ProviderTransportPhase;
  transportFailureClass?: ProviderTransportFailureClass;
  transportCauseCode?: KnownTransportCauseCode;
  endpointClass?: string;
  timeoutConfiguredMs?: number;
  configuredMaxRetries?: number;
  elapsedBucket?: ProviderTransportElapsedBucket;
  requestSizeBytes?: number;
  inputBytes?: number;
  schemaSizeBytes?: number;
  choicesCount?: number;
  finishReason?: string | null;
  refusalPresent?: boolean;
  parsedPresent?: boolean;
  contentPresent?: boolean;
  contentLength?: number;
  schemaName?: string;
  issueCode?: string;
  fieldPath?: string;
  schemaNodeKind?: string;
  unsupportedConstruct?: string;
  issueCount?: number;
  domainValidationIssuePaths?: string[];
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  maxCompletionTokens?: number;
  reasoningEffort?: "xhigh";
  rawContentBytes?: number;
  rawContentChecksum?: string;
  jsonParseSucceeded?: boolean;
  zodIssueCount?: number;
  zodIssuesTruncated?: boolean;
  completeZodIssuesChecksum?: string;
  zodIssuesBounded?: Array<{ path: string; code: string; expected?: string; received?: string; message: string }>;
  contextCapacity?: { budgetProfile: string; requestBytes: number; requestTokens: number; schemaBytes: number; schemaTokens: number; totalBytesWithReserve: number; totalTokensWithReserve: number; maxBytes: number; maxTokens: number; canonicalRequirementBytes: number; supportingContextBytes: number };
};
export const ProviderTerminationParseStatusSchema = z.enum(["NOT_REACHED", "FAILED", "PASSED"]);
export type ProviderTerminationParseStatus = z.infer<typeof ProviderTerminationParseStatusSchema>;
export const ProviderTerminationMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  transportStatus: z.enum(["NOT_ATTEMPTED", "STARTED", "RESPONSE_RECEIVED"]),
  parseStatus: ProviderTerminationParseStatusSchema,
  requestAttempted: z.boolean(),
  responseReceived: z.boolean(),
  finishReason: z.string().regex(/^[a-z_]{1,64}$/).nullable(),
  outputComplete: z.boolean(),
  tokenExhaustion: z.boolean(),
  parsedPresent: z.boolean(),
  jsonParseSucceeded: z.boolean().nullable(),
  schemaName: z.string().regex(/^[a-z0-9-]{1,100}$/).nullable(),
  rawResponseRetained: z.literal(false),
}).strict();
export type ProviderTerminationMetadata = z.infer<typeof ProviderTerminationMetadataSchema>;
export function createProviderTerminationMetadata(diagnostic: ProviderDiagnostic, parseStatus: ProviderTerminationParseStatus): ProviderTerminationMetadata {
  const responseReceived = diagnostic.responseReceived ?? diagnostic.apiResponseReceived;
  const finishReason = diagnostic.finishReason === null || diagnostic.finishReason === undefined || /^[a-z_]{1,64}$/.test(diagnostic.finishReason) ? diagnostic.finishReason ?? null : null;
  return ProviderTerminationMetadataSchema.parse({
    schemaVersion: 1,
    transportStatus: !diagnostic.requestAttempted ? "NOT_ATTEMPTED" : responseReceived ? "RESPONSE_RECEIVED" : "STARTED",
    parseStatus,
    requestAttempted: diagnostic.requestAttempted,
    responseReceived,
    finishReason,
    outputComplete: diagnostic.outputComplete ?? parseStatus === "PASSED",
    tokenExhaustion: diagnostic.tokenExhaustion ?? false,
    parsedPresent: diagnostic.parsedPresent ?? parseStatus === "PASSED",
    jsonParseSucceeded: diagnostic.jsonParseSucceeded ?? null,
    schemaName: diagnostic.schemaName && /^[a-z0-9-]{1,100}$/.test(diagnostic.schemaName) ? diagnostic.schemaName : null,
    rawResponseRetained: false,
  });
}
export type ProviderInvocationStage = "decomposition" | "coverage" | "architecture-review";
export type ProviderInvocationLedgerState = "RESERVED" | "ATTEMPTING" | "TRANSPORT_STARTED" | "RESPONSE_RECEIVED" | "PARSE_PASSED" | "ADMISSION_PASSED" | "FAILED";
export type ProviderInvocationLedgerHandle = {
  stage: ProviderInvocationStage;
  providerContract: string;
  beforeTransport(): Promise<void>;
  responseReceived(): Promise<void>;
  parsePassed(): Promise<void>;
  admissionPassed(): Promise<void>;
  failed(): Promise<void>;
};
export type ProviderInvocationLedgerPort = {
  reserveInvocation(input: { stage: ProviderInvocationStage; providerContract: string }): Promise<ProviderInvocationLedgerHandle>;
  recordProviderDiagnostic?: (diagnostic: ProviderDiagnostic, parseStatus: ProviderTerminationParseStatus, failureDiagnostic?: ProviderFailureDiagnostic) => void | Promise<void>;
  snapshot(): { providerCallsTotal: number; providerCallsByStage: Record<ProviderInvocationStage, { attempted: number; started: number; responseReceived: number; structuredParsePassed: number; semanticAdmissionPassed: number; completed: number; failed: number }>; providerInvocationState?: ProviderInvocationLedgerState };
};
export type ProviderInvocationContext = { operationId: string; correlationId: string; stage: ProviderInvocationStage; ledger?: ProviderInvocationLedgerPort; invocation?: ProviderInvocationLedgerHandle; recordDiagnostic?: (diagnostic: ProviderDiagnostic, parseStatus: ProviderTerminationParseStatus, failureDiagnostic?: ProviderFailureDiagnostic) => void | Promise<void> };
export type SafeProviderEvent = { type: "request.started" | "request.completed" | "request.failed"; provider: string; model: string; role: string; promptVersion: string; requestId?: string; code?: string; retryCount?: number; startedAt?: string; completedAt?: string; elapsedMs?: number; diagnostic?: ProviderDiagnostic; operationId?: string; correlationId?: string; operationStage?: ProviderInvocationStage };
export type ProviderEventSink = (event: SafeProviderEvent) => void;
export type ProviderUsageSink = (usage: ProviderUsage) => void | Promise<void>;
