import OpenAI from "openai";
import { z, type ZodType } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { AiProviderError, isAiProviderError } from "./errors";
import { createProviderFailureDiagnostic } from "./failure-diagnostics";
import { FifoConcurrencyLimiter } from "./limiter";
import { DEFAULT_AI_MAX_COMPLETION_TOKENS, type AiProviderConfig } from "./config";
import type { ProviderDiagnostic, ProviderEventSink, ProviderOutputStage, ProviderUsage, ProviderUsageSink } from "./usage";
import type { ContextBundle } from "@/runtime/context";
import { createInvocationFingerprint, createInvocationUsageRecord } from "@/runtime/context/telemetry";
import { createHash, randomUUID } from "node:crypto";

export type StructuredRequest<T> = { role: string; promptVersion: string; system: string; user: string; schemaName: string; schema: ZodType<T>; signal?: AbortSignal; idempotencyKey?: string; contextBundle?: ContextBundle; promptPrefixChecksum?: string; promptPrefixBytes?: number };
export type StructuredResponse<T> = { value: T; usage: ProviderUsage; requestId: string; diagnostic?: ProviderDiagnostic };
export type StructuredExecutor = <T>(request: StructuredRequest<T>, client: OpenAI, config: AiProviderConfig, correction: boolean) => Promise<{ value: T; requestId: string; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; diagnostic?: ProviderDiagnostic }>;

function providerSchemaFieldPath(rawPath: string | undefined) {
  if (!rawPath) return undefined;
  const parts = rawPath.split("/").filter(Boolean);
  const path: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "properties") {
      const property = parts[index + 1];
      if (!property || !/^[A-Za-z][A-Za-z0-9_]*$/.test(property)) return undefined;
      path.push(property);
      index += 1;
    } else if (part === "items") {
      if (!path.length) return undefined;
      path[path.length - 1] = `${path[path.length - 1]}[]`;
    }
  }
  const fieldPath = path.join(".");
  return /^[A-Za-z][A-Za-z0-9_.\[\]]*$/.test(fieldPath) ? fieldPath : undefined;
}

function zodNodeKind(schema: unknown) {
  const internal = schema as { _zod?: { def?: { type?: unknown } } };
  const type = internal?._zod?.def?.type;
  return typeof type === "string" ? `Zod${type[0]?.toUpperCase() ?? ""}${type.slice(1)}` : undefined;
}

