import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { z, type ZodType } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { AiProviderError, isAiProviderError } from "./errors";
import { classifyProviderTransportFailure, createProviderFailureDiagnostic } from "./failure-diagnostics";
import { FifoConcurrencyLimiter } from "./limiter";
import { DEFAULT_AI_MAX_COMPLETION_TOKENS, type AiProviderConfig } from "./config";
import type { ProviderDiagnostic, ProviderEventSink, ProviderInvocationContext, ProviderOutputStage, ProviderUsage, ProviderUsageSink } from "./usage";
import type { ContextBundle } from "@/runtime/context";
import { createInvocationFingerprint, createInvocationUsageRecord } from "@/runtime/context/telemetry";
import { createHash, randomUUID } from "node:crypto";
import { StructuredOutputPreflightError, assertStructuredOutputPreflight } from "./schema-preflight";

export type StructuredSchemaDefinition = Parameters<typeof zodResponseFormat>[0];
export type StructuredRequest<T> = { role: string; promptVersion: string; system: string; user: string; schemaName: string; schema: ZodType<T>; schemaDefinitions?: Record<string, StructuredSchemaDefinition>; signal?: AbortSignal; idempotencyKey?: string; contextBundle?: ContextBundle; promptPrefixChecksum?: string; promptPrefixBytes?: number; maxCompletionTokens?: number; retryPolicy?: { maxRetries: number; corrections: number }; parseStrategy?: "sdk" | "manual"; providerInvocation?: ProviderInvocationContext };
export type StructuredResponse<T> = { value: T; usage: ProviderUsage; requestId: string; diagnostic?: ProviderDiagnostic };
export type ProviderTransportResult = { requestId: string; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; diagnostic: ProviderDiagnostic };
export type ProviderRawStructuredResult = ProviderTransportResult & { content: string };
export type ProviderParsedStructuredResult<T> = ProviderRawStructuredResult & { value: T };
type ProviderResponseCapture = (result: ProviderTransportResult) => void | Promise<void>;
export type StructuredExecutorResult<T> = { value: T; requestId: string; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; diagnostic?: ProviderDiagnostic };
export type StructuredExecutor = <T>(request: StructuredRequest<T>, client: OpenAI, config: AiProviderConfig, correction: boolean) => Promise<StructuredExecutorResult<T>>;

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
export function buildProductionResponseFormat<T>(schema: ZodType<T>, schemaName: string, options: { schemaDefinitions?: Record<string, StructuredSchemaDefinition> } = {}): ReturnType<typeof zodResponseFormat> {
  try {
    const responseFormat = zodResponseFormat(schema as unknown as Parameters<typeof zodResponseFormat>[0], schemaName, options.schemaDefinitions ? { schemaDefinitions: options.schemaDefinitions } : undefined);
    const jsonSchema = responseFormat as unknown as { json_schema?: { schema?: unknown; strict?: unknown } };
    assertStructuredOutputPreflight({ schema: jsonSchema.json_schema?.schema, strict: jsonSchema.json_schema?.strict });
    return responseFormat;
  } catch (error) {
    if (isAiProviderError(error)) throw error;
    const preflight = error instanceof StructuredOutputPreflightError ? error : undefined;
    throw new AiProviderError("AI_REQUEST_SCHEMA_INVALID", "Structured output schema was rejected before the provider request.", error, {
      stage: "request_construction",
      outputStage: "REQUEST_SCHEMA_CONSTRUCTION_FAILED",
      requestAttempted: false,
      apiResponseReceived: false,
      responseReceived: false,
      outputComplete: false,
      sdkErrorClass: safeClassName(error),
      schemaName,
      ...(preflight ? { issueCode: preflight.issue.code, fieldPath: preflight.issue.path, schemaNodeKind: "JSONSchema", unsupportedConstruct: preflight.issue.keyword ?? preflight.issue.detail } : schemaConstructionDiagnostic(error, schemaName, schema)),
    });
  }
}

type ProviderErrorShape = { status?: unknown; requestID?: unknown; request_id?: unknown; message?: unknown; error?: { type?: unknown; code?: unknown; param?: unknown; message?: unknown } | null; type?: unknown; code?: unknown; param?: unknown; name?: unknown };

