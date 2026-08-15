import OpenAI from "openai";
import { z, type ZodType } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { AiProviderError, isAiProviderError } from "./errors";
import { FifoConcurrencyLimiter } from "./limiter";
import type { AiProviderConfig } from "./config";
import type { ProviderDiagnostic, ProviderEventSink, ProviderUsage, ProviderUsageSink } from "./usage";
import type { ContextBundle } from "@/runtime/context";
import { createInvocationFingerprint, createInvocationUsageRecord } from "@/runtime/context/telemetry";
import { createHash, randomUUID } from "node:crypto";

export type StructuredRequest<T> = { role: string; promptVersion: string; system: string; user: string; schemaName: string; schema: ZodType<T>; signal?: AbortSignal; idempotencyKey?: string; contextBundle?: ContextBundle; promptPrefixChecksum?: string; promptPrefixBytes?: number };
export type StructuredResponse<T> = { value: T; usage: ProviderUsage; requestId: string; diagnostic?: ProviderDiagnostic };
export type StructuredExecutor = <T>(request: StructuredRequest<T>, client: OpenAI, config: AiProviderConfig, correction: boolean) => Promise<{ value: T; requestId: string; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; diagnostic?: ProviderDiagnostic }>;

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
        if (request.signal?.aborted) throw new AiProviderError("AI_REQUEST_CANCELLED", "AI request was cancelled.");
        try {
          this.assertContextCapacity(request);
          const result = await this.executor(request, this.client, this.config, correction);
          const actualUsageCaptured = result.inputTokens !== undefined || result.outputTokens !== undefined;
          const usage = createInvocationUsageRecord({ invocationFingerprint: this.fingerprint(request) ?? randomUUID(), agentId: request.role, ...(request.contextBundle?.taskId ? { taskId: request.contextBundle.taskId } : {}), workflowStage: request.contextBundle?.workflowStage ?? request.role, role: request.role, ...(request.contextBundle?.contextBundleId ? { contextBundleId: request.contextBundle.contextBundleId } : {}), ...(request.contextBundle?.checksum ? { contextChecksum: request.contextBundle.checksum } : {}), provider: "openai", model: this.config.model, ...(result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens }), ...(result.cachedInputTokens === undefined ? {} : { cachedInputTokens: result.cachedInputTokens }), ...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }), ...(result.inputTokens !== undefined && result.outputTokens !== undefined ? { totalTokens: result.inputTokens + result.outputTokens } : {}), actualUsageCaptured, cacheTelemetryUnavailable: result.cachedInputTokens === undefined, prefixChecksum: request.promptPrefixChecksum ?? createHash("sha256").update(request.system, "utf8").digest("hex"), prefixBytes: request.promptPrefixBytes ?? Buffer.byteLength(request.system, "utf8"), contextMetrics: request.contextBundle?.metrics, requestCount: 1, retryCount: retries, correctionCount: correction ? 1 : 0, promptVersion: request.promptVersion }) as ProviderUsage;
          await this.usageSink?.(usage);
          this.eventSink?.({ type: "request.completed", provider: "openai", model: this.config.model, role: request.role, promptVersion: request.promptVersion, requestId: result.requestId, retryCount: retries, startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - started, diagnostic: result.diagnostic });
          return { value: result.value, usage, requestId: result.requestId, diagnostic: result.diagnostic };
        } catch (error) {
          const mapped = mapError(error, request.schemaName);
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
      throw mapError(error, request.schemaName);
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
  let responseSchema: ReturnType<typeof zodResponseFormat>;
  try {
    responseSchema = zodResponseFormat(request.schema as unknown as Parameters<typeof zodResponseFormat>[0], request.schemaName);
  } catch (error) {
    throw new AiProviderError("AI_REQUEST_SCHEMA_INVALID", "Structured output schema was rejected before the provider request.", error, { stage: "request_construction", requestAttempted: false, apiResponseReceived: false, sdkErrorClass: safeClassName(error), schemaName: request.schemaName });
  }
  const correctionInstruction = request.role === "design" ? "\nReturn exactly 3 directions. Repair only the structural deficiency; do not omit, clone, or add a fourth direction." : "\nCorrect the previous structured-output formatting.";
  let completion: Awaited<ReturnType<OpenAI["chat"]["completions"]["parse"]>>;
  try {
    completion = await client.chat.completions.parse({ model: config.model, messages: [{ role: "system", content: `${request.system}${correction ? correctionInstruction : ""}` }, { role: "user", content: request.user }], response_format: responseSchema }, request.signal ? { signal: request.signal } : undefined);
  } catch (error) {
    throw mapError(error, request.schemaName, true);
  }
  const choice = completion.choices[0];
  const message = choice?.message;
  const responseDiagnostic: ProviderDiagnostic = { stage: "api_response", requestAttempted: true, apiResponseReceived: true, requestId: completion.id, choicesCount: completion.choices.length, finishReason: choice?.finish_reason ?? null, refusalPresent: Boolean(message?.refusal), parsedPresent: message?.parsed != null, contentPresent: typeof message?.content === "string", contentLength: typeof message?.content === "string" ? message.content.length : undefined, schemaName: request.schemaName };
  if (message?.refusal) throw new AiProviderError("AI_OUTPUT_REFUSED", "The provider refused the structured request.", undefined, responseDiagnostic);
  if (choice?.finish_reason === "length") throw new AiProviderError("AI_OUTPUT_TRUNCATED", "The provider output was truncated.", undefined, responseDiagnostic);
  if (!message?.parsed) throw new AiProviderError("AI_OUTPUT_NO_PARSED_OUTPUT", "The provider returned no parsed structured output.", undefined, responseDiagnostic);
  let value: T;
  try {
    value = request.schema.parse(message.parsed);
  } catch (error) {
    throw new AiProviderError("AI_OUTPUT_DOMAIN_INVALID", "Provider structured output failed Factory schema validation.", error, { ...responseDiagnostic, stage: "domain_validation", domainValidationIssuePaths: zodIssuePaths(error) });
  }
  return { value, requestId: completion.id, inputTokens: completion.usage?.prompt_tokens, ...(completion.usage?.prompt_tokens_details?.cached_tokens === undefined ? {} : { cachedInputTokens: completion.usage.prompt_tokens_details.cached_tokens }), outputTokens: completion.usage?.completion_tokens, diagnostic: responseDiagnostic } as const;
}

