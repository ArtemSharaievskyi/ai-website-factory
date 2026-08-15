import { describe, expect, it } from "vitest";
import { analyzePromptDeterministically, assembleRequirements } from "@/agents/lead/deterministic";
import { LeadAgentService } from "@/agents/lead/service";
import type { LeadAnalysisProvider } from "@/agents/lead/ports";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { ClarificationRepository } from "@/persistence/database/repositories";
import { TrialEntryService } from "./service";
import {
  ANSWER_CLARIFICATIONS_OPERATION,
  clarificationAnswerOperationKey,
  clarificationRoundFingerprint,
  normalizeClarificationAnswers,
} from "./idempotency";

const ids = {
  q1: "11111111-1111-4111-8111-111111111111",
  q2: "22222222-2222-4222-8222-222222222222",
  q3: "33333333-3333-4333-8333-333333333333",
  q4: "44444444-4444-4444-8444-444444444444",
};

const planQuestion = (id: string, requirementKey: string) => ({
  id,
  requirementKey,
  category: "content" as const,
  question: `Synthetic Frage ${requirementKey}`,
  reason: "Synthetic sequential-round fixture.",
  blocking: true,
  required: true,
  fingerprint: `synthetic:${requirementKey}`,
});

function fixture(options: {
  initialQuestionIds?: string[];
  failQuestionIds?: string[];
  gateQuestionId?: string;
} = {}) {
  const database = new InMemoryPersistenceDatabase();
  const memory = new FakeLeadMemoryPort();
  const providerCalls: string[] = [];
  const initialQuestionIds = options.initialQuestionIds ?? [ids.q1, ids.q2];
  let releaseGate: (() => void) | undefined;
  let markGateReached: (() => void) | undefined;
  const gateReached = options.gateQuestionId
    ? new Promise<void>((resolve) => { markGateReached = resolve; })
    : undefined;
  const gate = options.gateQuestionId
    ? new Promise<void>((resolve) => { releaseGate = resolve; })
    : undefined;
  let failuresRemaining = options.failQuestionIds?.length ?? 0;
  const provider: LeadAnalysisProvider = {
    analyzePrompt: async (input) => analyzePromptDeterministically(input),
    proposeClarifications: async (input) => {
      const answered = new Set(input.session?.answers.map((answer) => answer.questionId) ?? []);
      const submittedQuestion = [...answered].at(-1);
      providerCalls.push(`clarify:${submittedQuestion ?? "initial"}`);
      if (submittedQuestion === options.gateQuestionId && gate) {
        markGateReached?.();
        await gate;
      }
      if (submittedQuestion && options.failQuestionIds?.includes(submittedQuestion) && failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error("SYNTHETIC_LEAD_FAILURE");
      }
      const next = submittedQuestion === undefined ? initialQuestionIds : submittedQuestion === ids.q1 ? [ids.q2] : submittedQuestion === ids.q2 ? [ids.q3] : submittedQuestion === ids.q3 ? [ids.q4] : [];
      return {
        projectId: input.analysis.projectId,
        projectVersion: input.analysis.projectVersion,
        operatorLanguage: input.operatorLanguage,
        generatedAt: "2026-01-01T00:00:00.000Z",
        questions: next.map((id) => planQuestion(id, `round-${id.slice(0, 4)}`)),
      };
    },
    assembleBriefDraft: async (input) => assembleRequirements(input),
  };
  const entry = new TrialEntryService({
    database,
    createLeadAgent: () => new LeadAgentService({ database, memory, provider }),
  });
  return { database, entry, providerCalls, releaseGate, gateReached };
}

async function createProject(entry: TrialEntryService) {
  const result = await entry.createProject({ requestText: "Erstelle eine synthetische deutsche Testseite.", operatorLanguage: "de", languageHint: "de" });
  return { project: result.project };
}

