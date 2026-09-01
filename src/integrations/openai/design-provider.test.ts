import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPlanningPackage } from "@/agents/planner/deterministic";
import type { PlannerAgentInput } from "@/agents/planner/contracts";
import { DesignAgentInputSchema, type DesignAgentInput } from "@/agents/design/contracts";
import { buildDesignDirectionSet } from "@/agents/design/deterministic";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { DesignDirectionStructuredOutputSchema, OpenAiDesignProvider } from "./adapters";
import { OpenAiStructuredClient } from "./client";
import type { AiProviderError } from "./errors";

const config = { apiKey: "synthetic", model: "synthetic-design-model", modelLabel: "Synthetic", maxRetries: 0, maxConcurrentRequests: 1 };

function brief(): RequirementSpecification {
  return RequirementSpecificationSchema.parse({
    schemaVersion: 1, documentType: "requirements", projectId: randomUUID(), projectVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    projectSummary: "Synthetic design provider fixture", protectedFunctionalityRequired: false, imagesRequired: false,
    businessGoals: ["Explain the approved service"], targetAudiences: ["Visitors"], pages: [{ slug: "home", purpose: "Introduce the service" }],
    userRoles: [], features: ["Contact form"], forms: ["Contact form"], contentRequirements: [], backendRequirements: [], supabaseRequirements: [],
    authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed",
    seoRequirements: [], localization: { locales: ["de"], defaultLocale: "de" }, imageSourceDecision: "placeholders",
    suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" }, technicalConstraints: [], explicitExclusions: [],
    userAcceptanceCriteria: ["The service is understandable"], unresolvedItems: [], approval: { approved: true, approvedAt: "2026-01-01T00:00:00.000Z", approvedBy: "user", approvedRequirementsChecksum: "a".repeat(64) },
    contactFacts: [], legalFacts: [], brandFacts: [], logoMetadata: [], imageSourcingNotes: [], evidence: [], recommendations: [], briefStatus: "approved", briefVersion: 1,
  });
}

function inputFor(value: RequirementSpecification, idempotencyKey = "design-provider-fixture"): DesignAgentInput {
  const plannerInput: PlannerAgentInput = { projectId: value.projectId, projectVersion: 1, approvedBrief: value, approvedBriefChecksum: checksumPersistedDocument(value), originalPromptReference: "original-prompt.md", clarificationEvidenceReferences: ["clarification-log.json"], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: "planner-fixture", expectedRowVersion: 1 };
  const planning = buildPlanningPackage(plannerInput);
  const accepted = { ...planning, accepted: true, acceptance: { acceptedAt: "2026-01-01T00:00:00.000Z", acceptedBy: "user", checksum: checksumPersistedDocument(planning) }, architecture: { ...planning.architecture, acceptance: { accepted: true, acceptedAt: "2026-01-01T00:00:00.000Z", acceptedBy: "user" } } };
  return DesignAgentInputSchema.parse({ projectId: value.projectId, projectVersion: 1, approvedBrief: value, approvedBriefChecksum: checksumPersistedDocument(value), acceptedPlanningPackage: accepted, acceptedPlanningChecksum: checksumPersistedDocument(accepted), contentPlan: accepted.content, assetManifest: accepted.assets, suppliedBrandMetadata: {}, suppliedLogoMetadata: value.suppliedLogoLocation, imageSourceDecision: value.imageSourceDecision, designPreferences: [], explicitDesignExclusions: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: [], allowedSkills: [], idempotencyKey, expectedRowVersion: 1 });
}

function wireFixture(input: DesignAgentInput) {
  const set = buildDesignDirectionSet(input, { generatedAt: "2026-01-01T00:00:00.000Z" });
  return { directions: set.directions.map((direction) => { const semantic = { ...direction } as Record<string, unknown>; delete semantic.id; delete semantic.professionalDesign; return { ...semantic, imageSourceDecision: "placeholders" as const, genericTemplateRisk: "low" as const }; }) };
}

function clientFor(response: { content: string; id?: string; usage?: Record<string, unknown> }, capture?: (request: Record<string, unknown>) => void) {
  const client = { chat: { completions: { create: async (request: Record<string, unknown>) => { capture?.(request); return { id: response.id ?? "req_design_fixture", choices: [{ message: { content: response.content }, finish_reason: "stop" }], usage: response.usage ?? {} }; } } } } as never;
  return new OpenAiStructuredClient(config, { client });
}

