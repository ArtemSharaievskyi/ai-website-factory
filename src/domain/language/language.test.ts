import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzePromptDeterministically, planClarificationsDeterministically } from "@/agents/lead/deterministic";
import { LeadAgentService } from "@/agents/lead/service";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { normalizeSiteLanguage, inferSiteLanguageFromPrompt, FACTORY_OPERATOR_LANGUAGE } from "./schema";

const input = (prompt: string, siteLanguage: "UNRESOLVED" | "en" | "de" = "UNRESOLVED") => ({ projectId: randomUUID(), projectVersion: 1, originalPrompt: prompt, suppliedFiles: [], availableAssets: [], knownUserAnswers: {}, currentWorkflowState: "DRAFT" as const, idempotencyKey: randomUUID(), operatorLanguage: "en" as const, siteLanguage });

describe("explicit Factory/operator and customer-site language LANG1-LANG24", () => {
  it("LANG1-LANG4 keep operator language explicit and English by default", () => {
    expect(FACTORY_OPERATOR_LANGUAGE).toBe("en");
    expect(normalizeSiteLanguage(undefined)).toBe("UNRESOLVED");
    expect(normalizeSiteLanguage("")).toBe("UNRESOLVED");
    expect(analyzePromptDeterministically(input("Build a small public website")).operatorLanguage).toBe("en");
  });

  it("LANG5-LANG8 normalize explicit site-language choices", () => {
    expect(normalizeSiteLanguage("German")).toBe("de");
    expect(normalizeSiteLanguage("Deutsch")).toBe("de");
    expect(inferSiteLanguageFromPrompt("Create the customer website in German.")).toBe("de");
    expect(inferSiteLanguageFromPrompt("Languages: de")).toBe("de");
  });

  it("LANG9-LANG12 asks the exact English question only when site language is unresolved", () => {
    const missing = planClarificationsDeterministically({ analysis: analyzePromptDeterministically(input("Purpose: A")) });
    expect(missing.questions.find((question) => question.requirementKey === "languages")?.question).toBe("What language should the website be created in?");
    const explicit = planClarificationsDeterministically({ analysis: analyzePromptDeterministically(input("Languages: de")) });
    expect(explicit.questions.some((question) => question.requirementKey === "languages")).toBe(false);
    expect(explicit.operatorLanguage).toBe("en");
    expect(explicit.questions.every((question) => !/\b(?:Bitte|Welche|bestätigen)\b/i.test(question.question))).toBe(true);
  });

  it("LANG13-LANG16 keeps German site context out of Factory questions", () => {
    const analysis = analyzePromptDeterministically(input("Create a German customer website", "de"));
    const plan = planClarificationsDeterministically({ analysis });
    expect(analysis.siteLanguage).toBe("de");
    expect(analysis.operatorLanguage).toBe("en");
    expect(plan.operatorLanguage).toBe("en");
    expect(plan.questions.every((question) => !/[äöüß]|\b(?:Bitte|Welche|Geschäft)\b/i.test(question.question))).toBe(true);
  });

  it("LANG17-LANG20 preserves the same project and refreshes with new question IDs", async () => {
    const database = new InMemoryPersistenceDatabase();
    const service = new LeadAgentService({ database, memory: new FakeLeadMemoryPort() });
    const request = input("Create a German customer website");
    await service.startProjectIntake(request);
    await service.analyzeProjectPrompt(request);
    const first = await service.planClarifications(request);
    const refreshed = await service.refreshClarifications(request);
    expect(refreshed.projectId).toBe(request.projectId);
    expect(refreshed.projectVersion).toBe(1);
    expect(refreshed.clarificationVersion).toBe(2);
    expect(refreshed.questions.map((question) => question.id)).not.toEqual(first.questions.map((question) => question.id));
    expect(refreshed.operatorLanguage).toBe("en");
  });

  it("LANG21-LANG24 persists an answered German site-language decision without switching operator language", async () => {
    const database = new InMemoryPersistenceDatabase();
    const service = new LeadAgentService({ database, memory: new FakeLeadMemoryPort() });
    const request = input("Purpose: A");
    await service.startProjectIntake(request);
    await service.analyzeProjectPrompt(request);
    const plan = await service.planClarifications(request);
    const languageQuestion = plan.questions.find((question) => question.requirementKey === "languages");
    expect(languageQuestion).toBeTruthy();
    await service.recordClarificationAnswer({ projectId: request.projectId, projectVersion: 1, questionId: languageQuestion!.id, status: "answered", answer: "German", answeredBy: "user", idempotencyKey: randomUUID() });
    const status = await service.getClarificationStatus(request.projectId, 1);
    expect(status.session.operatorLanguage).toBe("en");
    expect((await new (await import("@/persistence/database/repositories")).ProjectRepository(database).get(request.projectId))?.siteLanguage).toBe("de");
  });
});
