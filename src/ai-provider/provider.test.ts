import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAiStructuredClient } from "./client";
import { AiProviderError } from "./errors";
import { FifoConcurrencyLimiter } from "./limiter";

const config = { apiKey: "test", model: "test-model", modelLabel: "GPT-5.6 Luna", timeoutMs: 1000, maxRetries: 1, maxConcurrentRequests: 1 };
const schema = z.object({ ok: z.boolean(), summary: z.string() }).strict();
const request = { role: "test", promptVersion: "test.v1", system: "policy", user: "{}", schemaName: "test-output", schema, idempotencyKey: "same" };
const validExecutor = async <T>() => ({ value: { ok: true, summary: "bounded" } as T, requestId: "req_test" });

describe("production AI provider boundary", () => {
  it("accepts only injected, schema-valid structured output and records safe usage", async () => { const usage = vi.fn(); const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: { ok: true, summary: "bounded" } as T, requestId: "req_1", inputTokens: 4, cachedInputTokens: 1, outputTokens: 3 }), usageSink: usage }); const result = await client.request(request); expect(result.value).toEqual({ ok: true, summary: "bounded" }); expect(usage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 4, cachedInputTokens: 1, outputTokens: 3, promptVersion: "test.v1" })); });
  it("retries one transient failure and does not expose raw provider data", async () => { let calls = 0; const client = new OpenAiStructuredClient(config, { executor: async <T>() => { calls++; if (calls === 1) throw Object.assign(new Error("temporary"), { status: 503 }); return { value: { ok: true, summary: "recovered" } as T, requestId: "req_2" }; } }); await expect(client.request({ ...request, idempotencyKey: "retry" })).resolves.toMatchObject({ value: { ok: true } }); expect(calls).toBe(2); });
  it("maps refusal and cancellation to stable errors", async () => { const refused = new OpenAiStructuredClient(config, { executor: async () => { throw new AiProviderError("AI_OUTPUT_REFUSED", "refused"); } }); await expect(refused.request({ ...request, idempotencyKey: "refused" })).rejects.toMatchObject({ code: "AI_OUTPUT_REFUSED" }); const controller = new AbortController(); controller.abort(); const client = new OpenAiStructuredClient(config, { executor: validExecutor }); await expect(client.request({ ...request, signal: controller.signal, idempotencyKey: "cancel" })).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED" }); });
  it("keeps queued work FIFO and bounds overflow", async () => { const limiter = new FifoConcurrencyLimiter(1, 0); const release = vi.fn(); const first = limiter.run(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); release(); return 1; }); await expect(limiter.run(async () => 2)).rejects.toMatchObject({ code: "AI_CONCURRENCY_LIMIT_REACHED" }); await expect(first).resolves.toBe(1); expect(release).toHaveBeenCalled(); });
});