function safeClassName(error: unknown) { return error instanceof Error && error.constructor?.name ? error.constructor.name : typeof error === "object" && error ? "SdkError" : "Error"; }
function safeString(value: unknown) { return typeof value === "string" && value.length <= 160 ? value : undefined; }
function safeStatus(value: unknown) { const status = typeof value === "number" ? value : Number(value); return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined; }
function safeProviderErrorShape(error: unknown): ProviderErrorShape { return typeof error === "object" && error !== null ? error as ProviderErrorShape : {}; }
function zodIssuePaths(error: unknown) { return error instanceof z.ZodError ? error.issues.map((issue) => issue.path.map(String).join(".")).filter(Boolean).slice(0, 20) : undefined; }
function diagnosticForError(error: unknown, schemaName: string, requestAttempted: boolean): ProviderDiagnostic {
  const shape = safeProviderErrorShape(error);
  const apiError = shape.error ?? {};
  return { stage: requestAttempted ? "api_request" : "structured_parse", requestAttempted, apiResponseReceived: safeStatus(shape.status) !== undefined, httpStatus: safeStatus(shape.status), requestId: safeString(shape.requestID) ?? safeString(shape.request_id), sdkErrorClass: safeClassName(error), openaiErrorType: safeString(apiError.type) ?? safeString(shape.type), openaiErrorCode: safeString(apiError.code) ?? safeString(shape.code), openaiErrorParam: safeString(apiError.param) ?? safeString(shape.param), schemaName };
}
function mapError(error: unknown, schemaName = "unknown", requestAttempted = true): AiProviderError {
  if (isAiProviderError(error)) return error;
  if (error instanceof z.ZodError) return new AiProviderError("AI_STRUCTURED_PARSE_FAILED", "Provider structured output could not be parsed safely.", error, { ...diagnosticForError(error, schemaName, requestAttempted), stage: "structured_parse", domainValidationIssuePaths: zodIssuePaths(error) });
  const shape = safeProviderErrorShape(error);
  const status = safeStatus(shape.status);
  const code = safeString((shape.error ?? {}).code) ?? safeString(shape.code);
  const diagnostic = diagnosticForError(error, schemaName, requestAttempted);
  if (status === 400 && (code === "unsupported_value" || code === "unsupported_parameter" || code === "unknown_parameter")) return new AiProviderError("AI_REQUEST_PARAMETER_UNSUPPORTED", "AI provider rejected an unsupported request parameter.", error, diagnostic);
  if (status === 400) return new AiProviderError("AI_REQUEST_INVALID", "AI provider rejected the request contract.", error, diagnostic);
  if (status === 401 || status === 403) return new AiProviderError("AI_AUTHENTICATION_FAILED", "AI provider authentication failed.", undefined, diagnostic);
  if (status === 404) return new AiProviderError("AI_MODEL_ACCESS_FAILED", "AI provider rejected model access.", undefined, diagnostic);
  if (status === 429) return new AiProviderError("AI_RATE_LIMITED", "AI provider rate limit reached.", undefined, diagnostic);
  if (status !== undefined && status >= 500) return new AiProviderError("AI_PROVIDER_UNAVAILABLE", "AI provider is unavailable.", undefined, diagnostic);
  if (shape.name === "AbortError" || code === "ETIMEDOUT" || code === "ECONNRESET") return new AiProviderError("AI_NETWORK_ERROR", "AI provider network request failed safely.", undefined, diagnostic);
  return new AiProviderError("AI_OUTPUT_INVALID", "AI provider request failed safely.", error, diagnostic);
}
function isRetryable(error: AiProviderError) { return ["AI_PROVIDER_UNAVAILABLE", "AI_RATE_LIMITED", "AI_NETWORK_ERROR"].includes(error.code); }