export class OpenAiStructuredClient {
  private readonly client: OpenAI;
  private readonly limiter: FifoConcurrencyLimiter;
  private readonly inFlight = new Map<string, Promise<StructuredResponse<unknown>>>();
  private readonly executor: StructuredExecutor;
  private readonly executorInjected: boolean;
  private readonly usageSink?: ProviderUsageSink;
  private readonly eventSink?: ProviderEventSink;

  constructor(private readonly config: AiProviderConfig, options: { client?: OpenAI; executor?: StructuredExecutor; usageSink?: ProviderUsageSink; eventSink?: ProviderEventSink } = {}) {
    this.client = options.client ?? new OpenAI({ apiKey: config.apiKey, maxRetries: 0 });
    this.executor = options.executor ?? defaultExecutor;
    this.executorInjected = options.executor !== undefined;
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
    let capturedUsage: ProviderUsage | undefined;
    // A durable Workbench ledger owns the single provider budget. The
    // canonical staged Planner contract has no retry/correction/fallback
    // authority, even if a caller accidentally supplies a looser policy.
    const maxRetries = request.providerInvocation?.ledger ? 0 : request.retryPolicy?.maxRetries ?? this.config.maxRetries;
    const maxCorrections = request.providerInvocation?.ledger ? 0 : request.retryPolicy?.corrections ?? 0;
    const startedAt = new Date().toISOString();
    const started = Date.now();
    let requestDiagnostic: Partial<ProviderDiagnostic> | undefined;
    let transportStarted = false;
    const operationEvent = request.providerInvocation ? { operationId: request.providerInvocation.operationId, correlationId: request.providerInvocation.correlationId, operationStage: request.providerInvocation.stage } : {};
    let suppliedInvocation = request.providerInvocation?.invocation;
    this.eventSink?.({ type: "request.started", provider: "openai", model: this.config.model, role: request.role, promptVersion: request.promptVersion, startedAt, ...operationEvent });
    try {
      while (true) {
        transportStarted = false;
        let invocation = suppliedInvocation;
        suppliedInvocation = undefined;
        if (request.signal?.aborted) throw new AiProviderError("AI_REQUEST_CANCELLED", "AI request was cancelled.", undefined, { stage: "request_construction", requestAttempted: false, apiResponseReceived: false, responseReceived: false, outputComplete: false, schemaName: request.schemaName });
        try {
          if (!invocation && request.providerInvocation?.ledger)
            invocation = await request.providerInvocation.ledger.reserveInvocation({ stage: request.providerInvocation.stage, providerContract: request.schemaName });
          this.assertContextCapacity(request);
          // Build the exact production response format before consuming the
          // irreversible provider budget. The executor builds the same format
          // for the SDK call, but this preflight keeps schema failures at zero
          // transport calls.
          const responseFormat = buildProductionResponseFormat(request.schema, request.schemaName, { schemaDefinitions: request.schemaDefinitions });
          requestDiagnostic = requestMetadata(request, responseFormat, this.client, this.config, correction);
          await invocation?.beforeTransport();
          transportStarted = true;
          const captureResponse: ProviderResponseCapture = async (response) => {
            if (!capturedUsage) capturedUsage = await this.recordUsage(request, response, retries, correction);
          };
          const result = request.parseStrategy === "manual" && !this.executorInjected
            ? await manualExecutor(request, this.client, this.config, correction, captureResponse)
            : await this.executor(request, this.client, this.config, correction);
          await invocation?.responseReceived();
          await invocation?.parsePassed();
          if (result.diagnostic && request.providerInvocation?.recordDiagnostic)
            await Promise.resolve(request.providerInvocation.recordDiagnostic(result.diagnostic, "PASSED")).catch(() => undefined);
          else if (result.diagnostic && request.providerInvocation?.ledger?.recordProviderDiagnostic)
            await Promise.resolve(request.providerInvocation.ledger.recordProviderDiagnostic(result.diagnostic, "PASSED")).catch(() => undefined);
          const usage = capturedUsage ?? await this.recordUsage(request, result, retries, correction);
          this.eventSink?.({ type: "request.completed", provider: "openai", model: this.config.model, role: request.role, promptVersion: request.promptVersion, requestId: result.requestId, retryCount: retries, startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - started, diagnostic: result.diagnostic, ...operationEvent });
          return { value: result.value, usage, requestId: result.requestId, diagnostic: result.diagnostic };
        } catch (error) {
          const mapped = mapError(error, request.schemaName, transportStarted, this.config.model, { ...requestDiagnostic, elapsedBucket: elapsedBucket(Date.now() - started) });
          if (mapped.diagnostic && request.providerInvocation?.recordDiagnostic)
            await Promise.resolve(request.providerInvocation.recordDiagnostic(mapped.diagnostic, (mapped.diagnostic.responseReceived ?? mapped.diagnostic.apiResponseReceived) ? "FAILED" : "NOT_REACHED")).catch(() => undefined);
          else if (mapped.diagnostic && request.providerInvocation?.ledger?.recordProviderDiagnostic)
            await Promise.resolve(request.providerInvocation.ledger.recordProviderDiagnostic(mapped.diagnostic, (mapped.diagnostic.responseReceived ?? mapped.diagnostic.apiResponseReceived) ? "FAILED" : "NOT_REACHED")).catch(() => undefined);
          if (invocation && (mapped.diagnostic?.responseReceived || mapped.diagnostic?.apiResponseReceived)) await invocation.responseReceived().catch(() => undefined);
          if (invocation) await invocation.failed().catch(() => undefined);
          if (mapped.code === "AI_OUTPUT_SCHEMA_MISMATCH" && !correction && maxCorrections > 0) {
            correction = true;
            continue;
          }
          if (isRetryable(mapped) && retries < maxRetries) {
            retries++;
            continue;
          }
          const finalError = retries ? new AiProviderError("AI_RETRY_EXHAUSTED", "AI provider retries were exhausted.", mapped, mapped.diagnostic) : mapped;
          this.eventSink?.({ type: "request.failed", provider: "openai", model: this.config.model, role: request.role, promptVersion: request.promptVersion, code: finalError.code, retryCount: retries, startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - started, diagnostic: finalError.diagnostic, ...operationEvent });
          throw finalError;
        }
      }
    } catch (error) {
      throw mapError(error, request.schemaName, transportStarted, this.config.model, { ...requestDiagnostic, elapsedBucket: elapsedBucket(Date.now() - started) });
    }
  }

