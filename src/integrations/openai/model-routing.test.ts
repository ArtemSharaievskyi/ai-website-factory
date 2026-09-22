import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LUNA_MODEL, WEBSITE_GENERATION_ROLES } from "./config";
import { OpenAiStructuredClient, type StructuredRequest } from "./client";

const schema = z.object({ ok: z.boolean() }).strict();
const base = (role: string): StructuredRequest<{ ok: boolean }> => ({ role, promptVersion: "routing.fixture.v1", system: "bounded", user: "synthetic", schemaName: "routing-fixture", schema, idempotencyKey: `routing-${role}` });

describe("website-generation model routing", () => {
  it("adds the exact typed xhigh reasoning object to every applicable Luna role", async () => {
    const captured: StructuredRequest<unknown>[] = [];
    const client = new OpenAiStructuredClient({ apiKey: "synthetic", model: LUNA_MODEL, modelLabel: "GPT-5.6 Luna", maxRetries: 0, maxConcurrentRequests: 1 }, { executor: async <T>(request: StructuredRequest<T>) => { captured.push(request as StructuredRequest<unknown>); return { value: { ok: true } as T, requestId: `routing-${request.role}` }; } });
    for (const role of WEBSITE_GENERATION_ROLES) await client.request(base(role));
    expect(captured.map((request) => request.reasoning)).toEqual(WEBSITE_GENERATION_ROLES.map(() => ({ effort: "xhigh" })));
    expect(JSON.stringify(captured)).not.toContain("extra high");
  });

  it("leaves unrelated reviewer routing unchanged", async () => {
    let captured: StructuredRequest<unknown> | undefined;
    const client = new OpenAiStructuredClient({ apiKey: "synthetic", model: LUNA_MODEL, modelLabel: "GPT-5.6 Luna", maxRetries: 0, maxConcurrentRequests: 1 }, { executor: async <T>(request: StructuredRequest<T>) => { captured = request as StructuredRequest<unknown>; return { value: { ok: true } as T, requestId: "review-routing" }; } });
    await client.request(base("security-reviewer"));
    expect(captured).not.toHaveProperty("reasoning");
  });

  it("rejects an explicit reasoning/model mismatch before executor dispatch", async () => {
    let calls = 0;
    const client = new OpenAiStructuredClient({ apiKey: "synthetic", model: "other-model", modelLabel: "Other", maxRetries: 0, maxConcurrentRequests: 1 }, { executor: async <T>() => { calls += 1; return { value: { ok: true } as T, requestId: "must-not-run" }; } });
    await expect(client.request({ ...base("planner"), reasoning: { effort: "xhigh" } })).rejects.toMatchObject({ code: "AI_MODEL_REASONING_UNSUPPORTED", diagnostic: { requestAttempted: false } });
    expect(calls).toBe(0);
  });
});
