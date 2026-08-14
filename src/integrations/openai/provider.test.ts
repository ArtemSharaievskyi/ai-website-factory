import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { z } from "zod";
import { OpenAiStructuredClient, type StructuredRequest } from "./client";
import { AiProviderError } from "./errors";
import { FifoConcurrencyLimiter } from "./limiter";
import { zodResponseFormat } from "openai/helpers/zod";
import { BriefDraftStructuredOutputSchema, DesignDirectionStructuredOutputSchema, ImplementationChangeProposalStructuredOutputSchema, OpenAiImplementationProvider, OpenAiLeadProvider, PlanningPackageStructuredOutputSchema, isWorkflowApprovalBlocker } from "./adapters";
import { readAiProviderConfig } from "./config";
import { ArchitectureReviewProviderOutputSchema, CodeIntegrationReviewProviderOutputSchema, ContractAuditProviderOutputSchema, SecurityReviewProviderOutputSchema, TestQualityReviewProviderOutputSchema } from "@/domain/review/schema";
import { analyzePromptDeterministically } from "@/agents/lead/deterministic";
import { ClarificationPlanProviderOutputSchema, LeadAnalysisProviderOutputSchema } from "@/agents/lead/contracts";
import { checksumPersistedDocument } from "@/persistence/database/serialization";

const config = { apiKey: "test", model: "test-model", modelLabel: "GPT-5.6 Luna", maxRetries: 1, maxConcurrentRequests: 1 };
const schema = z.object({ ok: z.boolean(), summary: z.string() }).strict();
const request = { role: "test", promptVersion: "test.v1", system: "policy", user: "{}", schemaName: "test-output", schema, idempotencyKey: "same" };
const validExecutor = async <T>() => ({ value: { ok: true, summary: "bounded" } as T, requestId: "req_test" });