  private async recordUsage<T>(request: StructuredRequest<T>, result: Pick<ProviderTransportResult, "inputTokens" | "cachedInputTokens" | "outputTokens">, retries: number, correction: boolean) {
    const actualUsageCaptured = result.inputTokens !== undefined || result.outputTokens !== undefined;
    const usage = createInvocationUsageRecord({ invocationFingerprint: this.fingerprint(request) ?? randomUUID(), agentId: request.role, ...(request.contextBundle?.taskId ? { taskId: request.contextBundle.taskId } : {}), workflowStage: request.contextBundle?.workflowStage ?? request.role, role: request.role, ...(request.contextBundle?.contextBundleId ? { contextBundleId: request.contextBundle.contextBundleId } : {}), ...(request.contextBundle?.checksum ? { contextChecksum: request.contextBundle.checksum } : {}), provider: "openai", model: this.config.model, ...(result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens }), ...(result.cachedInputTokens === undefined ? {} : { cachedInputTokens: result.cachedInputTokens }), ...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }), ...(result.inputTokens !== undefined && result.outputTokens !== undefined ? { totalTokens: result.inputTokens + result.outputTokens } : {}), actualUsageCaptured, cacheTelemetryUnavailable: result.cachedInputTokens === undefined, prefixChecksum: request.promptPrefixChecksum ?? createHash("sha256").update(request.system, "utf8").digest("hex"), prefixBytes: request.promptPrefixBytes ?? Buffer.byteLength(request.system, "utf8"), contextMetrics: request.contextBundle?.metrics, requestCount: 1, retryCount: retries, correctionCount: correction ? 1 : 0, promptVersion: request.promptVersion }) as ProviderUsage;
    await this.usageSink?.(usage);
    return usage;
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

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeIssueToken(value: unknown) {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) ? value : undefined;
}

function safeIssuePath(path: readonly PropertyKey[]) {
  const rendered = path.length ? `$${path.map((part) => `.${String(part)}`).join("")}` : "$";
  const bounded = rendered.replace(/[^A-Za-z0-9_$.[\]/:-]/g, "_").slice(0, 240);
  return bounded || "$";
}

