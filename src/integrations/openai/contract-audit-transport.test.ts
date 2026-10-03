import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import { ContractAuditProviderOutputSchema } from "@/domain/review/schema";
import { OpenAiStructuredClient } from "./client";
import type { AiProviderConfig } from "./config";

const config: AiProviderConfig = {
  apiKey: "synthetic-contract-audit-key",
  model: "synthetic-contract-audit-model",
  modelLabel: "Synthetic Contract Audit",
  maxRetries: 0,
  maxConcurrentRequests: 1,
};

const evidenceRef = `E${"a".repeat(16)}-001`;
const validPayload = { verdict: "APPROVED", findings: [], reviewedArtifactRefs: [evidenceRef], blockedReason: null };

const validWireResponse = {
  id: "chatcmpl_contract_audit_fixture",
  object: "chat.completion",
  created: 1,
  model: config.model,
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(validPayload) } }],
  usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 },
};

function sdkClient(response: Record<string, unknown>) {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify(response), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  return new OpenAiStructuredClient(config, { client: new OpenAI({ apiKey: config.apiKey, maxRetries: 0, fetch: fetchImpl }) });
}

const request = {
  role: "contract-auditor",
  promptVersion: "contract-auditor.v4",
  system: "Synthetic contract-audit system instruction.",
  user: "Synthetic contract-audit user input.",
  schemaName: "contract-audit-result",
  schema: ContractAuditProviderOutputSchema,
  parseStrategy: "sdk" as const,
};

describe("Contract Audit installed SDK transport contract", () => {
  it("accepts the valid provider wire response through the installed SDK parser", async () => {
    const result = await sdkClient(validWireResponse).request(request);
    expect(result.value).toEqual({ verdict: "APPROVED", findings: [], reviewedArtifactRefs: [evidenceRef], blockedReason: null });
    expect(result.requestId).toBe("chatcmpl_contract_audit_fixture");
    expect(result.usage).toMatchObject({ inputTokens: 17, outputTokens: 9, totalTokens: 26, actualUsageCaptured: true });
  });

  it("rejects the host-owned policyVersion field before a parsed result is accepted", async () => {
    const response = { ...validWireResponse, choices: [{ ...(validWireResponse.choices as Array<Record<string, unknown>>)[0], message: { role: "assistant", content: JSON.stringify({ ...validPayload, policyVersion: "contract-audit-v1" }) } }] };
    await expect(sdkClient(response).request(request)).rejects.toMatchObject({
      code: "AI_STRUCTURED_PARSE_FAILED",
      diagnostic: { responseReceived: false, sdkErrorClass: "ZodError" },
    });
  });

  it("preserves required nullable route-mismatch metadata through the installed SDK parser", async () => {
    const finding = { findingId: "semantic-route", severity: "ERROR", category: "ROUTE_CONTRACT_MISMATCH", summary: "Synthetic route semantics finding.", evidenceRefs: [evidenceRef], affectedArtifacts: [evidenceRef], recommendedAction: "Review the route purpose.", correctionTarget: "PLANNING", routeMismatchAspect: "PAGE_PURPOSE" };
    const payload = { verdict: "CHANGES_REQUIRED", findings: [finding], reviewedArtifactRefs: [evidenceRef], blockedReason: null };
    const response = { ...validWireResponse, choices: [{ ...(validWireResponse.choices as Array<Record<string, unknown>>)[0], message: { role: "assistant", content: JSON.stringify(payload) } }] };
    const result = await sdkClient(response).request(request);
    expect(result.value).toEqual(payload);
  });
});
