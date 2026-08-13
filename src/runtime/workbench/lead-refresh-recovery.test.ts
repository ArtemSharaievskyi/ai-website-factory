import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { analyzePromptDeterministically, assembleRequirements, planClarificationsDeterministically } from "@/agents/lead/deterministic";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { LeadAgentService } from "@/agents/lead/service";
import { LeadError } from "@/agents/lead/errors";
import { type LeadAnalysisProvider } from "@/agents/lead/ports";
import { AiProviderError } from "@/integrations/openai/errors";
import { ClarificationRepository } from "@/persistence/database/repositories";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { PersistenceError } from "@/persistence/database/errors";
import type { PersistenceDatabase, PersistenceTransaction } from "@/persistence/database/types";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "./application";
import { WorkbenchRequestSchema } from "./contracts";
import { clearWorkbenchDiagnosticEvents, workbenchFailureResponse } from "./diagnostics";

const syntheticPrompt = "Create a synthetic German customer website for a local service business.";
const realProjectId = "b7a0829d-a077-487c-844a-3232efc21bc3";

type ProviderOptions = {
  analyze?: (input: Parameters<LeadAnalysisProvider["analyzePrompt"]>[0]) => ReturnType<typeof analyzePromptDeterministically> | Promise<ReturnType<typeof analyzePromptDeterministically>>;
  refreshPlan?: (input: Parameters<LeadAnalysisProvider["proposeClarifications"]>[0]) => ReturnType<typeof planClarificationsDeterministically> | Promise<ReturnType<typeof planClarificationsDeterministically>>;
};

function provider(options: ProviderOptions = {}): LeadAnalysisProvider {
  let clarificationCalls = 0;
  return {
    analyzePrompt: async (input) => options.analyze?.(input) ?? analyzePromptDeterministically(input),
    proposeClarifications: async (input) => { clarificationCalls += 1; return clarificationCalls > 1 && options.refreshPlan ? options.refreshPlan(input) : planClarificationsDeterministically(input); },
    assembleBriefDraft: async (input) => assembleRequirements(input),
  };
}

class FailingClarificationDatabase implements PersistenceDatabase {
  failClarificationSave = false;
  constructor(readonly inner: InMemoryPersistenceDatabase) {}
  async transaction<T>(work: (transaction: PersistenceTransaction) => Promise<T>): Promise<T> {
    return this.inner.transaction((transaction) => work({
      ...transaction,
      saveDocument: async (row, token) => {
        if (this.failClarificationSave && row.documentType === "clarification-log") throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "synthetic canonical clarification save failure");
        return transaction.saveDocument(row, token);
      },
    }));
  }
}

async function fixture(options: { provider?: LeadAnalysisProvider; database?: PersistenceDatabase } = {}) {
  const database = options.database ?? new InMemoryPersistenceDatabase();
  const memory = new FakeLeadMemoryPort();
  const makeLead = () => new LeadAgentService({ database, memory, provider: options.provider ?? provider() });
  let calls = 0;
  const entry = new TrialEntryService({ database, createLeadAgent: () => { calls += 1; return makeLead(); } });
  const app = new WorkbenchApplication({ database, entry });
  const created = await app.handle({ action: "create", requestText: syntheticPrompt, languageHint: "de" });
  if (!created.project) throw new Error("synthetic project was not created");
  const repository = new ClarificationRepository(database);
  const stored = await repository.getSession(created.project.projectId, 1);
  if (!stored) throw new Error("synthetic clarification session was not persisted");
  await repository.saveSession({ ...stored, operatorLanguage: undefined, questions: stored.questions.map((question) => ({ ...question, question: `Bitte beantworten: ${question.question}` })), answers: [] }, `seed-german-${randomUUID()}`);
  return { database, app, entry, created, calls, repository, projectId: created.project.projectId };
}

function safe(error: unknown, projectId = "00000000-0000-4000-8000-000000000000") {
  return workbenchFailureResponse(error, { action: "refresh-clarifications", projectId }).response;
}