function boundedZodIssues(error: z.ZodError) {
  const issues = error.issues.map((issue) => {
    const code = zodIssueCode({ issues: [issue] }) ?? "INVALID_FIELD";
    const path = safeIssuePath(issue.path);
    const details = issue as unknown as { expected?: unknown; received?: unknown };
    const expected = safeIssueToken(details.expected);
    const received = safeIssueToken(details.received);
    return { path, code, ...(expected ? { expected } : {}), ...(received ? { received } : {}), message: `Provider wire schema validation failed at ${path}.` };
  });
  const completeZodIssuesChecksum = sha256Text(JSON.stringify(issues));
  return { zodIssuesBounded: issues.slice(0, 20), zodIssueCount: issues.length, zodIssuesTruncated: issues.length > 20, completeZodIssuesChecksum };
}

function rawContentDiagnostic(content: string): Pick<ProviderDiagnostic, "rawContentBytes" | "rawContentChecksum" | "contentPresent" | "contentLength"> {
  return { rawContentBytes: Buffer.byteLength(content, "utf8"), rawContentChecksum: sha256Text(content), contentPresent: true, contentLength: content.length };
}

/**
 * Parses provider wire content after the network response has been captured.
 * The raw content is accepted only in this bounded local seam and is never
 * copied into diagnostics or persistence; diagnostics retain byte counts and
 * checksums plus bounded schema issue metadata.
 */
export function parseProviderWireContent<T>(input: { content: string; schema: ZodType<T>; response: ProviderTransportResult }): ProviderParsedStructuredResult<T> {
  const contentMetadata = rawContentDiagnostic(input.content);
  const responseDiagnostic = { ...input.response.diagnostic, ...contentMetadata, responseReceived: true, apiResponseReceived: true, structuredParsingReached: true };
  let decoded: unknown;
  try {
    decoded = JSON.parse(input.content);
  } catch {
    throw new AiProviderError("AI_STRUCTURED_PARSE_FAILED", "Provider structured output was not valid JSON.", undefined, { ...responseDiagnostic, stage: "structured_parse", outputStage: "STRUCTURED_OUTPUT_PARSE_FAILED", jsonParseSucceeded: false, outputComplete: false });
  }
  const parsed = input.schema.safeParse(decoded);
  if (!parsed.success) {
    const issueMetadata = boundedZodIssues(parsed.error);
    throw new AiProviderError("AI_OUTPUT_DOMAIN_INVALID", "Provider structured output failed the strict transport schema.", undefined, { ...responseDiagnostic, stage: "domain_validation", outputStage: "TRANSPORT_SCHEMA_VALIDATION_FAILED", jsonParseSucceeded: true, outputComplete: false, issueCode: zodIssueCode(parsed.error), fieldPath: zodIssuePaths(parsed.error)?.[0], issueCount: zodIssueCount(parsed.error), domainValidationIssuePaths: zodIssuePaths(parsed.error), ...issueMetadata });
  }
  return { ...input.response, content: input.content, value: parsed.data, diagnostic: { ...responseDiagnostic, jsonParseSucceeded: true, outputComplete: true, parsedPresent: true } };
}

function completionResponseDiagnostic<T>(completion: ChatCompletion, request: StructuredRequest<T>, parsedPresent: boolean, outputComplete: boolean): ProviderDiagnostic {
  const choice = completion.choices[0];
  const message = choice?.message;
  const inputTokens = completion.usage?.prompt_tokens;
  const outputTokens = completion.usage?.completion_tokens;
  const maxCompletionTokens = request.maxCompletionTokens ?? DEFAULT_AI_MAX_COMPLETION_TOKENS;
  return { stage: "api_response", requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete, tokenExhaustion: choice?.finish_reason === "length" || (outputTokens !== undefined && outputTokens >= maxCompletionTokens), requestId: completion.id, choicesCount: completion.choices.length, finishReason: choice?.finish_reason ?? null, refusalPresent: Boolean(message?.refusal), parsedPresent, contentPresent: typeof message?.content === "string", contentLength: typeof message?.content === "string" ? message.content.length : undefined, schemaName: request.schemaName, inputTokens, outputTokens, ...(inputTokens !== undefined && outputTokens !== undefined ? { totalTokens: inputTokens + outputTokens } : {}), maxCompletionTokens };
}