function schemaConstructionDiagnostic(error: unknown, schemaName: string, schema?: unknown): Pick<ProviderDiagnostic, "issueCode" | "fieldPath" | "schemaNodeKind" | "unsupportedConstruct"> {
  const message = error instanceof Error ? error.message : "";
  const rawPath = message.match(/(?:Schema field|Object schema) at `([^`]+)`/)?.[1];
  if (/\.optional\(\).*\.nullable\(\)/i.test(message)) return { issueCode: "OPTIONAL_PROPERTY_UNSUPPORTED", fieldPath: providerSchemaFieldPath(rawPath), schemaNodeKind: "ZodOptional", unsupportedConstruct: "optional property without nullable" };
  if (/transform/i.test(message)) return { issueCode: "TRANSFORM_UNSUPPORTED", fieldPath: providerSchemaFieldPath(rawPath), schemaNodeKind: "ZodTransform", unsupportedConstruct: "transform" };
  if (/record|additionalProperties/i.test(message)) return { issueCode: /record/i.test(message) ? "RECORD_UNSUPPORTED" : "INVALID_ADDITIONAL_PROPERTIES", fieldPath: providerSchemaFieldPath(rawPath), schemaNodeKind: /record/i.test(message) ? "ZodRecord" : "ZodObject", unsupportedConstruct: /record/i.test(message) ? "dynamic keys" : "additionalProperties" };
  if (/union|anyOf|oneOf/i.test(message)) return { issueCode: "UNION_UNSUPPORTED", fieldPath: providerSchemaFieldPath(rawPath), schemaNodeKind: "ZodUnion", unsupportedConstruct: "union" };
  if (/default/i.test(message)) return { issueCode: "DEFAULT_UNSUPPORTED", fieldPath: providerSchemaFieldPath(rawPath), schemaNodeKind: "ZodDefault", unsupportedConstruct: "default" };
  if (/refin|custom/i.test(message)) return { issueCode: "REFINEMENT_UNSUPPORTED", fieldPath: providerSchemaFieldPath(rawPath), schemaNodeKind: "ZodRefinement", unsupportedConstruct: "refinement" };
  if (/nullable|required/i.test(message)) return { issueCode: /nullable/i.test(message) ? "INVALID_NULLABILITY" : "INVALID_REQUIRED_SET", fieldPath: providerSchemaFieldPath(rawPath), schemaNodeKind: "ZodObject", unsupportedConstruct: "required/nullability" };
  const nodeKind = zodNodeKind(schema);
  if (nodeKind === "ZodUnion") return { issueCode: "UNION_UNSUPPORTED", fieldPath: providerSchemaFieldPath(rawPath), schemaNodeKind: nodeKind, unsupportedConstruct: "union" };
  return { issueCode: "SCHEMA_CONSTRUCTION_FAILED", fieldPath: providerSchemaFieldPath(rawPath), schemaNodeKind: nodeKind ?? "Unknown", unsupportedConstruct: schemaName };
}

/** The production response-format boundary used immediately before the SDK call. */
export function buildProductionResponseFormat<T>(schema: ZodType<T>, schemaName: string): ReturnType<typeof zodResponseFormat> {
  try {
    return zodResponseFormat(schema as unknown as Parameters<typeof zodResponseFormat>[0], schemaName);
  } catch (error) {
    throw new AiProviderError("AI_REQUEST_SCHEMA_INVALID", "Structured output schema was rejected before the provider request.", error, {
      stage: "request_construction",
      outputStage: "REQUEST_SCHEMA_CONSTRUCTION_FAILED",
      requestAttempted: false,
      apiResponseReceived: false,
      responseReceived: false,
      outputComplete: false,
      sdkErrorClass: safeClassName(error),
      schemaName,
      ...schemaConstructionDiagnostic(error, schemaName, schema),
    });
  }
}

type ProviderErrorShape = { status?: unknown; requestID?: unknown; request_id?: unknown; error?: { type?: unknown; code?: unknown; param?: unknown } | null; type?: unknown; code?: unknown; param?: unknown; name?: unknown };

export class OpenAiStructuredClient {
  private readonly client: OpenAI;
  private readonly limiter: FifoConcurrencyLimiter;
  private readonly inFlight = new Map<string, Promise<StructuredResponse<unknown>>>();
  private readonly executor: StructuredExecutor;
  private readonly usageSink?: ProviderUsageSink;
  private readonly eventSink?: ProviderEventSink;

  constructor(private readonly config: AiProviderConfig, options: { client?: OpenAI; executor?: StructuredExecutor; usageSink?: ProviderUsageSink; eventSink?: ProviderEventSink } = {}) {
    this.client = options.client ?? new OpenAI({ apiKey: config.apiKey, maxRetries: 0 });
    this.executor = options.executor ?? defaultExecutor;
    this.limiter = new FifoConcurrencyLimiter(config.maxConcurrentRequests);
    this.usageSink = options.usageSink;
    this.eventSink = options.eventSink;
  }

  request<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const fingerprint = this.fingerprint(request);
    if (fingerprint) {
      const existing = this.inFlight.get(fingerprint);
      if (existing) return existing.then((value) => value as StructuredResponse<T>);
    }
    const promise = this.limiter.run(() => this.execute(request), request.signal) as Promise<StructuredResponse<unknown>>;
    if (fingerprint) {
      this.inFlight.set(fingerprint, promise);
      void promise.then(() => this.inFlight.delete(fingerprint), () => this.inFlight.delete(fingerprint));
    }
    return promise as Promise<StructuredResponse<T>>;
  }

  private fingerprint<T>(request: StructuredRequest<T>) {
    const contextChecksum = request.contextBundle?.checksum ?? createHash("sha256").update(`${request.system}\n${request.user}`, "utf8").digest("hex");
    const prefixChecksum = request.promptPrefixChecksum ?? createHash("sha256").update(request.system, "utf8").digest("hex");
    const identity = createInvocationFingerprint({ agentId: request.role, model: this.config.model, schemaVersion: request.contextBundle?.schemaVersion ?? 1, currentnessIdentity: request.contextBundle?.currentnessIdentity ?? "legacy-request", contextBundleChecksum: contextChecksum, promptPrefixChecksum: prefixChecksum });
    return request.idempotencyKey ? `${request.idempotencyKey}:${identity}` : identity;
  }

  private async execute<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    let retries = 0;
    let correction = false;
    const startedAt = new Date().toISOString();
    const started = Date.now();
    this.eventSink?.({ type: "request.started", provider: "openai", model: this.config.model, role: request.role, promptVersion: request.promptVersion, startedAt });
    try {
      while (true) {
        if (request.signal?.aborted) throw new AiProviderError("AI_REQUEST_CANCELLED", "AI request was cancelled.", undefined, { stage: "request_construction", requestAttempted: false, apiResponseReceived: false, responseReceived: false, outputComplete: false, schemaName: request.schemaName });
        try {
          this.assertContextCapacity(request);
          const result = await this.executor(request, this.client, this.config, correction);
          const actualUsageCaptured = result.inputTokens !== undefined || result.outputTokens !== undefined;
          const usage = createInvocationUsageRecord({ invocationFingerprint: this.fingerprint(request) ?? randomUUID(), agentId: request.role, ...(request.contextBundle?.taskId ? { taskId: request.contextBundle.taskId } : {}), workflowStage: request.contextBundle?.workflowStage ?? request.role, role: request.role, ...(request.contextBundle?.contextBundleId ? { contextBundleId: request.contextBundle.contextBundleId } : {}), ...(request.contextBundle?.checksum ? { contextChecksum: request.contextBundle.checksum } : {}), provider: "openai", model: this.config.model, ...(result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens }), ...(result.cachedInputTokens === undefined ? {} : { cachedInputTokens: result.cachedInputTokens }), ...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }), ...(result.inputTokens !== undefined && result.outputTokens !== undefined ? { totalTokens: result.inputTokens + result.outputTokens } : {}), actualUsageCaptured, cacheTelemetryUnavailable: result.cachedInputTokens === undefined, prefixChecksum: request.promptPrefixChecksum ?? createHash("sha256").update(request.system, "utf8").digest("hex"), prefixBytes: request.promptPrefixBytes ?? Buffer.byteLength(request.system, "utf8"), contextMetrics: request.contextBundle?.metrics, requestCount: 1, retryCount: retries, correctionCount: correction ? 1 : 0, promptVersion: request.promptVersion }) as ProviderUsage;
          await this.usageSink?.(usage);
          this.eventSink?.({ type: "request.completed", provider: "openai", model: this.config.model, role: request.role, promptVersion: request.promptVersion, requestId: result.requestId, retryCount: retries, startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - started, diagnostic: result.diagnostic });
          return { value: result.value, usage, requestId: result.requestId, diagnostic: result.diagnostic };
        } catch (error) {
          const mapped = mapError(error, request.schemaName, true, this.config.model);
          if (mapped.code === "AI_OUTPUT_SCHEMA_MISMATCH" && !correction) {
            correction = true;
            continue;
          }
          if (isRetryable(mapped) && retries < this.config.maxRetries) {
            retries++;
            continue;
          }
          const finalError = retries ? new AiProviderError("AI_RETRY_EXHAUSTED", "AI provider retries were exhausted.", mapped, mapped.diagnostic) : mapped;
          this.eventSink?.({ type: "request.failed", provider: "openai", model: this.config.model, role: request.role, promptVersion: request.promptVersion, code: finalError.code, retryCount: retries, startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - started, diagnostic: finalError.diagnostic });
          throw finalError;
        }
      }
    } catch (error) {
      throw mapError(error, request.schemaName, true, this.config.model);
    }
  }

  private assertContextCapacity(request: StructuredRequest<unknown>) {
    const bundle = request.contextBundle;
    if (!bundle) return;
    const byteLength = (value: string) => Buffer.byteLength(value, "utf8");
    const estimatedTokens = (value: string) => Math.ceil(byteLength(value) / 4);
    const requestBytes = byteLength(request.system) + byteLength(request.user);
    const requestTokens = estimatedTokens(request.system) + estimatedTokens(request.user);
    const maxBytes = bundle.budget.hardCeiling.bytes;
    const maxTokens = bundle.budget.hardCeiling.estimatedInputTokens;
    const totalBytesWithReserve = requestBytes + bundle.budget.reservedResponseBytes;
    const totalTokensWithReserve = requestTokens + bundle.budget.reservedResponseTokens;
    if (totalBytesWithReserve <= maxBytes && totalTokensWithReserve <= maxTokens) return;
    throw new AiProviderError(
      "AI_REQUEST_CONTEXT_CAPACITY_EXCEEDED",
      "The provider request cannot safely fit the complete canonical context and reserved response capacity.",
      undefined,
      {
        stage: "request_construction",
        requestAttempted: false,
        apiResponseReceived: false,
        sdkErrorClass: "ContextCapacityGuard",
        schemaName: request.schemaName,
        contextCapacity: {
          budgetProfile: bundle.budget.profileId,
          requestBytes,
          requestTokens,
          totalBytesWithReserve,
          totalTokensWithReserve,
          maxBytes,
          maxTokens,
          canonicalRequirementBytes: bundle.metrics.canonicalRequirementBytes,
          supportingContextBytes: bundle.metrics.supportingContextIncludedBytes,
        },
      },
    );
  }
}

async function defaultExecutor<T>(request: StructuredRequest<T>, client: OpenAI, config: AiProviderConfig, correction: boolean) {
  const responseSchema = buildProductionResponseFormat(request.schema, request.schemaName);
  const correctionInstruction = request.role === "design" ? "\nReturn exactly 3 directions. Repair only the structural deficiency; do not omit, clone, or add a fourth direction." : "\nCorrect the previous structured-output formatting.";
  let completion: Awaited<ReturnType<OpenAI["chat"]["completions"]["parse"]>>;
  try {
    completion = await client.chat.completions.parse({ model: config.model, max_completion_tokens: config.maxCompletionTokens ?? DEFAULT_AI_MAX_COMPLETION_TOKENS, messages: [{ role: "system", content: `${request.system}${correction ? correctionInstruction : ""}` }, { role: "user", content: request.user }], response_format: responseSchema }, request.signal ? { signal: request.signal } : undefined);
  } catch (error) {
    throw mapError(error, request.schemaName, true, config.model);
  }
  const choice = completion.choices[0];
  const message = choice?.message;
  const inputTokens = completion.usage?.prompt_tokens;
  const outputTokens = completion.usage?.completion_tokens;
  const maxCompletionTokens = config.maxCompletionTokens ?? DEFAULT_AI_MAX_COMPLETION_TOKENS;
  const responseReceived = true;
  const outputComplete = choice?.finish_reason === "stop" && Boolean(message?.parsed);
  const responseDiagnostic: ProviderDiagnostic = { stage: "api_response", requestAttempted: true, apiResponseReceived: true, responseReceived, outputComplete, tokenExhaustion: choice?.finish_reason === "length" || (outputTokens !== undefined && outputTokens >= maxCompletionTokens), requestId: completion.id, choicesCount: completion.choices.length, finishReason: choice?.finish_reason ?? null, refusalPresent: Boolean(message?.refusal), parsedPresent: message?.parsed != null, contentPresent: typeof message?.content === "string", contentLength: typeof message?.content === "string" ? message.content.length : undefined, schemaName: request.schemaName, inputTokens, outputTokens, ...(inputTokens !== undefined && outputTokens !== undefined ? { totalTokens: inputTokens + outputTokens } : {}), maxCompletionTokens };
  if (message?.refusal) throw new AiProviderError("AI_OUTPUT_REFUSED", "The provider refused the structured request.", undefined, { ...responseDiagnostic, outputStage: "PROVIDER_REFUSAL", outputComplete: false });
  if (choice?.finish_reason === "length" || choice?.finish_reason === "content_filter") throw new AiProviderError("AI_OUTPUT_TRUNCATED", "The provider output was incomplete.", undefined, { ...responseDiagnostic, outputStage: "PROVIDER_OUTPUT_INCOMPLETE", outputComplete: false, tokenExhaustion: choice?.finish_reason === "length" });
  if (!message?.parsed) throw new AiProviderError("AI_OUTPUT_NO_PARSED_OUTPUT", "The provider returned no parsed structured output.", undefined, { ...responseDiagnostic, outputStage: "STRUCTURED_OUTPUT_PARSE_FAILED", outputComplete: false });
  let value: T;
  try {
    value = request.schema.parse(message.parsed);
  } catch (error) {
    throw new AiProviderError("AI_OUTPUT_DOMAIN_INVALID", "Provider structured output failed the strict transport schema.", error, { ...responseDiagnostic, stage: "domain_validation", outputStage: "TRANSPORT_SCHEMA_VALIDATION_FAILED", issueCode: zodIssueCode(error), fieldPath: zodIssuePaths(error)?.[0], issueCount: zodIssueCount(error), domainValidationIssuePaths: zodIssuePaths(error) });
  }
  return { value, requestId: completion.id, inputTokens, ...(completion.usage?.prompt_tokens_details?.cached_tokens === undefined ? {} : { cachedInputTokens: completion.usage.prompt_tokens_details.cached_tokens }), outputTokens, diagnostic: responseDiagnostic } as const;
}

function safeClassName(error: unknown) { return error instanceof Error && error.constructor?.name ? error.constructor.name : typeof error === "object" && error ? "SdkError" : "Error"; }
function safeString(value: unknown) { return typeof value === "string" && value.length <= 160 ? value : undefined; }
function safeStatus(value: unknown) { const status = typeof value === "number" ? value : Number(value); return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined; }
function safeProviderErrorShape(error: unknown): ProviderErrorShape { return typeof error === "object" && error !== null ? error as ProviderErrorShape : {}; }
function zodIssuePaths(error: unknown) { return error instanceof z.ZodError ? error.issues.map((issue) => issue.path.map(String).join(".")).filter(Boolean).slice(0, 20) : undefined; }
function zodIssueCount(error: unknown) { return error instanceof z.ZodError ? error.issues.length : undefined; }
function zodIssueCode(error: unknown) {
  const issue = error instanceof z.ZodError ? error.issues[0] : undefined;
  if (!issue) return undefined;
  if (issue.code === "unrecognized_keys") return "UNKNOWN_FIELD";
  if (issue.code === "invalid_type") return "INVALID_TYPE";
  if (issue.code === "invalid_value") return "INVALID_ENUM_OR_LITERAL";
  if (issue.code === "invalid_format") return "INVALID_FORMAT";
  return "INVALID_FIELD";
}
function diagnosticForError(error: unknown, schemaName: string, requestAttempted: boolean, outputStage: ProviderOutputStage = requestAttempted ? "PROVIDER_REQUEST_FAILED" : "REQUEST_SCHEMA_CONSTRUCTION_FAILED"): ProviderDiagnostic {
  const shape = safeProviderErrorShape(error);
  const apiError = shape.error ?? {};
  const responseReceived = safeStatus(shape.status) !== undefined;
  return { stage: requestAttempted ? "api_request" : "structured_parse", outputStage, requestAttempted, apiResponseReceived: responseReceived, responseReceived, outputComplete: false, httpStatus: safeStatus(shape.status), requestId: safeString(shape.requestID) ?? safeString(shape.request_id), sdkErrorClass: safeClassName(error), openaiErrorType: safeString(apiError.type) ?? safeString(shape.type), openaiErrorCode: safeString(apiError.code) ?? safeString(shape.code), openaiErrorParam: safeString(apiError.param) ?? safeString(shape.param), schemaName };
}
function withFailureDiagnostic(error: AiProviderError, schemaName: string, requestAttempted: boolean, model: string): AiProviderError {
  const effectiveRequestAttempted = error.diagnostic?.requestAttempted ?? requestAttempted;
  if (error.failureDiagnostic?.errorCode === error.code && error.failureDiagnostic.schemaName === schemaName && error.failureDiagnostic.model === model) return error;
  return new AiProviderError(error.code, error.message, error.cause, error.diagnostic, createProviderFailureDiagnostic({ errorCode: error.code, model, schemaName, requestAttempted: effectiveRequestAttempted, diagnostic: error.diagnostic, error: error.cause ?? error }));
}

function mapError(error: unknown, schemaName = "unknown", requestAttempted = true, model = "unknown"): AiProviderError {
  if (isAiProviderError(error)) return withFailureDiagnostic(error, schemaName, requestAttempted, model);
  if (error instanceof z.ZodError) return withFailureDiagnostic(new AiProviderError("AI_STRUCTURED_PARSE_FAILED", "Provider structured output could not be parsed safely.", error, { ...diagnosticForError(error, schemaName, requestAttempted, "STRUCTURED_OUTPUT_PARSE_FAILED"), stage: "structured_parse", issueCode: zodIssueCode(error), fieldPath: zodIssuePaths(error)?.[0], issueCount: zodIssueCount(error), domainValidationIssuePaths: zodIssuePaths(error) }), schemaName, requestAttempted, model);
  const shape = safeProviderErrorShape(error);
  const status = safeStatus(shape.status);
  const code = safeString((shape.error ?? {}).code) ?? safeString(shape.code);
  const diagnostic = diagnosticForError(error, schemaName, requestAttempted);
  let mapped: AiProviderError;
  if (status === 400 && (code === "unsupported_value" || code === "unsupported_parameter" || code === "unknown_parameter")) mapped = new AiProviderError("AI_REQUEST_PARAMETER_UNSUPPORTED", "AI provider rejected an unsupported request parameter.", error, diagnostic);
  else if (status === 400) mapped = new AiProviderError("AI_REQUEST_INVALID", "AI provider rejected the request contract.", error, diagnostic);
  else if (status === 401 || status === 403) mapped = new AiProviderError("AI_AUTHENTICATION_FAILED", "AI provider authentication failed.", undefined, diagnostic);
  else if (status === 404) mapped = new AiProviderError("AI_MODEL_ACCESS_FAILED", "AI provider rejected model access.", undefined, diagnostic);
  else if (status === 429) mapped = new AiProviderError("AI_RATE_LIMITED", "AI provider rate limit reached.", undefined, diagnostic);
  else if (status !== undefined && status >= 500) mapped = new AiProviderError("AI_PROVIDER_UNAVAILABLE", "AI provider is unavailable.", undefined, diagnostic);
  else if (shape.name === "AbortError" || code === "ETIMEDOUT" || code === "ECONNRESET") mapped = new AiProviderError("AI_NETWORK_ERROR", "AI provider network request failed safely.", undefined, diagnostic);
  else mapped = new AiProviderError("AI_OUTPUT_INVALID", "AI provider request failed safely.", error, diagnostic);
  return withFailureDiagnostic(mapped, schemaName, requestAttempted, model);
}
function isRetryable(error: AiProviderError) { return ["AI_PROVIDER_UNAVAILABLE", "AI_RATE_LIMITED", "AI_NETWORK_ERROR"].includes(error.code); }
