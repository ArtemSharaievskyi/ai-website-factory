import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProviderFailureDiagnosticSchema } from "@/domain/shared/provider-failure";
import { OpenAiStructuredClient } from "./client";
import type { AiProviderError } from "./errors";

const config = { apiKey: "synthetic", model: "synthetic-model", modelLabel: "Synthetic", maxRetries: 0, maxConcurrentRequests: 1 };
const schema = z.object({ ok: z.boolean() }).strict();
const request = { role: "lead", promptVersion: "synthetic.v1", system: "bounded policy", user: "bounded input", schemaName: "brief-v3-revision", schema };

async function failureFor(error: unknown) {
  const client = new OpenAiStructuredClient(config, { executor: async () => { throw error; } });
  try {
    await client.request(request);
    throw new Error("expected synthetic provider failure");
  } catch (failure) {
    return failure as AiProviderError;
  }
}

describe("provider failure diagnostic normalization", () => {
  it.each([
    ["authentication", Object.assign(new Error("SECRET_AUTH_MESSAGE"), { status: 401, requestID: "req_auth", error: { type: "authentication_error", code: "invalid_api_key" } }), { category: "AUTHENTICATION", stage: "REQUEST_TRANSPORT", responseReceived: true, structuredParsingReached: false, httpStatus: 401, requestId: "req_auth", providerErrorCode: "invalid_api_key" }],
    ["rate limit", Object.assign(new Error("SECRET_RATE_MESSAGE"), { status: 429, requestID: "req_rate", error: { type: "rate_limit_error", code: "rate_limit_exceeded" } }), { category: "RATE_LIMIT", stage: "REQUEST_TRANSPORT", responseReceived: true, structuredParsingReached: false, retryabilityHint: true, httpStatus: 429, requestId: "req_rate" }],
    ["provider unavailable", Object.assign(new Error("SECRET_SERVER_MESSAGE"), { status: 503, requestID: "req_server" }), { category: "PROVIDER_UNAVAILABLE", stage: "REQUEST_TRANSPORT", responseReceived: true, structuredParsingReached: false, retryabilityHint: true, httpStatus: 503, requestId: "req_server" }],
    ["network", Object.assign(new Error("SECRET_NETWORK_MESSAGE"), { code: "ECONNRESET" }), { category: "NETWORK", stage: "REQUEST_TRANSPORT", responseReceived: false, structuredParsingReached: false, retryabilityHint: true }],
    ["unknown", new Error("SECRET_UNKNOWN_MESSAGE"), { category: "UNKNOWN", stage: "REQUEST_TRANSPORT", requestAttempted: true }],
  ] as const)("records safe metadata for %s failures", async (_name, error, expected) => {
    const failure = await failureFor(error);
    expect(failure.code).toMatch(/^AI_/);
    expect(failure.failureDiagnostic).toMatchObject({ version: 1, provider: "openai", model: "synthetic-model", schemaName: "brief-v3-revision", sdkErrorClass: "Error", errorCode: failure.code, ...expected });
    expect(ProviderFailureDiagnosticSchema.safeParse(failure.failureDiagnostic).success).toBe(true);
    expect(JSON.stringify(failure.failureDiagnostic)).not.toContain("SECRET_");
  });

  it("records structured-output parsing as reached without retaining response content", async () => {
    const client = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async () => ({ id: "req_parse", choices: [{ message: { content: "SECRET_RESPONSE_CONTENT" }, finish_reason: "stop" }], usage: {} }) } } } as never });
    let failure: AiProviderError | undefined;
    try {
      await client.request(request);
    } catch (error) {
      failure = error as AiProviderError;
    }
    expect(failure?.code).toBe("AI_OUTPUT_NO_PARSED_OUTPUT");
    expect(failure?.failureDiagnostic).toMatchObject({ category: "STRUCTURED_OUTPUT", stage: "PROVIDER_RESPONSE", requestAttempted: true, responseReceived: true, structuredParsingReached: true, requestId: "req_parse", errorCode: "AI_OUTPUT_NO_PARSED_OUTPUT" });
    expect(JSON.stringify(failure?.failureDiagnostic)).not.toContain("SECRET_RESPONSE_CONTENT");
  });

  it("records local request construction separately and proves the provider was not attempted", async () => {
    const invalidSchema = z.object({ optional: z.string().optional() }).strict();
    let calls = 0;
    const client = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async () => { calls += 1; return { id: "should-not-run", choices: [], usage: {} }; } } } } as never });
    let failure: AiProviderError | undefined;
    try {
      await client.request({ ...request, schema: invalidSchema, schemaName: "invalid-optional-schema" });
    } catch (error) {
      failure = error as AiProviderError;
    }
    expect(calls).toBe(0);
    expect(failure?.failureDiagnostic).toMatchObject({ category: "REQUEST_CONSTRUCTION", stage: "REQUEST_CONSTRUCTION", requestAttempted: false, responseReceived: false, structuredParsingReached: false, errorCode: "AI_REQUEST_SCHEMA_INVALID", schemaName: "invalid-optional-schema" });
    expect(failure?.failureDiagnostic).not.toHaveProperty("httpStatus");
  });
});