async function manualExecutor<T>(request: StructuredRequest<T>, client: OpenAI, config: AiProviderConfig, correction: boolean, captureResponse: ProviderResponseCapture) {
  const responseSchema = buildProductionResponseFormat(request.schema, request.schemaName, { schemaDefinitions: request.schemaDefinitions });
  const correctionInstruction = request.role === "design" ? "\nReturn exactly 3 directions. Repair only the structural deficiency; do not omit, clone, or add a fourth direction." : "\nCorrect the previous structured-output formatting.";
  const completion = await client.chat.completions.create({ model: config.model, max_completion_tokens: request.maxCompletionTokens ?? config.maxCompletionTokens ?? DEFAULT_AI_MAX_COMPLETION_TOKENS, messages: [{ role: "system", content: `${request.system}${correction ? correctionInstruction : ""}` }, { role: "user", content: request.user }], response_format: responseSchema }, request.signal ? { signal: request.signal } : undefined) as unknown as ChatCompletion;
  const choice = completion.choices[0];
  const message = choice?.message;
  const inputTokens = completion.usage?.prompt_tokens;
  const outputTokens = completion.usage?.completion_tokens;
  const cachedInputTokens = completion.usage?.prompt_tokens_details?.cached_tokens;
  const responseDiagnostic = completionResponseDiagnostic(completion, request, false, false);
  await captureResponse({ requestId: completion.id, inputTokens, ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }), outputTokens, diagnostic: responseDiagnostic });
  if (message?.refusal) throw new AiProviderError("AI_OUTPUT_REFUSED", "The provider refused the structured request.", undefined, { ...responseDiagnostic, outputStage: "PROVIDER_REFUSAL", outputComplete: false });
  if (choice?.finish_reason === "length" || choice?.finish_reason === "content_filter") throw new AiProviderError("AI_OUTPUT_TRUNCATED", "The provider output was incomplete.", undefined, { ...responseDiagnostic, outputStage: "PROVIDER_OUTPUT_INCOMPLETE", outputComplete: false, tokenExhaustion: choice?.finish_reason === "length" });
  if (typeof message?.content !== "string" || message.content.length === 0) throw new AiProviderError("AI_OUTPUT_NO_PARSED_OUTPUT", "The provider returned no structured output content.", undefined, { ...responseDiagnostic, outputStage: "STRUCTURED_OUTPUT_PARSE_FAILED", outputComplete: false, contentPresent: false });
  const parsed = parseProviderWireContent({ content: message.content, schema: request.schema, response: { requestId: completion.id, inputTokens, ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }), outputTokens, diagnostic: responseDiagnostic } });
  return { value: parsed.value, requestId: parsed.requestId, inputTokens: parsed.inputTokens, ...(parsed.cachedInputTokens === undefined ? {} : { cachedInputTokens: parsed.cachedInputTokens }), outputTokens: parsed.outputTokens, diagnostic: parsed.diagnostic } as const;
}

