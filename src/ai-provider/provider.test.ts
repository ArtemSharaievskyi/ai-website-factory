import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { z } from "zod";
import { OpenAiStructuredClient } from "./client";
import { AiProviderError } from "./errors";
import { FifoConcurrencyLimiter } from "./limiter";
import { zodResponseFormat } from "openai/helpers/zod";
import { BriefDraftStructuredOutputSchema, DesignDirectionStructuredOutputSchema, ImplementationChangeProposalStructuredOutputSchema, OpenAiImplementationProvider, PlanningPackageStructuredOutputSchema } from "./adapters";
import { readAiProviderConfig } from "./config";

const config = { apiKey: "test", model: "test-model", modelLabel: "GPT-5.6 Luna", maxRetries: 1, maxConcurrentRequests: 1 };
const schema = z.object({ ok: z.boolean(), summary: z.string() }).strict();
const request = { role: "test", promptVersion: "test.v1", system: "policy", user: "{}", schemaName: "test-output", schema, idempotencyKey: "same" };
const validExecutor = async <T>() => ({ value: { ok: true, summary: "bounded" } as T, requestId: "req_test" });

describe("production AI provider boundary", () => {
  it("uses a strict Brief transport schema while preserving nullable optional domain values", () => {
    expect(() => zodResponseFormat(BriefDraftStructuredOutputSchema, "brief-draft")).not.toThrow();
  });
  it("uses a strict Planner transport schema without weakening the canonical package", () => {
    expect(() => zodResponseFormat(PlanningPackageStructuredOutputSchema, "planning-package")).not.toThrow();
  });
  it("uses a strict Design transport schema without weakening the canonical direction set", () => {
    expect(() => zodResponseFormat(DesignDirectionStructuredOutputSchema, "design-direction-set")).not.toThrow();
  });
  it("uses a strict Implementation transport schema and normalizes nullable optional fields", async () => {
    expect(() => zodResponseFormat(ImplementationChangeProposalStructuredOutputSchema, "implementation-change-proposal")).not.toThrow();
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: { proposalId: "11111111-1111-4111-8111-111111111111", projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 1, taskId: "33333333-3333-4333-8333-333333333333", taskAttempt: 1, summary: "proposal", operations: [{ type: "create-file", relativePath: "src/app/page.tsx", expectedPriorChecksum: null, expectedResultChecksum: "a".repeat(64), encoding: "utf-8", reason: "approved", requirementReferences: ["requirement"], planningReferences: ["planning"], selectedDesignReferences: [], content: "export default function Page() {}" }], expectedChangedFiles: ["src/app/page.tsx"], expectedCreatedFiles: ["src/app/page.tsx"], expectedDeletedFiles: [], validationPlan: ["build"], requirementReferences: ["requirement"], planningReferences: ["planning"], selectedDesignReferences: [], providerMetadata: { provider: "openai", inputTokens: null, outputTokens: null }, generatedAt: "2026-08-07T00:00:00.000Z" } as T, requestId: "req_implementation" }) });
    const result = await new OpenAiImplementationProvider(client).proposeTaskChanges({ task: { id: "33333333-3333-4333-8333-333333333333" }, contextChecksum: "b".repeat(64) } as never);
    expect(result.operations[0]).not.toHaveProperty("expectedPriorChecksum");
    expect(result.operations[0]?.expectedResultChecksum).toBe(createHash("sha256").update("export default function Page() {}", "utf8").digest("hex"));
    expect(result.providerMetadata).toEqual({ provider: "openai" });
  });
  it("passes the configured model unchanged through the official structured API", async () => {
    let sent: Record<string, unknown> | undefined;
    const client = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async (value: Record<string, unknown>) => { sent = value; return { id: "req_model", choices: [{ message: { parsed: { ok: true, summary: "bounded" } }, finish_reason: "stop" }], usage: {} }; } } } } as never });
    await expect(client.request(request)).resolves.toMatchObject({ value: { ok: true, summary: "bounded" } });
    expect(sent).toMatchObject({ model: "test-model", response_format: expect.anything() });
    expect(sent).not.toHaveProperty("temperature");
  });

  it("maps unsupported request parameters safely without retrying", async () => {
    let calls = 0;
    const client = new OpenAiStructuredClient(config, { executor: async () => { calls++; throw Object.assign(new Error("provider detail"), { status: 400, error: { code: "unsupported_value", param: "temperature" } }); } });
    await expect(client.request({ ...request, idempotencyKey: "unsupported-parameter" })).rejects.toMatchObject({ code: "AI_REQUEST_PARAMETER_UNSUPPORTED" });
    expect(calls).toBe(1);
  });

  it("accepts only injected, schema-valid structured output and records safe usage", async () => { const usage = vi.fn(); const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: { ok: true, summary: "bounded" } as T, requestId: "req_1", inputTokens: 4, cachedInputTokens: 1, outputTokens: 3 }), usageSink: usage }); const result = await client.request(request); expect(result.value).toEqual({ ok: true, summary: "bounded" }); expect(usage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 4, cachedInputTokens: 1, outputTokens: 3, promptVersion: "test.v1" })); });
  it("retries one transient failure and does not expose raw provider data", async () => { let calls = 0; const client = new OpenAiStructuredClient(config, { executor: async <T>() => { calls++; if (calls === 1) throw Object.assign(new Error("temporary"), { status: 503 }); return { value: { ok: true, summary: "recovered" } as T, requestId: "req_2" }; } }); await expect(client.request({ ...request, idempotencyKey: "retry" })).resolves.toMatchObject({ value: { ok: true } }); expect(calls).toBe(2); });
  it("does not abort a slow Planner response at the former Factory timeout", async () => { const started = Date.now(); const client = new OpenAiStructuredClient(config, { executor: async <T>() => { await new Promise((resolve) => setTimeout(resolve, 30)); return { value: { ok: true, summary: "slow-but-valid" } as T, requestId: "req_planner" }; } }); await expect(client.request({ ...request, role: "planner", idempotencyKey: "planner-no-timeout" })).resolves.toMatchObject({ value: { ok: true } }); expect(Date.now() - started).toBeGreaterThanOrEqual(25); });
  it("preserves explicit cancellation and records safe timing metadata", async () => { const events: Array<Record<string, unknown>> = []; const controller = new AbortController(); const client = new OpenAiStructuredClient(config, { eventSink: (event) => events.push(event), executor: async (value: { signal?: AbortSignal }) => await new Promise((_, reject) => { const cancel = () => reject(new AiProviderError("AI_REQUEST_CANCELLED", "AI request was cancelled.")); if (value.signal?.aborted) cancel(); else value.signal?.addEventListener("abort", cancel, { once: true }); }) }); const pending = client.request({ ...request, signal: controller.signal, idempotencyKey: "explicit-cancel" }); await new Promise((resolve) => setTimeout(resolve, 0)); controller.abort(); await expect(pending).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED" }); expect(events.at(-1)).toMatchObject({ type: "request.failed", code: "AI_REQUEST_CANCELLED", elapsedMs: expect.any(Number), startedAt: expect.any(String), completedAt: expect.any(String) }); });
  it("ignores obsolete AI timeout environment values", () => { const parsed = readAiProviderConfig({ OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model", OPENAI_REQUEST_TIMEOUT_MS: "not-a-number", OPENAI_PLANNER_REQUEST_TIMEOUT_MS: "invalid", OPENAI_DESIGN_REQUEST_TIMEOUT_MS: "invalid" }); expect(parsed).not.toHaveProperty("timeoutMs"); expect(parsed).not.toHaveProperty("roleTimeoutMs"); });
  it("maps refusal and cancellation to stable errors", async () => { const refused = new OpenAiStructuredClient(config, { executor: async () => { throw new AiProviderError("AI_OUTPUT_REFUSED", "refused"); } }); await expect(refused.request({ ...request, idempotencyKey: "refused" })).rejects.toMatchObject({ code: "AI_OUTPUT_REFUSED" }); const controller = new AbortController(); controller.abort(); const client = new OpenAiStructuredClient(config, { executor: validExecutor }); await expect(client.request({ ...request, signal: controller.signal, idempotencyKey: "cancel" })).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED" }); });
  it("keeps queued work FIFO and bounds overflow", async () => { const limiter = new FifoConcurrencyLimiter(1, 0); const release = vi.fn(); const first = limiter.run(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); release(); return 1; }); await expect(limiter.run(async () => 2)).rejects.toMatchObject({ code: "AI_CONCURRENCY_LIMIT_REACHED" }); await expect(first).resolves.toBe(1); expect(release).toHaveBeenCalled(); });
});
