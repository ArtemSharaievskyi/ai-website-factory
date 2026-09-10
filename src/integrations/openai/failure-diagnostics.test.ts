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
    expect(failure?.failureDiagnostic).not.toHaveProperty("transportFailureClass");
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

  it("retains only bounded provider error metadata and the normalized API message", async () => {
    const failure = await failureFor(Object.assign(new Error("SECRET_SDK_MESSAGE"), {
      status: 400,
      request_id: "req_schema_rejected",
      error: {
        type: "invalid_request_error",
        code: "invalid_json_schema",
        param: "response_format",
        message: "Schema rejected: total enum values exceed the supported limit.\nNo request content is retained.",
      },
    }));
    expect(failure.failureDiagnostic).toMatchObject({
      category: "REQUEST_REJECTED",
      stage: "REQUEST_TRANSPORT",
      httpStatus: 400,
      requestId: "req_schema_rejected",
      providerErrorType: "invalid_request_error",
      providerErrorCode: "invalid_json_schema",
      providerErrorParam: "response_format",
      safeProviderMessage: "Schema rejected: total enum values exceed the supported limit. No request content is retained.",
    });
    expect(JSON.stringify(failure.failureDiagnostic)).not.toContain("SECRET_");
    expect(ProviderFailureDiagnosticSchema.safeParse(failure.failureDiagnostic).success).toBe(true);
  });

  it.each([
    ["DNS resolution", Object.assign(new Error("SECRET_DNS"), { code: "ENOTFOUND" }), "AI_NETWORK_ERROR", "DNS", "DNS_RESOLUTION_FAILED", "ENOTFOUND"],
    ["connection refused", Object.assign(new Error("SECRET_CONNECT"), { code: "ECONNREFUSED" }), "AI_NETWORK_ERROR", "CONNECT", "CONNECT_FAILED", "ECONNREFUSED"],
    ["network unreachable", Object.assign(new Error("SECRET_UNREACHABLE"), { code: "EHOSTUNREACH" }), "AI_NETWORK_ERROR", "CONNECT", "CONNECT_FAILED", "EHOSTUNREACH"],
    ["connection reset", Object.assign(new Error("SECRET_RESET"), { code: "ECONNRESET" }), "AI_NETWORK_ERROR", "UNKNOWN", "CONNECTION_RESET", "ECONNRESET"],
    ["connect timeout", Object.assign(new Error("SECRET_TIMEOUT"), { name: "ConnectTimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" }), "AI_REQUEST_TIMEOUT", "CONNECT", "CONNECT_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT"],
    ["request abort", Object.assign(new Error("SECRET_ABORT"), { name: "AbortError", code: "ABORT_ERR" }), "AI_REQUEST_CANCELLED", "UNKNOWN", "REQUEST_ABORTED", "ABORT_ERR"],
    ["HTTP error response", Object.assign(new Error("SECRET_HTTP"), { status: 502, requestID: "req_http" }), "AI_PROVIDER_UNAVAILABLE", "RESPONSE_HEADERS", "HTTP_ERROR_RESPONSE", undefined],
    ["unknown SDK transport", Object.assign(new Error("SECRET_UNKNOWN_TRANSPORT"), { name: "APIConnectionError" }), "AI_NETWORK_ERROR", "UNKNOWN", "UNKNOWN_TRANSPORT_FAILURE", undefined],
  ] as const)("classifies bounded %s transport evidence", async (_name, error, code, phase, failureClass, causeCode) => {
    const failure = await failureFor(error);
    expect(failure).toMatchObject({ code });
    expect(failure.failureDiagnostic).toMatchObject({
      transportPhase: phase,
      transportFailureClass: failureClass,
      ...(causeCode ? { transportCauseCode: causeCode } : {}),
      responseReceived: code === "AI_PROVIDER_UNAVAILABLE" ? true : false,
    });
    expect(JSON.stringify(failure.failureDiagnostic)).not.toContain("SECRET_");
    expect(ProviderFailureDiagnosticSchema.safeParse(failure.failureDiagnostic).success).toBe(true);
  });

  it("walks a bounded nested cause chain and retains transport metrics without private values", async () => {
    const cause = Object.assign(new Error("SECRET_NESTED_DNS"), { code: "ENOTFOUND" });
    const failure = await failureFor(Object.assign(new Error("SECRET_WRAPPER"), { cause }));
    expect(failure.failureDiagnostic).toMatchObject({
      transportPhase: "DNS",
      transportFailureClass: "DNS_RESOLUTION_FAILED",
      transportCauseCode: "ENOTFOUND",
      endpointClass: "OPENAI_CHAT_COMPLETIONS_API",
      timeoutConfiguredMs: 600_000,
      configuredMaxRetries: 0,
      elapsedBucket: expect.stringMatching(/^LT_|^GTE_/),
    });
    expect(failure.failureDiagnostic?.requestSizeBytes).toBeGreaterThan(0);
    expect(failure.failureDiagnostic?.inputBytes).toBeGreaterThan(0);
    expect(failure.failureDiagnostic?.schemaSizeBytes).toBeGreaterThan(0);
    expect(JSON.stringify(failure.failureDiagnostic)).not.toContain("SECRET_");
  });

  it("does not loop through a cyclic cause graph and does not promote a plain unknown error", async () => {
    const cyclic = Object.assign(new Error("SECRET_CYCLE"), { code: "NOT_ALLOWLISTED" }) as Error & { cause?: unknown };
    cyclic.cause = cyclic;
    const failure = await failureFor(cyclic);
    expect(failure.failureDiagnostic).toMatchObject({ category: "UNKNOWN", stage: "REQUEST_TRANSPORT", requestAttempted: true });
    expect(failure.failureDiagnostic).not.toHaveProperty("transportFailureClass");
    expect(JSON.stringify(failure.failureDiagnostic)).not.toContain("SECRET_");
  });

});