describe("sequential Lead clarification idempotency SRI1-SRI36 / IDR1-IDR28 / IPO1-IPO16", () => {
  it("runs two legitimate rounds, creates Q3, and replays the second round without a second Lead call", async () => {
    const fixtureValue = fixture();
    const created = await createProject(fixtureValue.entry);
    const first = await fixtureValue.entry.respond(created.project.projectId, [
      { questionId: ids.q1, answer: "Antwort eins" },
      { questionId: ids.q2, answer: "Antwort zwei" },
    ]);
    const afterFirst = await fixtureValue.entry.status(created.project.projectId);
    expect(afterFirst.clarification?.questions.filter((question) => question.answerStatus === "unresolved").map((question) => question.id)).toEqual([ids.q3]);
    expect(first.workflowState).toBe("CLARIFYING");
    const callsBeforeSecond = fixtureValue.providerCalls.length;
    const second = await fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q3, answer: "Antwort drei" }]);
    expect(second.workflowState).toBe("CLARIFYING");
    expect(fixtureValue.providerCalls.length).toBe(callsBeforeSecond + 1);
    const replay = await fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q3, answer: "Antwort drei" }]);
    expect(replay).toEqual(second);
    expect(fixtureValue.providerCalls.length).toBe(callsBeforeSecond + 1);
    const session = await new ClarificationRepository(fixtureValue.database).getSession(created.project.projectId, 1);
    expect(session?.answers.filter((answer) => answer.questionId === ids.q3)).toHaveLength(1);
  });

  it("keeps three sequential answer rounds distinct", async () => {
    const fixtureValue = fixture({ initialQuestionIds: [ids.q1] });
    const created = await createProject(fixtureValue.entry);
    const keys = [ids.q1, ids.q2, ids.q3].map((questionId) => clarificationAnswerOperationKey({ projectId: created.project.projectId, projectVersion: 1, answers: [{ questionId, answer: `Answer ${questionId}` }] }).key);
    expect(new Set(keys).size).toBe(3);
    await fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q1, answer: "Answer one" }]);
    await fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q2, answer: "Answer two" }]);
    await fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q3, answer: "Answer three" }]);
    const status = await fixtureValue.entry.status(created.project.projectId);
    expect(status.clarification?.questions.filter((question) => question.answerStatus === "unresolved").map((question) => question.id)).toEqual([ids.q4]);
  });

  it("blocks an identical in-flight duplicate and invokes Lead once", async () => {
    const fixtureValue = fixture({ gateQuestionId: ids.q3 });
    const created = await createProject(fixtureValue.entry);
    await fixtureValue.entry.respond(created.project.projectId, [
      { questionId: ids.q1, answer: "Antwort eins" },
      { questionId: ids.q2, answer: "Antwort zwei" },
    ]);
    const first = fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q3, answer: "Antwort drei" }]);
    await fixtureValue.gateReached;
    await expect(fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q3, answer: "Antwort drei" }])).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    fixtureValue.releaseGate?.();
    await first;
    expect(fixtureValue.providerCalls.filter((call) => call === `clarify:${ids.q3}`).length).toBe(1);
  });

  it("allows an explicit retry after a failed round without persisting its answers", async () => {
    const fixtureValue = fixture({ failQuestionIds: [ids.q3] });
    const created = await createProject(fixtureValue.entry);
    await fixtureValue.entry.respond(created.project.projectId, [
      { questionId: ids.q1, answer: "Antwort eins" },
      { questionId: ids.q2, answer: "Antwort zwei" },
    ]);
    await expect(fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q3, answer: "Antwort drei" }])).rejects.toThrow("SYNTHETIC_LEAD_FAILURE");
    const unchanged = await fixtureValue.entry.status(created.project.projectId);
    expect(unchanged.clarification?.questions.find((question) => question.id === ids.q3)?.answerStatus).toBe("unresolved");
    await expect(fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q3, answer: "Antwort drei" }])).resolves.toBeTruthy();
  });

  it("rejects stale and unknown question submissions before provider work", async () => {
    const fixtureValue = fixture();
    const created = await createProject(fixtureValue.entry);
    await fixtureValue.entry.respond(created.project.projectId, [
      { questionId: ids.q1, answer: "Antwort eins" },
      { questionId: ids.q2, answer: "Antwort zwei" },
    ]);
    const calls = fixtureValue.providerCalls.length;
    await expect(fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q1, answer: "Korrigierte Antwort" }])).rejects.toMatchObject({ code: "CLARIFICATION_ALREADY_RESOLVED" });
    await expect(fixtureValue.entry.respond(created.project.projectId, [{ questionId: ids.q4, answer: "Unbekannt" }])).rejects.toThrow("TRIAL_ENTRY_QUESTION_NOT_FOUND");
    expect(fixtureValue.providerCalls.length).toBe(calls);
  });

  it("normalizes payload ordering and keeps raw answers/question text out of the operation key", () => {
    const first = clarificationAnswerOperationKey({ projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", projectVersion: 1, answers: [{ questionId: ids.q2, answer: "same" }, { questionId: ids.q1, answer: "same" }] });
    const second = clarificationAnswerOperationKey({ projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", projectVersion: 1, answers: [{ questionId: ids.q1, status: "answered", answer: "same" }, { questionId: ids.q2, status: "answered", answer: "same" }] });
    expect(first.key).toBe(second.key);
    expect(normalizeClarificationAnswers([{ questionId: ids.q2, answer: "b" }, { questionId: ids.q1, answer: "a" }]).map((answer) => answer.questionId)).toEqual([ids.q1, ids.q2]);
    expect(first.key).not.toContain("same");
    expect(first.key).not.toContain("Synthetic Frage");
    expect(clarificationRoundFingerprint({ projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", projectVersion: 1, questionIds: [ids.q1, ids.q2] })).not.toBe(clarificationRoundFingerprint({ projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", projectVersion: 1, questionIds: [ids.q3] }));
    expect(ANSWER_CLARIFICATIONS_OPERATION).toContain(":v2");
  });
});