async function defaultExecutor<T>(request: StructuredRequest<T>, client: OpenAI, config: AiProviderConfig, correction: boolean) {
  const responseSchema = buildProductionResponseFormat(request.schema, request.schemaName, { schemaDefinitions: request.schemaDefinitions });
  const correctionInstruction = request.role === "design" ? "\nReturn exactly 3 directions. Repair only the structural deficiency; do not omit, clone, or add a fourth direction." : "\nCorrect the previous structured-output formatting.";
  const completion = await client.chat.completions.parse({ model: config.model, max_completion_tokens: request.maxCompletionTokens ?? config.maxCompletionTokens ?? DEFAULT_AI_MAX_COMPLETION_TOKENS, messages: [{ role: "system", content: `${request.system}${correction ? correctionInstruction : ""}` }, { role: "user", content: request.user }], response_format: responseSchema }, request.signal ? { signal: request.signal } : undefined);
  const choice = completion.choices[0];
  const message = choice?.message;
  const inputTokens = completion.usage?.prompt_tokens;
  const outputTokens = completion.usage?.completion_tokens;
  const maxCompletionTokens = request.maxCompletionTokens ?? config.maxCompletionTokens ?? DEFAULT_AI_MAX_COMPLETION_TOKENS;
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

function elapsedBucket(elapsedMs: number) {
  if (elapsedMs < 10) return "LT_10_MS" as const;
  if (elapsedMs < 100) return "LT_100_MS" as const;
  if (elapsedMs < 1_000) return "LT_1_S" as const;
  if (elapsedMs < 10_000) return "LT_10_S" as const;
  if (elapsedMs < 60_000) return "LT_60_S" as const;
  return "GTE_60_S" as const;
}

function endpointClass(baseURL: unknown) {
  if (typeof baseURL !== "string") return "OPENAI_API_DEFAULT";
  try {
    const parsed = new URL(baseURL);
    return parsed.hostname === "api.openai.com" && parsed.pathname.startsWith("/v1")
      ? "OPENAI_CHAT_COMPLETIONS_API"
      : "CUSTOM_PROVIDER_ENDPOINT";
  } catch {
    return "UNKNOWN_PROVIDER_ENDPOINT";
  }
}

function requestMetadata<T>(request: StructuredRequest<T>, responseFormat: unknown, client: OpenAI, config: AiProviderConfig, correction: boolean): Partial<ProviderDiagnostic> {
  const correctionInstruction = request.role === "design" ? "\nReturn exactly 3 directions. Repair only the structural deficiency; do not omit, clone, or add a fourth direction." : "\nCorrect the previous structured-output formatting.";
  const system = `${request.system}${correction ? correctionInstruction : ""}`;
  const inputBytes = Buffer.byteLength(`${system}\n${request.user}`, "utf8");
  const schemaJson = JSON.stringify(responseFormat);
  const schemaSizeBytes = schemaJson === undefined ? undefined : Buffer.byteLength(schemaJson, "utf8");
  const requestJson = JSON.stringify({ model: config.model, max_completion_tokens: request.maxCompletionTokens ?? config.maxCompletionTokens ?? DEFAULT_AI_MAX_COMPLETION_TOKENS, messages: [{ role: "system", content: system }, { role: "user", content: request.user }], response_format: responseFormat });
  const requestSizeBytes = requestJson === undefined ? undefined : Buffer.byteLength(requestJson, "utf8");
  const timeoutConfiguredMs = typeof client.timeout === "number" && Number.isInteger(client.timeout) && client.timeout > 0 && client.timeout <= 86_400_000 ? client.timeout : undefined;
  const configuredMaxRetries = typeof client.maxRetries === "number" && Number.isInteger(client.maxRetries) && client.maxRetries >= 0 && client.maxRetries <= 8 ? client.maxRetries : config.maxRetries;
  return {
    endpointClass: endpointClass(client.baseURL),
    ...(timeoutConfiguredMs === undefined ? {} : { timeoutConfiguredMs }),
    configuredMaxRetries,
    ...(requestSizeBytes === undefined ? {} : { requestSizeBytes }),
    inputBytes,
    ...(schemaSizeBytes === undefined ? {} : { schemaSizeBytes }),
    maxCompletionTokens: request.maxCompletionTokens ?? config.maxCompletionTokens ?? DEFAULT_AI_MAX_COMPLETION_TOKENS,
  };
}

function safeClassName(error: unknown) { return error instanceof Error && error.constructor?.name ? error.constructor.name : typeof error === "object" && error ? "SdkError" : "Error"; }
function safeString(value: unknown) { return typeof value === "string" && value.length <= 160 ? value : undefined; }
function safeProviderMessage(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? normalized.slice(0, 500) : normalized || undefined;
}
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
function diagnosticForError(error: unknown, schemaName: string, requestAttempted: boolean, outputStage: ProviderOutputStage = requestAttempted ? "PROVIDER_REQUEST_FAILED" : "REQUEST_SCHEMA_CONSTRUCTION_FAILED", context: Partial<ProviderDiagnostic> = {}): ProviderDiagnostic {
  const shape = safeProviderErrorShape(error);
  const apiError = shape.error ?? {};
  const responseReceived = safeStatus(shape.status) !== undefined;
  const diagnosticBase: ProviderDiagnostic = { stage: requestAttempted ? "api_request" : "structured_parse", outputStage, requestAttempted, apiResponseReceived: responseReceived, responseReceived, outputComplete: false, httpStatus: safeStatus(shape.status), requestId: safeString(shape.requestID) ?? safeString(shape.request_id), sdkErrorClass: safeClassName(error), openaiErrorType: safeString(apiError.type) ?? safeString(shape.type), openaiErrorCode: safeString(apiError.code) ?? safeString(shape.code), openaiErrorParam: safeString(apiError.param) ?? safeString(shape.param), openaiErrorMessage: safeProviderMessage(apiError.message), schemaName };
  const diagnostic = { ...diagnosticBase, ...context } as ProviderDiagnostic;
  const transport = classifyProviderTransportFailure({ errorCode: "AI_OUTPUT_INVALID", requestAttempted, diagnostic, error });
  return { ...diagnostic, ...(transport ?? {}) };
}
function withFailureDiagnostic(error: AiProviderError, schemaName: string, requestAttempted: boolean, model: string, context: Partial<ProviderDiagnostic> = {}): AiProviderError {
  const effectiveRequestAttempted = error.diagnostic?.requestAttempted ?? requestAttempted;
  const diagnostic = { ...error.diagnostic, ...context } as ProviderDiagnostic;
  if (!Object.keys(context).length && error.failureDiagnostic?.errorCode === error.code && error.failureDiagnostic.schemaName === schemaName && error.failureDiagnostic.model === model) return error;
  return new AiProviderError(error.code, error.message, error.cause, diagnostic, createProviderFailureDiagnostic({ errorCode: error.code, model, schemaName, requestAttempted: effectiveRequestAttempted, diagnostic, error: error.cause ?? error }));
}

function mapError(error: unknown, schemaName = "unknown", requestAttempted = true, model = "unknown", context: Partial<ProviderDiagnostic> = {}): AiProviderError {
  if (isAiProviderError(error)) return withFailureDiagnostic(error, schemaName, requestAttempted, model, context);
  if (error instanceof z.ZodError) return withFailureDiagnostic(new AiProviderError("AI_STRUCTURED_PARSE_FAILED", "Provider structured output could not be parsed safely.", error, { ...diagnosticForError(error, schemaName, requestAttempted, "STRUCTURED_OUTPUT_PARSE_FAILED", context), stage: "structured_parse", issueCode: zodIssueCode(error), fieldPath: zodIssuePaths(error)?.[0], issueCount: zodIssueCount(error), domainValidationIssuePaths: zodIssuePaths(error) }), schemaName, requestAttempted, model);
  const shape = safeProviderErrorShape(error);
  const status = safeStatus(shape.status);
  const code = safeString((shape.error ?? {}).code) ?? safeString(shape.code);
  const diagnostic = diagnosticForError(error, schemaName, requestAttempted, undefined, context);
  const transportClass = diagnostic.transportFailureClass;
  let mapped: AiProviderError;
  if (status === 400 && (code === "unsupported_value" || code === "unsupported_parameter" || code === "unknown_parameter")) mapped = new AiProviderError("AI_REQUEST_PARAMETER_UNSUPPORTED", "AI provider rejected an unsupported request parameter.", error, diagnostic);
  else if (status === 400) mapped = new AiProviderError("AI_REQUEST_INVALID", "AI provider rejected the request contract.", error, diagnostic);
  else if (status === 401 || status === 403) mapped = new AiProviderError("AI_AUTHENTICATION_FAILED", "AI provider authentication failed.", undefined, diagnostic);
  else if (status === 404) mapped = new AiProviderError("AI_MODEL_ACCESS_FAILED", "AI provider rejected model access.", undefined, diagnostic);
  else if (status === 429) mapped = new AiProviderError("AI_RATE_LIMITED", "AI provider rate limit reached.", undefined, diagnostic);
  else if (status !== undefined && status >= 500) mapped = new AiProviderError("AI_PROVIDER_UNAVAILABLE", "AI provider is unavailable.", undefined, diagnostic);
  else if (transportClass === "REQUEST_ABORTED" || shape.name === "AbortError") mapped = new AiProviderError("AI_REQUEST_CANCELLED", "AI provider request was cancelled.", undefined, diagnostic);
  else if (transportClass === "CONNECT_TIMEOUT" || transportClass === "RESPONSE_TIMEOUT" || shape.name === "APIConnectionTimeoutError" || code === "ETIMEDOUT") mapped = new AiProviderError("AI_REQUEST_TIMEOUT", "AI provider request timed out safely.", undefined, diagnostic);
  else if (transportClass && transportClass !== "HTTP_ERROR_RESPONSE") mapped = new AiProviderError("AI_NETWORK_ERROR", "AI provider network request failed safely.", undefined, diagnostic);
  else mapped = new AiProviderError("AI_OUTPUT_INVALID", "AI provider request failed safely.", error, diagnostic);
  return withFailureDiagnostic(mapped, schemaName, requestAttempted, model);
}
function isRetryable(error: AiProviderError) { return ["AI_PROVIDER_UNAVAILABLE", "AI_RATE_LIMITED", "AI_NETWORK_ERROR"].includes(error.code); }