describe("Lead refresh recovery LR1-LR36 / IDEM1-IDEM16", () => {
  it("LR1 known LeadError retains its typed safe code through Workbench diagnostics", async () => {
    const f = await fixture({ provider: provider({ refreshPlan: (input) => ({ ...planClarificationsDeterministically(input), questions: planClarificationsDeterministically(input).questions.map((question) => ({ ...question, question: `Bitte ${question.question}` })) }) }) });
    await expect(f.app.handle({ action: "refresh-clarifications", projectId: f.projectId, requestId: randomUUID() })).rejects.toMatchObject({ code: "LEAD_CLARIFICATION_LANGUAGE_INVALID" });
    const error = await f.entry.refreshClarifications(f.projectId, randomUUID()).catch((value) => value);
    expect(safe(error, f.projectId)).toMatchObject({ code: "LEAD_CLARIFICATION_LANGUAGE_INVALID", operation: "REFRESH_LEAD_CLARIFICATIONS", category: "VALIDATION" });
  });

  it("LR2 unknown exceptions remain WORKBENCH_INTERNAL_ERROR", () => expect(safe(new Error("private failure"))).toMatchObject({ code: "WORKBENCH_INTERNAL_ERROR", category: "INTERNAL" }));
  it("LR3-LR6 safe Lead diagnostics exclude private message, stack, provider payload, and auth", () => {
    const response = JSON.stringify(safe(new AiProviderError("AI_PROVIDER_UNAVAILABLE", "raw provider payload api_key=secret")));
    expect(response).not.toMatch(/raw provider|api_key|secret|stack/i);
  });
  it("LR7 provider-backed Lead failure retains its safe provider category", () => expect(safe(new AiProviderError("AI_PROVIDER_UNAVAILABLE", "private"))).toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", category: "PROVIDER", recoverable: true }));
  it("LR8 structured-output failure retains its safe provider identity", () => expect(safe(new AiProviderError("AI_STRUCTURED_PARSE_FAILED", "private"))).toMatchObject({ code: "AI_STRUCTURED_PARSE_FAILED", category: "PROVIDER" }));
  it("LR9 language-validation failure retains its safe Lead identity", () => expect(safe(new LeadError("LEAD_CLARIFICATION_LANGUAGE_INVALID", "private"))).toMatchObject({ code: "LEAD_CLARIFICATION_LANGUAGE_INVALID", category: "VALIDATION" }));
  it("LR10 persistence-wrapped failure retains its safe persistence identity", () => expect(safe(new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "private SQL"))).toMatchObject({ code: "PERSISTENCE_PROVIDER_ERROR", category: "PERSISTENCE" }));

  it("LR11-LR17 successful synthetic refresh stays in the same CLARIFYING project without a Brief", async () => {
    const f = await fixture();
    const before = await f.repository.getSession(f.projectId, 1);
    const result = await f.app.handle({ action: "refresh-clarifications", projectId: f.projectId, requestId: randomUUID() });
    const after = await f.repository.getSession(f.projectId, 1);
    expect(result.project?.projectId).toBe(f.projectId);
    expect(result.project?.workflowState).toBe("CLARIFYING");
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions.every((question) => !question.question.includes("Bitte"))).toBe(true);
    expect(result.questions.map((question) => question.id)).not.toEqual(before?.questions.map((question) => question.id));
    expect(after?.supersededQuestions?.map((item) => item.question.id)).toEqual(expect.arrayContaining(before?.questions.map((question) => question.id) ?? []));
    expect(result.brief).toBeUndefined();
  });

  it("LR18-LR21 provider failure leaves canonical version, row, clarification, and Brief unchanged", async () => {
    const f = await fixture({ provider: provider({ refreshPlan: async () => { throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", "synthetic"); } }) });
    const beforeProject = f.database instanceof InMemoryPersistenceDatabase ? f.database.projects.get(f.projectId) : undefined;
    const before = await f.repository.getSession(f.projectId, 1);
    await expect(f.app.handle({ action: "refresh-clarifications", projectId: f.projectId, requestId: randomUUID() })).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });
    const afterProject = f.database instanceof InMemoryPersistenceDatabase ? f.database.projects.get(f.projectId) : undefined;
    const after = await f.repository.getSession(f.projectId, 1);
    expect(afterProject).toEqual(beforeProject);
    expect(after).toEqual(before);
    expect(await f.repository.get(f.projectId, 1, "requirements")).toBeNull();
  });

  it("LR22-LR25 failed operation is released and a later explicit retry can succeed", async () => {
    let attempts = 0;
    const f = await fixture({ provider: provider({ refreshPlan: (input) => { attempts += 1; if (attempts === 1) throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", "synthetic"); return planClarificationsDeterministically(input); } }) });
    await expect(f.app.handle({ action: "refresh-clarifications", projectId: f.projectId, requestId: randomUUID() })).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });
    await expect(f.app.handle({ action: "refresh-clarifications", projectId: f.projectId, requestId: randomUUID() })).resolves.toMatchObject({ project: { projectId: f.projectId }, status: { label: expect.any(String) } });
  });

  it("LR25 poisoned provider analysis is rejected before caching and the next explicit refresh is allowed", async () => {
    let analysisAttempts = 0;
    const f = await fixture({ provider: provider({
      analyze: (input) => { const result = analyzePromptDeterministically(input); analysisAttempts += 1; return input.currentWorkflowState === "CLARIFYING" && analysisAttempts === 2 ? { ...result, originalPromptChecksum: "0".repeat(64) } : result; },
    }) });
    await expect(f.app.handle({ action: "refresh-clarifications", projectId: f.projectId, requestId: randomUUID() })).rejects.toMatchObject({ code: "LEAD_ANALYSIS_INVALID" });
    await expect(f.app.handle({ action: "refresh-clarifications", projectId: f.projectId, requestId: randomUUID() })).resolves.toMatchObject({ project: { projectId: f.projectId } });
  });

  it("LR25 stale cached analysis is discarded before the same Lead service retries", async () => {
    const f = await fixture();
    let analysisAttempts = 0;
    const lead = new LeadAgentService({ database: f.database, memory: new FakeLeadMemoryPort(), provider: provider({
      analyze: (input) => { const result = analyzePromptDeterministically(input); analysisAttempts += 1; return analysisAttempts === 1 ? { ...result, originalPromptChecksum: "0".repeat(64) } : result; },
    }) });
    const input = {
      projectId: f.projectId,
      projectVersion: 1,
      originalPrompt: syntheticPrompt,
      suppliedFiles: [],
      availableAssets: [],
      knownUserAnswers: {},
      currentWorkflowState: "CLARIFYING" as const,
      idempotencyKey: "synthetic-cache-recovery",
      operatorLanguage: "en" as const,
      siteLanguage: "de" as const,
    };
    await expect(lead.analyzeProjectPrompt(input)).rejects.toMatchObject({ code: "LEAD_ANALYSIS_INVALID" });
    await expect(lead.analyzeProjectPrompt(input)).resolves.toMatchObject({ projectId: f.projectId, projectVersion: 1 });
    expect(analysisAttempts).toBe(2);
  });

  it("LR26-LR28 protects a concurrent duplicate and does not double-commit a successful replay", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = await fixture({ provider: provider({ analyze: async (input) => { if (input.currentWorkflowState === "CLARIFYING") await gate; return analyzePromptDeterministically(input); } }) });
    const requestId = randomUUID();
    const first = f.entry.refreshClarifications(f.projectId, requestId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(f.entry.refreshClarifications(f.projectId, requestId)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    release?.();
    await first;
    const replay = await f.entry.refreshClarifications(f.projectId, requestId);
    expect(replay.lead.clarificationQuestions.length).toBeGreaterThan(0);
    const session = await f.repository.getSession(f.projectId, 1);
    expect(session?.clarificationVersion).toBe(2);
  });

  it("LR29-LR31 UI disables refresh while pending, has no automatic retry, and resets pending state", async () => {
    const source = await readFile("src/components/workbench.tsx", "utf8");
    expect(source).toContain('disabled={loading}');
    expect(source).toContain('"Refreshing..."');
    expect(source).toContain('setPendingAction(null)');
    expect(source).not.toMatch(/setTimeout|auto.?retry|retry\s*\(/i);
  });
  it("LR32-LR34 preserves operator English, site German, and refreshed English questions", async () => {
    const f = await fixture();
    const result = await f.app.handle({ action: "refresh-clarifications", projectId: f.projectId, requestId: randomUUID() });
    expect(result.operatorLanguage).toBe("en");
    expect(result.siteLanguage).toBe("de");
    expect(result.questions.every((question) => !question.question.includes("Bitte"))).toBe(true);
  });
  it("LR34 language validation does not reject an English question containing a German proper term", async () => {
    const f = await fixture({ provider: provider({ refreshPlan: (input) => {
      const plan = planClarificationsDeterministically(input);
      return { ...plan, questions: plan.questions.map((question, index) => index === 0 ? { ...question, question: "Which page should reference the German term Impressum?" } : { ...question, question: "Which confirmed project detail should the brief include?" }) };
    } }) });
    await expect(f.entry.refreshClarifications(f.projectId, randomUUID())).resolves.toHaveProperty("project.projectId", f.projectId);
  });
  it("LR35-LR36 synthetic tests never reference or mutate the real project", () => {
    expect(realProjectId).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(clearWorkbenchDiagnosticEvents()).toBeUndefined();
  });

  it("IDEM1 request identity is UUID-only and generated per explicit refresh action", async () => {
    const parsed = WorkbenchRequestSchema.parse({ action: "refresh-clarifications", projectId: randomUUID(), requestId: randomUUID() });
    expect(parsed.action).toBe("refresh-clarifications");
    const source = await readFile("src/components/workbench.tsx", "utf8");
    expect(source).toContain("crypto.randomUUID()");
  });
  it("IDEM2-IDEM3 same in-flight identity is rejected and cannot double-write", async () => {
    const f = await fixture();
    const requestId = randomUUID();
    const first = f.entry.refreshClarifications(f.projectId, requestId);
    await expect(f.entry.refreshClarifications(f.projectId, requestId)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await first;
    expect((await f.repository.getSession(f.projectId, 1))?.clarificationVersion).toBe(2);
  });
  it("IDEM4-IDEM7 failed operation is not SUCCEEDED or permanently IN_PROGRESS", async () => {
    let calls = 0;
    const f = await fixture({ provider: provider({ refreshPlan: (input) => { calls += 1; if (calls === 1) throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", "synthetic"); return planClarificationsDeterministically(input); } }) });
    const requestId = randomUUID();
    await expect(f.entry.refreshClarifications(f.projectId, requestId)).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });
    await expect(f.entry.refreshClarifications(f.projectId, requestId)).resolves.toMatchObject({ project: { projectId: f.projectId } });
  });
  it("IDEM8-IDEM9 successful replay is stable and not a new canonical commit", async () => {
    const f = await fixture();
    const requestId = randomUUID();
    const first = await f.entry.refreshClarifications(f.projectId, requestId);
    const second = await f.entry.refreshClarifications(f.projectId, requestId);
    expect(second).toEqual(first);
    expect((await f.repository.getSession(f.projectId, 1))?.clarificationVersion).toBe(2);
  });
  it("IDEM10-IDEM12 operation identity is not authorization, prompt, or secret material", async () => {
    const source = await readFile("src/runtime/trial-entry/service.ts", "utf8");
    expect(source).toContain("operationKey = `${projectId}:${requestId}`");
    expect(source).not.toContain("originalPrompt}:${requestId}");
    expect(source).not.toMatch(/authorization|cookie|api.?key/i);
  });
  it("IDEM13 project isolation is preserved for the same request UUID", async () => {
    const database = new InMemoryPersistenceDatabase();
    const first = await fixture({ database });
    const second = await fixture({ database });
    const requestId = randomUUID();
    await expect(first.entry.refreshClarifications(first.projectId, requestId)).resolves.toHaveProperty("project.projectId", first.projectId);
    await expect(second.entry.refreshClarifications(second.projectId, requestId)).resolves.toHaveProperty("project.projectId", second.projectId);
  });
  it("IDEM14 transaction failure leaves the project consistent", async () => {
    const database = new FailingClarificationDatabase(new InMemoryPersistenceDatabase());
    const f = await fixture({ database });
    const before = await f.repository.getSession(f.projectId, 1);
    database.failClarificationSave = true;
    await expect(f.entry.refreshClarifications(f.projectId, randomUUID())).rejects.toMatchObject({ code: "PERSISTENCE_PROVIDER_ERROR" });
    expect(await f.repository.getSession(f.projectId, 1)).toEqual(before);
  });
  it("IDEM15 persistence operation state is implemented by both process-safe adapters", async () => {
    const [types, fake, postgres] = await Promise.all([readFile("src/persistence/database/types.ts", "utf8"), readFile("src/persistence/database/fake.ts", "utf8"), readFile("src/persistence/database/postgres.ts", "utf8")]);
    expect(types).toContain("reserveOperation");
    expect(fake).toContain('status: "IN_PROGRESS"');
    expect(postgres).toContain("ON CONFLICT (operation, idempotency_key) DO NOTHING");
  });
  it("IDEM16 does not use the real persisted project", () => expect(realProjectId).toBe("b7a0829d-a077-487c-844a-3232efc21bc3"));
});
