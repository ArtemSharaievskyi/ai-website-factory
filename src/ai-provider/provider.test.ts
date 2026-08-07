import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAiStructuredClient } from "./client";
import { AiProviderError } from "./errors";
import { FifoConcurrencyLimiter } from "./limiter";
import { zodResponseFormat } from "openai/helpers/zod";
import { BriefDraftStructuredOutputSchema, DesignDirectionStructuredOutputSchema, PlanningPackageStructuredOutputSchema } from "./adapters";
import { readAiProviderConfig } from "./config";

const config = { apiKey: "test", model: "test-model", modelLabel: "GPT-5.6 Luna", timeoutMs: 1000, roleTimeoutMs: { planner: 1000 }, maxRetries: 1, maxConcurrentRequests: 1 };
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
  it("uses the bounded Planner role timeout without changing the global default", async () => { const calls: string[] = []; const client = new OpenAiStructuredClient({ ...config, timeoutMs: 10, roleTimeoutMs: { planner: 30 } }, { executor: async <T>(value: { role: string }) => { calls.push(value.role); await new Promise((resolve) => setTimeout(resolve, 20)); return { value: { ok: true, summary: "bounded" } as T, requestId: "req_planner" }; } }); await expect(client.request({ ...request, role: "planner", idempotencyKey: "planner-timeout-override" })).resolves.toMatchObject({ value: { ok: true } }); await expect(client.request({ ...request, role: "lead", idempotencyKey: "global-timeout" })).rejects.toMatchObject({ code: "AI_RETRY_EXHAUSTED" }); expect(calls).toEqual(["planner", "lead", "lead"]); });
  it("rejects an invalid Planner timeout without exposing configuration values", () => { expect(() => readAiProviderConfig({ OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model", OPENAI_PLANNER_REQUEST_TIMEOUT_MS: "invalid" })).toThrowError(/configuration/i); });
  it("maps refusal and cancellation to stable errors", async () => { const refused = new OpenAiStructuredClient(config, { executor: async () => { throw new AiProviderError("AI_OUTPUT_REFUSED", "refused"); } }); await expect(refused.request({ ...request, idempotencyKey: "refused" })).rejects.toMatchObject({ code: "AI_OUTPUT_REFUSED" }); const controller = new AbortController(); controller.abort(); const client = new OpenAiStructuredClient(config, { executor: validExecutor }); await expect(client.request({ ...request, signal: controller.signal, idempotencyKey: "cancel" })).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED" }); });
  it("keeps queued work FIFO and bounds overflow", async () => { const limiter = new FifoConcurrencyLimiter(1, 0); const release = vi.fn(); const first = limiter.run(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); release(); return 1; }); await expect(limiter.run(async () => 2)).rejects.toMatchObject({ code: "AI_CONCURRENCY_LIMIT_REACHED" }); await expect(first).resolves.toBe(1); expect(release).toHaveBeenCalled(); });
});
