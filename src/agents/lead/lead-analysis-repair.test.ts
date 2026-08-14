import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzePromptDeterministically, assembleRequirements, planClarificationsDeterministically } from "./deterministic";
import { LeadAgentService } from "./service";
import { LeadAgentAnalysisSchema, type LeadAgentAnalysis, type LeadAgentInput } from "./contracts";
import type { LeadAnalysisProvider } from "./ports";
import { FakeLeadMemoryPort } from "./memory";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { workbenchFailureResponse } from "@/runtime/workbench/diagnostics";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "@/runtime/workbench/application";
import { ClarificationRepository } from "@/persistence/database/repositories";

const prompt = "Create a synthetic customer website for a local service business.";

function input(operatorLanguage: "en" | "de" | "ru" = "en", siteLanguage: "de" | "en" = "de"): LeadAgentInput {
  return {
    projectId: randomUUID(),
    projectVersion: 1,
    originalPrompt: prompt,
    suppliedFiles: [],
    availableAssets: [],
    knownUserAnswers: {},
    currentWorkflowState: "DRAFT",
    idempotencyKey: randomUUID(),
    operatorLanguage,
    siteLanguage,
  };
}

function providerWith(
  analyze: (value: LeadAgentInput) => unknown,
  plan: (value: Parameters<LeadAnalysisProvider["proposeClarifications"]>[0]) => unknown = (value) => planClarificationsDeterministically(value),
): LeadAnalysisProvider {
  return {
    analyzePrompt: async (value) => analyze(value) as LeadAgentAnalysis,
    proposeClarifications: async (value) => plan(value) as ReturnType<typeof planClarificationsDeterministically>,
    assembleBriefDraft: async (value) => assembleRequirements(value),
  };
}

async function seeded(provider: LeadAnalysisProvider, request = input()) {
  const database = new InMemoryPersistenceDatabase();
  const service = new LeadAgentService({ database, memory: new FakeLeadMemoryPort(), provider });
  await service.startProjectIntake(request);
  return { database, service, request };
}

async function analysisFailure(mutator: (analysis: LeadAgentAnalysis) => unknown) {
  const request = input();
  const fixture = await seeded(providerWith((value) => mutator(analyzePromptDeterministically(value))), request);
  return fixture.service.analyzeProjectPrompt(request).catch((error: unknown) => error);
}

