import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LUNA_MODEL } from "./config";
import { OpenAiStructuredClient } from "./client";

describe("Luna Responses API production transport", () => {
  it("sends the typed nested xhigh reasoning field through the fake provider HTTP boundary", async () => {
    let sent: Record<string, unknown> | undefined;
    const client = new OpenAiStructuredClient({ apiKey: "synthetic", model: LUNA_MODEL, modelLabel: "GPT-5.6 Luna", maxRetries: 0, maxConcurrentRequests: 1 }, {
      client: { responses: { create: async (request: Record<string, unknown>) => { sent = request; return { id: "resp_fixture", status: "completed", output_text: JSON.stringify({ ok: true }), output: [{ type: "message" }], usage: { input_tokens: 7, output_tokens: 5, total_tokens: 12 } }; } } } as never,
    });
    const result = await client.request({ role: "planner", promptVersion: "responses.fixture.v1", system: "bounded system", user: "bounded user", schemaName: "responses-fixture", schema: z.object({ ok: z.boolean() }).strict() });
    expect(result.value).toEqual({ ok: true });
    expect(sent).toMatchObject({ model: LUNA_MODEL, reasoning: { effort: "xhigh" }, store: false, stream: false, text: { format: { type: "json_schema", strict: true, name: "responses-fixture" } } });
    expect(sent).not.toHaveProperty("reasoning_effort");
    expect(result.usage).toMatchObject({ inputTokens: 7, outputTokens: 5, totalTokens: 12, reasoningEffort: "xhigh" });
    expect(result.diagnostic).toMatchObject({ requestId: "resp_fixture", reasoningEffort: "xhigh", outputComplete: true });
  });
});
