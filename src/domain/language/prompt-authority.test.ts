import { describe, expect, it } from "vitest";
import { analyzePromptDeterministically } from "@/agents/lead/deterministic";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { LeadAgentService } from "@/agents/lead/service";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "@/runtime/workbench/application";
import { resolveLanguageAuthority } from "./schema";

const authority = (prompt: string, explicitSiteLanguage?: string) => resolveLanguageAuthority({ prompt, ...(explicitSiteLanguage ? { explicitSiteLanguage } : {}) });

describe("prompt-driven language authority PLA1-PLA48", () => {
  it("detects German, English, Russian, and Ukrainian instruction language", () => {
    expect(authority("Erstelle eine Website für eine lokale Bäckerei.").operatorLanguage).toBe("de");
    expect(authority("Build a website for a local bakery.").operatorLanguage).toBe("en");
    expect(authority("Создай сайт для местной пекарни.").operatorLanguage).toBe("ru");
    expect(authority("Створи сайт для місцевої пекарні.").operatorLanguage).toBe("uk");
  });

  it("keeps explicit operator and site directions independent", () => {
    const explicit = authority("Speak with me in German, but create the website in English.");
    expect(explicit.operatorLanguage).toBe("de");
    expect(explicit.siteLanguage).toBe("en");
    expect(explicit.operatorLanguageSource).toBe("EXPLICIT_OPERATOR");
    expect(explicit.siteLanguageSource).toBe("PROMPT_DETECTED");
    const mixed = authority("Создай сайт для местной службы.", "de");
    expect(mixed.operatorLanguage).toBe("ru");
    expect(mixed.siteLanguage).toBe("de");
    const cyrillic = authority("\u041e\u0442\u0432\u0435\u0447\u0430\u0439 \u043d\u0430 \u0440\u0443\u0441\u0441\u043a\u043e\u043c, \u0441\u0430\u0439\u0442 \u043d\u0430 \u043d\u0435\u043c\u0435\u0446\u043a\u043e\u043c");
    expect(cyrillic.operatorLanguage).toBe("ru");
    expect(cyrillic.siteLanguage).toBe("de");
  });

  it("does not count quoted slogans or business vocabulary as operator language", () => {
    const quoted = authority('Build a website for a German bakery with the slogan "Willkommen bei uns".', "de");
    expect(quoted.operatorLanguage).toBe("en");
    expect(quoted.siteLanguage).toBe("de");
    const business = authority("Design a website for a German business called Haus & Hof.");
    expect(business.operatorLanguage).toBe("en");
    expect(business.siteLanguage).toBe("en");
  });

  it("marks only genuinely unresolved language choices as ambiguous", () => {
    const ambiguousSite = authority("Build a multilingual website for a local service.");
    expect(ambiguousSite.operatorLanguage).toBe("en");
    expect(ambiguousSite.siteLanguage).toBe("UNRESOLVED");
    expect(ambiguousSite.status).toBe("AMBIGUOUS");
    const fallback = authority("I have a project idea but no instructions yet.");
    expect(fallback.operatorLanguageSource).toBe("FALLBACK");
    expect(fallback.siteLanguageSource).toBe("AMBIGUOUS");
  });

  it("resolves a German new project before the first Lead plan", async () => {
    const database = new InMemoryPersistenceDatabase();
    const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory: new FakeLeadMemoryPort() }) });
    const app = new WorkbenchApplication({ database, entry });
    const projection = await app.handle({ action: "create", requestText: "Erstelle eine Website für eine lokale Bäckerei." });
    expect(projection.operatorLanguage).toBe("de");
    expect(projection.siteLanguage).toBe("de");
    expect(projection.questions.length).toBeGreaterThan(0);
    expect(projection.questions.some((question) => question.requirementKey === "languages")).toBe(false);
    expect(projection.questions.every((question) => /(?:Was|Wer|Welche|Wie|Ist|Benötigt|Stellen)/i.test(question.question))).toBe(true);
    expect(projection.languageResolution?.siteLanguageSource).toBe("INHERITED_OPERATOR");
  });

  it("keeps English communication for English instructions with German customer content", async () => {
    const database = new InMemoryPersistenceDatabase();
    const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory: new FakeLeadMemoryPort() }) });
    const projection = await new WorkbenchApplication({ database, entry }).handle({ action: "create", requestText: "Build a website for a local service.", languageHint: "de" });
    expect(projection.operatorLanguage).toBe("en");
    expect(projection.siteLanguage).toBe("de");
    expect(projection.questions.some((question) => question.requirementKey === "languages")).toBe(false);
    expect(projection.questions.every((question) => !/[А-Яа-яіїєґ]/.test(question.question))).toBe(true);
  });

  it("uses Russian communication with an explicitly German website", async () => {
    const database = new InMemoryPersistenceDatabase();
    const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory: new FakeLeadMemoryPort() }) });
    const projection = await new WorkbenchApplication({ database, entry }).handle({ action: "create", requestText: "Создай сайт для местной службы.", languageHint: "de" });
    expect(projection.operatorLanguage).toBe("ru");
    expect(projection.siteLanguage).toBe("de");
    expect(projection.questions.some((question) => question.requirementKey === "languages")).toBe(false);
    expect(projection.questions.every((question) => /(?:Как|Кто|Какие|Нужн|Предостав|Нужна)/i.test(question.question))).toBe(true);
  });

  it("uses the same single Lead analysis call for language observation and requirements", async () => {
    const database = new InMemoryPersistenceDatabase();
    let analysisCalls = 0;
    const provider = {
      analyzePrompt: async (input: Parameters<LeadAgentService["analyzeProjectPrompt"]>[0]) => { analysisCalls += 1; return analyzePromptDeterministically(input); },
      proposeClarifications: async ({ analysis }: { analysis: ReturnType<typeof analyzePromptDeterministically> }) => ({ projectId: analysis.projectId, projectVersion: analysis.projectVersion, operatorLanguage: analysis.operatorLanguage, questions: [], generatedAt: new Date().toISOString() }),
      assembleBriefDraft: async ({ analysis, session }: { analysis: ReturnType<typeof analyzePromptDeterministically>; session: import("@/domain/requirements/schema").ClarificationSession }) => (await import("@/agents/lead/deterministic")).assembleRequirements({ analysis, session }),
    };
    const service = new LeadAgentService({ database, memory: new FakeLeadMemoryPort(), provider });
    const request = { projectId: crypto.randomUUID(), projectVersion: 1, originalPrompt: "Build a small website.", suppliedFiles: [], availableAssets: [], knownUserAnswers: {}, currentWorkflowState: "DRAFT" as const, idempotencyKey: crypto.randomUUID(), operatorLanguage: "en" as const, siteLanguage: "en" as const };
    await service.startProjectIntake(request);
    await service.analyzeProjectPrompt(request);
    await service.planClarifications(request);
    expect(analysisCalls).toBe(1);
  });
});