describe("Lead analysis contract repair LA1-LA40 / LAC1-LAC20 / LAR1-LAR12", () => {
  it("LA1-LA4 classifies every host binding mismatch without exposing values", async () => {
    const cases = [
      ["projectId", (analysis: LeadAgentAnalysis) => ({ ...analysis, projectId: randomUUID() }), "PROJECT_ID_MISMATCH"],
      ["projectVersion", (analysis: LeadAgentAnalysis) => ({ ...analysis, projectVersion: 2 }), "PROJECT_VERSION_MISMATCH"],
      ["originalPromptChecksum", (analysis: LeadAgentAnalysis) => ({ ...analysis, originalPromptChecksum: "0".repeat(64) }), "PROMPT_CHECKSUM_MISMATCH"],
      ["operatorLanguage", (analysis: LeadAgentAnalysis) => ({ ...analysis, operatorLanguage: "ru" }), "OPERATOR_LANGUAGE_MISMATCH"],
    ] as const;
    for (const [fieldPath, mutator, issueCode] of cases) {
      const error = await analysisFailure(mutator);
      expect(error).toMatchObject({ code: "LEAD_ANALYSIS_INVALID", details: { validationStage: "ANALYSIS_SEMANTIC", issueCode, fieldPath } });
      expect(JSON.stringify(error)).not.toContain("private");
    }
  });

  it("LA5-LA12 classifies strict analysis schema failures by bounded structural reason", async () => {
    const valid = analyzePromptDeterministically(input());
    const withoutProvider = { ...valid };
    delete (withoutProvider as { provider?: unknown }).provider;
    const cases = [
      [withoutProvider, "MISSING_REQUIRED_FIELD", "provider"],
      [{ ...valid, directlyStatedFacts: [{ key: "bad", category: "not-a-category", value: "x", classification: "explicit", evidence: [{ sourceType: "original-prompt", reference: "prompt", excerpt: "x" }], userConfirmed: true }] }, "INVALID_ENUM_OR_LITERAL", "directlyStatedFacts[0].category"],
      [{ ...valid, providerOutput: "must not cross the contract" }, "UNKNOWN_FIELD", "analysis"],
      [{ ...valid, unsupportedAssumptions: [42] }, "INVALID_TYPE", "unsupportedAssumptions[0]"],
    ] as const;
    for (const [value, issueCode, fieldPath] of cases) {
      const error = await analysisFailure(() => value);
      expect(error).toMatchObject({ code: "LEAD_ANALYSIS_INVALID", details: { validationStage: "ANALYSIS_SCHEMA", issueCode, fieldPath } });
    }
  });

  it("LA13-LA16 rejects malformed clarification mappings before persistence", async () => {
    const malformed = await seeded(providerWith((value) => analyzePromptDeterministically(value), (value) => {
      const plan = planClarificationsDeterministically(value);
      const first = plan.questions[0];
      return { ...plan, questions: first ? [{ ...first, requirementKey: "" }] : [] };
    }));
    const error = await malformed.service.planClarifications(malformed.request).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "LEAD_ANALYSIS_INVALID", details: { validationStage: "CLARIFICATION_MAPPING", issueCode: "INVALID_FIELD", fieldPath: "questions[0].requirementKey" } });
    expect(malformed.database.documents.size).toBe(0);
  });

  it("LA17-LA20 rejects duplicate provider IDs and an empty required refresh", async () => {
    const duplicate = await seeded(providerWith((value) => analyzePromptDeterministically(value), (value) => {
      const plan = planClarificationsDeterministically(value);
      return plan.questions.length > 1 ? { ...plan, questions: [plan.questions[0], { ...plan.questions[1], id: plan.questions[0].id }] } : plan;
    }));
    const duplicateError = await duplicate.service.planClarifications(duplicate.request).catch((value: unknown) => value);
    expect(duplicateError).toMatchObject({ code: "LEAD_ANALYSIS_INVALID", details: { validationStage: "CLARIFICATION_MAPPING", issueCode: "DUPLICATE_QUESTION_ID", fieldPath: "questions[1].id" } });

    let planCalls = 0;
    const emptyOnRefresh = await seeded(providerWith((value) => analyzePromptDeterministically(value), (value) => {
      planCalls += 1;
      const plan = planClarificationsDeterministically(value);
      return planCalls === 1 ? plan : { ...plan, questions: [] };
    }));
    await emptyOnRefresh.service.planClarifications(emptyOnRefresh.request);
    const emptyError = await emptyOnRefresh.service.refreshClarifications(emptyOnRefresh.request).catch((value: unknown) => value);
    expect(emptyError).toMatchObject({ code: "LEAD_ANALYSIS_INVALID", details: { validationStage: "CLARIFICATION_MAPPING", issueCode: "EMPTY_REQUIRED_CLARIFICATIONS", fieldPath: "questions" } });
  });

  it("LA9-LA11 allows an empty initial clarification plan when no canonical questions remain", async () => {
    const fixture = await seeded(providerWith((value) => analyzePromptDeterministically(value), (value) => ({ ...planClarificationsDeterministically(value), questions: [] })));
    const plan = await fixture.service.planClarifications(fixture.request);
    expect(plan.questions).toHaveLength(0);
  });

  it("LA21-LA28 keeps rejected analysis out of cache and separates operator-language cache entries", async () => {
    let attempts = 0;
    const request = input("en");
    const fixture = await seeded(providerWith((value) => {
      attempts += 1;
      const analysis = analyzePromptDeterministically(value);
      return attempts === 1 ? { ...analysis, originalPromptChecksum: "0".repeat(64) } : analysis;
    }), request);
    await expect(fixture.service.analyzeProjectPrompt(request)).rejects.toMatchObject({ code: "LEAD_ANALYSIS_INVALID" });
    await expect(fixture.service.analyzeProjectPrompt(request)).resolves.toMatchObject({ projectId: request.projectId });
    expect(attempts).toBe(2);

    let languageCalls = 0;
    const languageProvider = providerWith((value) => { languageCalls += 1; return analyzePromptDeterministically(value); });
    const languageFixture = await seeded(languageProvider, input("en"));
    await languageFixture.service.analyzeProjectPrompt(languageFixture.request);
    const russian = { ...languageFixture.request, operatorLanguage: "ru" as const, idempotencyKey: randomUUID() };
    await languageFixture.service.analyzeProjectPrompt(russian);
    await languageFixture.service.analyzeProjectPrompt(languageFixture.request);
    expect(languageCalls).toBe(2);
  });

  it("LAR1-LAR12 preserves the canonical operator language independently of site language", async () => {
    for (const operatorLanguage of ["en", "de", "ru"] as const) {
      const request = input(operatorLanguage, "de");
      const fixture = await seeded(providerWith((value) => analyzePromptDeterministically(value)), request);
      await fixture.service.planClarifications(request);
      const refreshed = await fixture.service.refreshClarifications(request);
      expect(refreshed.operatorLanguage).toBe(operatorLanguage);
      expect((await fixture.service.getClarificationStatus(request.projectId, 1)).session.operatorLanguage).toBe(operatorLanguage);
      expect(analyzePromptDeterministically(request).siteLanguage).toBe("de");
    }
  });

  it("LAR4/LAR8/LAR11 proves a persisted six-question Workbench refresh", async () => {
    const database = new InMemoryPersistenceDatabase();
    const provider = providerWith((value) => analyzePromptDeterministically(value), (value) => ({ ...planClarificationsDeterministically(value), questions: planClarificationsDeterministically(value).questions.slice(0, 6) }));
    const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory: new FakeLeadMemoryPort(), provider }) });
    const application = new WorkbenchApplication({ database, entry });
    const created = await application.handle({ action: "create", requestText: "Create a synthetic German customer website for a local service business.", languageHint: "de" });
    if (!created.project) throw new Error("synthetic project was not created");
    const repository = new ClarificationRepository(database);
    const before = await repository.getSession(created.project.projectId, 1);
    const refreshed = await application.handle({ action: "refresh-clarifications", projectId: created.project.projectId, requestId: randomUUID() });
    expect(before?.questions).toHaveLength(6);
    expect(refreshed.questions).toHaveLength(6);
    expect(refreshed.questions.map((question) => question.id)).not.toEqual(before?.questions.map((question) => question.id));
    expect(refreshed.project?.projectId).toBe(created.project.projectId);
    expect(refreshed.project?.workflowState).toBe("CLARIFYING");
    expect(refreshed.status.allowedActions).toEqual(["ANSWER_LEAD_CLARIFICATIONS"]);
    expect(refreshed.brief).toBeUndefined();
  });

  it("LAC1-LAC4 projects only safe validation metadata to Workbench responses and events", async () => {
    const error = await analysisFailure((analysis) => ({ ...analysis, originalPromptChecksum: "0".repeat(64) }));
    const result = workbenchFailureResponse(error, { action: "refresh-clarifications", projectId: randomUUID() });
    expect(result.response).toMatchObject({ code: "LEAD_ANALYSIS_INVALID", recoverable: true, validationStage: "ANALYSIS_SEMANTIC", issueCode: "PROMPT_CHECKSUM_MISMATCH", fieldPath: "originalPromptChecksum" });
    expect(JSON.stringify(result)).not.toMatch(/0{64}|private|prompt contents|provider output|stack|secret/i);
  });

  it("LAC5-LAC20 keeps the strict canonical analysis schema and cache semantic identity explicit", async () => {
    expect(() => LeadAgentAnalysisSchema.parse(analyzePromptDeterministically(input()))).not.toThrow();
    const source = await import("node:fs/promises").then(({ readFile }) => readFile("src/agents/lead/service.ts", "utf8"));
    expect(source).toContain("lead-analysis:analyze-project-prompt:v2");
    expect(source).toContain("operatorLanguage");
    expect(source).toContain("siteLanguage");
  });
});
