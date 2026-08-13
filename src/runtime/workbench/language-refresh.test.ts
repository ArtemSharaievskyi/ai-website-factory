import { describe, expect, it } from "vitest";
import { analyzePromptDeterministically, assembleRequirements, planClarificationsDeterministically } from "@/agents/lead/deterministic";
import { DeterministicLeadProvider } from "@/agents/lead/ports";
import { LeadAgentService } from "@/agents/lead/service";
import { ClarificationRepository } from "@/persistence/database/repositories";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { ClarificationSessionSchema } from "@/domain/requirements/schema";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { WorkbenchApplication } from "./application";

const prompt = "Create a synthetic German customer website for a local service business.";

describe("explicit clarification language refresh", () => {
  it("keeps refresh gated and reprojects the same unanswered project in English", async () => {
    const database = new InMemoryPersistenceDatabase();
    const memory = new FakeLeadMemoryPort();
    const provider = new DeterministicLeadProvider(analyzePromptDeterministically, planClarificationsDeterministically, assembleRequirements);
    const { TrialEntryService } = await import("@/runtime/trial-entry/service");
    const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory, provider }) });
    const app = new WorkbenchApplication({ database, entry });
    const created = await app.handle({ action: "create", requestText: prompt });
    if (!created.project) throw new Error("missing fixture project");
    const stored = await new ClarificationRepository(database).getSession(created.project.projectId, 1);
    if (!stored) throw new Error("missing clarification session");
    const german = ClarificationSessionSchema.parse({ ...stored, operatorLanguage: undefined, questions: stored.questions.map((question) => ({ ...question, question: `Bitte beantworten: ${question.question}` })), answers: [] });
    await new ClarificationRepository(database).saveSession(german, "seed-german-session");

    const before = await app.handle({ action: "status", projectId: created.project.projectId });
    expect(before.status.allowedActions).toEqual(["ANSWER_LEAD_CLARIFICATIONS", "REFRESH_LEAD_CLARIFICATIONS"]);
    expect(before.questions[0]?.question).toContain("Bitte");

    const refreshed = await app.handle({ action: "refresh-clarifications", projectId: created.project.projectId });
    expect(refreshed.project?.projectId).toBe(created.project.projectId);
    expect(refreshed.project?.projectVersion).toBe(1);
    expect(refreshed.project?.workflowState).toBe("CLARIFYING");
    expect(refreshed.questions.length).toBeGreaterThan(0);
    expect(refreshed.questions.every((question) => !question.question.includes("Bitte"))).toBe(true);
    expect(refreshed.status.allowedActions).toEqual(["ANSWER_LEAD_CLARIFICATIONS"]);

    const after = await new ClarificationRepository(database).getSession(created.project.projectId, 1);
    if (!after) throw new Error("missing refreshed session");
    expect(after.operatorLanguage).toBe("en");
    expect(after.clarificationVersion).toBe(2);
    expect(after.answers).toEqual([]);
    expect(after.supersededQuestions?.map((item) => item.question.id)).toEqual(expect.arrayContaining(stored.questions.map((question) => question.id)));
    expect(database.events.filter((event) => event.toState !== "CLARIFYING")).toEqual([]);
    await expect(app.handle({ action: "respond", projectId: created.project.projectId, answers: [{ questionId: stored.questions[0]!.id, answer: "old draft must be stale" }] })).rejects.toThrow("TRIAL_ENTRY_QUESTION_NOT_FOUND");
  });
});