describe("production AI provider boundary", () => {
  it("constructs every reviewer strict transport schema with required nullable metadata", () => {
    const schemas = [
      ["architecture-review-result", ArchitectureReviewProviderOutputSchema, "REQUIREMENT_TRACEABILITY"],
      ["contract-audit-result", ContractAuditProviderOutputSchema, "REQUIREMENT_NOT_TRACED"],
      ["code-integration-review-result", CodeIntegrationReviewProviderOutputSchema, "CONTRACT_IMPLEMENTATION_MISMATCH"],
      ["security-review-result", SecurityReviewProviderOutputSchema, "TRUST_BOUNDARY"],
      ["test-quality-review-result", TestQualityReviewProviderOutputSchema, "REQUIREMENT_NOT_VERIFIED"],
    ] as const;
    for (const [name, schema, category] of schemas) {
      expect(() => zodResponseFormat(schema, name)).not.toThrow();
      const zeroFinding = { verdict: "APPROVED", findings: [], reviewedArtifactRefs: ["file:src/app.ts"], policyVersion: "review-v1", blockedReason: null };
      expect(schema.safeParse(zeroFinding).success).toBe(true);
      const oneFinding = { ...zeroFinding, verdict: "CHANGES_REQUIRED", findings: [{ findingId: "finding-1", severity: "INFO", category, summary: "Bounded finding.", evidenceRefs: ["file:src/app.ts"], affectedArtifacts: [], recommendedAction: "Review the cited evidence.", ...(category === "REQUIREMENT_NOT_TRACED" ? { correctionTarget: "PLANNING" } : {}), ...(category === "CONTRACT_IMPLEMENTATION_MISMATCH" ? { correctionTarget: "IMPLEMENTATION_TASK", ownerTaskId: null } : {}), ...(category === "TRUST_BOUNDARY" ? { correctionTarget: "IMPLEMENTATION_TASK", ownerTaskId: null } : {}), ...(category === "REQUIREMENT_NOT_VERIFIED" ? { correctionTarget: "TEST_TASK", ownerTaskId: null } : {}) }] };
      expect(schema.safeParse(oneFinding).success).toBe(true);
    }
  });
  it("rejects invalid reviewer severity, verdict, and evidence for every reviewer schema", () => {
    const schemas = [
      [ArchitectureReviewProviderOutputSchema, "REQUIREMENT_TRACEABILITY"],
      [ContractAuditProviderOutputSchema, "REQUIREMENT_NOT_TRACED"],
      [CodeIntegrationReviewProviderOutputSchema, "CONTRACT_IMPLEMENTATION_MISMATCH"],
      [SecurityReviewProviderOutputSchema, "TRUST_BOUNDARY"],
      [TestQualityReviewProviderOutputSchema, "REQUIREMENT_NOT_VERIFIED"],
    ] as const;
    for (const [schema, category] of schemas) {
      const finding = {
        findingId: "finding-1",
        severity: "INFO",
        category,
        summary: "Bounded finding.",
        evidenceRefs: ["file:src/app.ts"],
        affectedArtifacts: [],
        recommendedAction: "Review the cited evidence.",
        ...(category === "REQUIREMENT_NOT_TRACED" ? { correctionTarget: "PLANNING" } : {}),
        ...(category === "CONTRACT_IMPLEMENTATION_MISMATCH" ? { correctionTarget: "IMPLEMENTATION_TASK", ownerTaskId: null } : {}),
        ...(category === "TRUST_BOUNDARY" ? { correctionTarget: "IMPLEMENTATION_TASK", ownerTaskId: null } : {}),
        ...(category === "REQUIREMENT_NOT_VERIFIED" ? { correctionTarget: "TEST_TASK", ownerTaskId: null } : {}),
      };
      const valid = { verdict: "CHANGES_REQUIRED", findings: [finding], reviewedArtifactRefs: ["file:src/app.ts"], policyVersion: "review-v1", blockedReason: null };
      expect(schema.safeParse({ ...valid, findings: [{ ...finding, severity: "SEVERE" }] }).success).toBe(false);
      expect(schema.safeParse({ ...valid, verdict: "UNKNOWN" }).success).toBe(false);
      expect(schema.safeParse({ ...valid, findings: [{ ...finding, evidenceRefs: [] }] }).success).toBe(false);
    }
  });
  it("uses a strict Brief transport schema while preserving nullable optional domain values", () => {
    expect(() => zodResponseFormat(BriefDraftStructuredOutputSchema, "brief-draft")).not.toThrow();
  });
  it("uses a strict Lead transport schema with nullable provider observations", () => {
    expect(() => zodResponseFormat(LeadAnalysisProviderOutputSchema, "lead-analysis")).not.toThrow();
    const transport = { languageObservation: null, directlyStatedFacts: [], userPreferences: [], inferredRecommendations: [], unresolvedQuestions: [], contradictions: [], unsupportedAssumptions: [], confirmationRequired: [], provider: { name: "synthetic", model: null, used: true, inputTokens: null, outputTokens: null } };
    expect(LeadAnalysisProviderOutputSchema.safeParse(transport).success).toBe(true);
    expect(LeadAnalysisProviderOutputSchema.safeParse({ ...transport, languageObservation: undefined }).success).toBe(false);
  });
  it("does not treat approval as a Brief validation blocker", () => {
    expect(isWorkflowApprovalBlocker("Explicit Project Brief approval has not yet been recorded.")).toBe(true);
    expect(isWorkflowApprovalBlocker("The finalized Project Brief has not yet been explicitly approved before Planner runs.")).toBe(true);
    expect(isWorkflowApprovalBlocker("The finalized Brief is ready for the explicit approval stage.")).toBe(false);
    expect(isWorkflowApprovalBlocker("The Project Brief has not been explicitly approved.")).toBe(true);
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
  it("puts selected approved procedural guidance in the actual Lead provider request", async () => {
    let sent: { system: string; user: string; idempotencyKey?: string } | undefined;
    const client = new OpenAiStructuredClient(config, {
      executor: async <T>(request: StructuredRequest<T>) => {
        sent = request;
        return { value: { directlyStatedFacts: [], userPreferences: [], inferredRecommendations: [], unresolvedQuestions: [], contradictions: [], unsupportedAssumptions: [], confirmationRequired: [], provider: { name: "synthetic", model: null, used: false, inputTokens: null, outputTokens: null } } as T, requestId: "req_lead" };
      },
    });
    const selected = {
      skillId: "lead-requirements-completeness",
      approvedChecksum: "a".repeat(64),
      coverageKeys: ["requirements-completeness"],
      skillMarkdown: "SELECTED LEAD PROCEDURE",
      references: [],
    };
    await new OpenAiLeadProvider(client).analyzePrompt(
      { projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, originalPrompt: "Synthetic Lead request", suppliedFiles: [], availableAssets: [], knownUserAnswers: {}, currentWorkflowState: "DRAFT", idempotencyKey: "lead-test", operatorLanguage: "en", siteLanguage: "de" },
      [selected],
      "b".repeat(64),
    );
    expect(sent?.system).toContain("SELECTED LEAD PROCEDURE");
    expect(sent?.system).not.toContain("ambiguity-detector");
    expect(sent?.idempotencyKey).toContain("b".repeat(64));
  });
  it("binds host-owned Lead analysis identity after strict provider transport validation", async () => {
    const transport = { directlyStatedFacts: [], userPreferences: [], inferredRecommendations: [], unresolvedQuestions: [], contradictions: [], unsupportedAssumptions: [], confirmationRequired: [], provider: { name: "synthetic", model: null, used: true, inputTokens: null, outputTokens: null } };
    expect(LeadAnalysisProviderOutputSchema.safeParse({ ...transport, projectId: "11111111-1111-4111-8111-111111111111" }).success).toBe(false);
    expect(LeadAnalysisProviderOutputSchema.safeParse({ ...transport, unknownProviderField: "ignored" }).success).toBe(false);
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: transport as T, requestId: "req_host_bound_analysis" }) });
    const input = { projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, originalPrompt: "  Synthetic\r\nLead request  ", suppliedFiles: [], availableAssets: [], knownUserAnswers: {}, currentWorkflowState: "DRAFT" as const, idempotencyKey: "lead-host-bound", operatorLanguage: "de" as const, siteLanguage: "ru" as const };
    const result = await new OpenAiLeadProvider(client).analyzePrompt(input);
    expect(result.projectId).toBe(input.projectId);
    expect(result.projectVersion).toBe(input.projectVersion);
    expect(result.operatorLanguage).toBe("de");
    expect(result.siteLanguage).toBe("ru");
    expect(result.originalPromptChecksum).toBe(checksumPersistedDocument("Synthetic\nLead request"));
  });
  it("binds host-owned clarification plan identity and rejects host fields in transport", async () => {
    const analysisInput = { projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 3, originalPrompt: "Purpose: synthetic", suppliedFiles: [], availableAssets: [], knownUserAnswers: {}, currentWorkflowState: "DRAFT" as const, idempotencyKey: "plan-host-bound", operatorLanguage: "en" as const, siteLanguage: "de" as const };
    const analysis = analyzePromptDeterministically(analysisInput);
    const transport = { questions: [{ id: "33333333-3333-4333-8333-333333333333", requirementKey: "purpose", category: "business", question: "What is the purpose?", reason: "The brief needs it.", blocking: true, required: true, fingerprint: "v1:business:purpose" }], generatedAt: "2026-08-14T00:00:00.000Z" };
    expect(ClarificationPlanProviderOutputSchema.safeParse({ ...transport, projectId: analysis.projectId }).success).toBe(false);
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: transport as T, requestId: "req_host_bound_plan" }) });
    const result = await new OpenAiLeadProvider(client).proposeClarifications({ analysis, operatorLanguage: "ru", siteLanguage: "de", availableAssets: [] });
    expect(result.projectId).toBe(analysis.projectId);
    expect(result.projectVersion).toBe(analysis.projectVersion);
    expect(result.operatorLanguage).toBe("ru");
  });
  it("passes the configured model unchanged through the official structured API", async () => {
    let sent: Record<string, unknown> | undefined;
    const client = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async (value: Record<string, unknown>) => { sent = value; return { id: "req_model", choices: [{ message: { parsed: { ok: true, summary: "bounded" } }, finish_reason: "stop" }], usage: {} }; } } } } as never });
    await expect(client.request(request)).resolves.toMatchObject({ value: { ok: true, summary: "bounded" } });
    expect(sent).toMatchObject({ model: "test-model", response_format: expect.anything() });
    expect(sent).not.toHaveProperty("temperature");
  });

  it("classifies local strict-schema construction separately from API failures", async () => {
    const events: Array<Record<string, unknown>> = [];
    const client = new OpenAiStructuredClient(config, { eventSink: (event) => events.push(event), client: { chat: { completions: { parse: vi.fn() } } } as never });
    const invalidSchema = z.object({ optional: z.string().optional() }).strict();
    await expect(client.request({ ...request, schema: invalidSchema, schemaName: "invalid-optional-schema" })).rejects.toMatchObject({ code: "AI_REQUEST_SCHEMA_INVALID", diagnostic: { stage: "request_construction", requestAttempted: false, apiResponseReceived: false, schemaName: "invalid-optional-schema" } });
    expect(events.at(-1)).toMatchObject({ type: "request.failed", code: "AI_REQUEST_SCHEMA_INVALID", diagnostic: { requestAttempted: false } });
  });

  it("keeps safe API authentication metadata without raw error contents", async () => {
    const events: Array<Record<string, unknown>> = [];
    const client = new OpenAiStructuredClient(config, { eventSink: (event) => events.push(event), executor: async () => { throw Object.assign(new Error("secret-api-key-value"), { status: 401, requestID: "req_auth", error: { type: "authentication_error", code: "invalid_api_key", param: null } }); } });
    await expect(client.request({ ...request, idempotencyKey: "auth-diagnostic" })).rejects.toMatchObject({ code: "AI_AUTHENTICATION_FAILED", diagnostic: { stage: "api_request", requestAttempted: true, apiResponseReceived: true, httpStatus: 401, requestId: "req_auth", openaiErrorType: "authentication_error", openaiErrorCode: "invalid_api_key" } });
    expect(JSON.stringify(events)).not.toContain("secret-api-key-value");
  });

  it("distinguishes model access rejection, no parsed output, refusal, truncation, and domain invalidity", async () => {
    const modelClient = new OpenAiStructuredClient(config, { executor: async () => { throw Object.assign(new Error("model"), { status: 404, requestID: "req_model_access", error: { type: "invalid_request_error", code: "model_not_found", param: "model" } }); } });
    await expect(modelClient.request({ ...request, idempotencyKey: "model-access-diagnostic" })).rejects.toMatchObject({ code: "AI_MODEL_ACCESS_FAILED", diagnostic: { httpStatus: 404, openaiErrorCode: "model_not_found", openaiErrorParam: "model" } });
    const noParsed = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async () => ({ id: "req_no_parsed", choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} }) } } } as never });
    await expect(noParsed.request({ ...request, idempotencyKey: "no-parsed-diagnostic" })).rejects.toMatchObject({ code: "AI_OUTPUT_NO_PARSED_OUTPUT", diagnostic: { apiResponseReceived: true, choicesCount: 1, finishReason: "stop", refusalPresent: false, parsedPresent: false, contentPresent: true } });
    const refused = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async () => ({ id: "req_refusal", choices: [{ message: { refusal: "refused" }, finish_reason: "stop" }], usage: {} }) } } } as never });
    await expect(refused.request({ ...request, idempotencyKey: "refusal-diagnostic" })).rejects.toMatchObject({ code: "AI_OUTPUT_REFUSED", diagnostic: { refusalPresent: true } });
    const truncated = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async () => ({ id: "req_truncated", choices: [{ message: { content: "{}" }, finish_reason: "length" }], usage: {} }) } } } as never });
    await expect(truncated.request({ ...request, idempotencyKey: "truncated-diagnostic" })).rejects.toMatchObject({ code: "AI_OUTPUT_TRUNCATED", diagnostic: { finishReason: "length" } });
    const invalidDomain = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async () => ({ id: "req_domain", choices: [{ message: { parsed: { ok: "invalid" } }, finish_reason: "stop" }], usage: {} }) } } } as never });
    await expect(invalidDomain.request({ ...request, idempotencyKey: "domain-diagnostic" })).rejects.toMatchObject({ code: "AI_OUTPUT_DOMAIN_INVALID", diagnostic: { stage: "domain_validation", domainValidationIssuePaths: expect.arrayContaining(["ok"]) } });
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
  it("rejects an empty provider model instead of constructing an unusable client", () => { expect(() => readAiProviderConfig({ OPENAI_API_KEY: "test-key" })).toThrowError(AiProviderError); });
  it("maps refusal and cancellation to stable errors", async () => { const refused = new OpenAiStructuredClient(config, { executor: async () => { throw new AiProviderError("AI_OUTPUT_REFUSED", "refused"); } }); await expect(refused.request({ ...request, idempotencyKey: "refused" })).rejects.toMatchObject({ code: "AI_OUTPUT_REFUSED" }); const controller = new AbortController(); controller.abort(); const client = new OpenAiStructuredClient(config, { executor: validExecutor }); await expect(client.request({ ...request, signal: controller.signal, idempotencyKey: "cancel" })).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED" }); });
  it("keeps queued work FIFO and bounds overflow", async () => { const limiter = new FifoConcurrencyLimiter(1, 0); const release = vi.fn(); const first = limiter.run(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); release(); return 1; }); await expect(limiter.run(async () => 2)).rejects.toMatchObject({ code: "AI_CONCURRENCY_LIMIT_REACHED" }); await expect(first).resolves.toBe(1); expect(release).toHaveBeenCalled(); });
  it("removes cancelled queued work without blocking the next waiter", async () => { const limiter = new FifoConcurrencyLimiter(1, 2); let releaseFirst!: () => void; const first = limiter.run(() => new Promise<number>((resolve) => { releaseFirst = () => resolve(1); })); await new Promise((resolve) => setTimeout(resolve, 0)); const controller = new AbortController(); const cancelled = limiter.run(async () => 2, controller.signal); const cancelledExpectation = expect(cancelled).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED" }); const third = limiter.run(async () => 3); controller.abort(); releaseFirst(); await expect(first).resolves.toBe(1); await cancelledExpectation; await expect(third).resolves.toBe(3); });
});