describe("OpenAI Design provider boundary", () => {
  it("uses the production strict create/manual transport and host-binds Design identity", async () => {
    const input = inputFor(brief());
    const wire = wireFixture(input);
    let sent: Record<string, unknown> | undefined;
    const result = await new OpenAiDesignProvider(clientFor({ content: JSON.stringify(wire), usage: { prompt_tokens: 31, completion_tokens: 17, total_tokens: 48 } }, (request) => { sent = request; })).proposeDesignDirections(input);
    expect(result.directions).toHaveLength(3);
    expect(new Set(result.directions.map((direction) => direction.id)).size).toBe(3);
    expect(result.provider).toMatchObject({ name: "openai", used: true, model: "synthetic-design-model", requestId: "req_design_fixture", responseReceived: true, finishReason: "stop", inputTokens: 31, outputTokens: 17, totalTokens: 48, rawContentBytes: expect.any(Number), rawContentChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(sent).toMatchObject({ model: "synthetic-design-model", response_format: { type: "json_schema", json_schema: { name: "design-direction-set", strict: true } } });
    expect(sent).not.toHaveProperty("temperature");
    expect(JSON.stringify(sent)).not.toContain("$parseRaw");
    expect((sent?.response_format as { json_schema: { schema: { properties: Record<string, unknown> } } }).json_schema.schema.properties).toEqual({ directions: expect.anything() });
    expect(DesignDirectionStructuredOutputSchema.safeParse({ ...wire, projectId: input.projectId }).success).toBe(false);
    expect(DesignDirectionStructuredOutputSchema.safeParse({ directions: wire.directions.map((direction) => ({ ...direction, id: randomUUID() })) }).success).toBe(false);
  });

  it("keeps the exact-three and host-field boundary strict", () => {
    const input = inputFor(brief());
    const wire = wireFixture(input);
    expect(DesignDirectionStructuredOutputSchema.safeParse({ directions: wire.directions.slice(0, 2) }).success).toBe(false);
    expect(DesignDirectionStructuredOutputSchema.safeParse({ directions: [...wire.directions, wire.directions[0]] }).success).toBe(false);
    expect(DesignDirectionStructuredOutputSchema.safeParse({ ...wire, directions: wire.directions.map((direction) => ({ ...direction, id: randomUUID() })) }).success).toBe(false);
    expect(DesignDirectionStructuredOutputSchema.safeParse({ ...wire, unexpected: true }).success).toBe(false);
  });

  it("preserves typed provider diagnostics and usage through local wire failure", async () => {
    const input = inputFor(brief());
    const wire = wireFixture(input);
    const invalid = { directions: wire.directions.map((direction) => ({ ...direction, concept: { leaked: true } as unknown as never })) };
    const usage: unknown[] = [];
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({ id: "req_design_wire_failure", choices: [{ message: { content: JSON.stringify(invalid) }, finish_reason: "stop" }], usage: { prompt_tokens: 23, completion_tokens: 11, total_tokens: 34 } }),
        },
      },
    } as never;
    const client = new OpenAiStructuredClient(config, { usageSink: (value) => { usage.push(value); }, client: fakeClient });
    let failure: AiProviderError | undefined;
    try { await new OpenAiDesignProvider(client).proposeDesignDirections(input); } catch (error) { failure = error as AiProviderError; }
    expect(failure?.code).toBe("AI_OUTPUT_DOMAIN_INVALID");
    expect(failure?.diagnostic).toMatchObject({ requestId: "req_design_wire_failure", responseReceived: true, inputTokens: 23, outputTokens: 11, totalTokens: 34, jsonParseSucceeded: true, rawContentBytes: expect.any(Number), rawContentChecksum: expect.stringMatching(/^[a-f0-9]{64}$/), zodIssueCount: expect.any(Number) });
    expect(failure?.failureDiagnostic).toMatchObject({ provider: "openai", requestId: "req_design_wire_failure", inputTokens: 23, outputTokens: 11, totalTokens: 34, rawContentChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(usage[0]).toMatchObject({ inputTokens: 23, outputTokens: 11, totalTokens: 34, actualUsageCaptured: true });
    expect(JSON.stringify(failure)).not.toContain("leaked");
  });

  it("maps invalid JSON and provider errors without retaining raw output", async () => {
    const input = inputFor(brief());
    let invalidJson: AiProviderError | undefined;
    try { await new OpenAiDesignProvider(clientFor({ content: "{invalid", id: "req_design_json" })).proposeDesignDirections(input); } catch (error) { invalidJson = error as AiProviderError; }
    expect(invalidJson?.code).toBe("AI_STRUCTURED_PARSE_FAILED");
    expect(invalidJson?.diagnostic).toMatchObject({ requestId: "req_design_json", jsonParseSucceeded: false, rawContentChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const failingClient = {
      chat: {
        completions: {
          create: async () => { throw Object.assign(new Error("SECRET_PROVIDER_ERROR"), { status: 503, requestID: "req_design_api" }); },
        },
      },
    } as never;
    const provider = new OpenAiStructuredClient(config, { client: failingClient });
    await expect(new OpenAiDesignProvider(provider).proposeDesignDirections(input)).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", failureDiagnostic: { requestId: "req_design_api", httpStatus: 503 } });
  });
});
