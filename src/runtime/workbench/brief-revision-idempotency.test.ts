import { describe, expect, it } from "vitest";
import { DeterministicLeadProvider, type BriefRevisionProviderInput } from "@/agents/lead/ports";
import { LeadAgentService } from "@/agents/lead/service";
import { analyzePromptDeterministically, assembleRequirements, planClarificationsDeterministically } from "@/agents/lead/deterministic";
import type { BriefDraft } from "@/agents/lead/contracts";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "./application";

const prompt = "Title: Synthetic repair shop\nPurpose: Serve local customers\nAudience: Visitors\nPages: home, contact\nFunctionality: contact form\nLanguages: en\nImages: placeholders\nAcceptance: contact path works";
const answer = (key?: string) => key === "languages" ? "en" : key === "pages" ? "Home and Contact" : key === "acceptance" ? "Contact path works." : key === "image-source" ? "placeholders" : "Synthetic confirmation.";

function draft(input: BriefRevisionProviderInput): BriefDraft {
  const requirements = RequirementSpecificationSchema.parse({ ...input.currentBrief, technicalConstraints: [...input.currentBrief.technicalConstraints, "synthetic revision"], approval: { approved: false }, briefStatus: "draft" });
  return { projectId: input.projectId, projectVersion: input.projectVersion, requirements, facts: [], recommendations: [], unresolvedItems: [], evidence: requirements.evidence, readyForApproval: true, blockingReasons: [], nonBlockingWarnings: [], briefChecksum: checksumPersistedDocument(requirements) };
}

async function fixture(options: { delay?: number; failOnce?: boolean } = {}) {
  const database = new InMemoryPersistenceDatabase();
  const memory = new FakeLeadMemoryPort();
  let calls = 0;
  const provider = new DeterministicLeadProvider(
    analyzePromptDeterministically,
    (input) => planClarificationsDeterministically(input),
    assembleRequirements,
    async (input) => {
      calls += 1;
      if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
      if (options.failOnce && calls === 1) throw new Error("synthetic provider failure");
      return draft(input);
    },
  );
  const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory, provider }) });
  const app = new WorkbenchApplication({ database, entry });
  const created = await app.handle({ action: "create", requestText: prompt });
  if (!created.project) throw new Error("synthetic project was not created");
  const answers = created.questions.filter((question) => question.answerStatus === "unresolved").map((question) => ({ questionId: question.id, answer: answer(question.requirementKey) }));
  if (answers.length) await app.handle({ action: "respond", projectId: created.project.projectId, answers });
  const current = await app.handle({ action: "status", projectId: created.project.projectId });
  if (!current.brief) throw new Error("synthetic Brief was not ready");
  const currentness = { projectVersion: current.project!.projectVersion, briefChecksum: current.brief.checksum, expectedRowVersion: current.project!.rowVersion };
  return { app, projectId: created.project.projectId, currentness, get calls() { return calls; } };
}

const revisionRequest = (fixtureState: Awaited<ReturnType<typeof fixture>>, reason: string, requirementKeys = ["project-brief"], currentness = fixtureState.currentness) => ({ action: "request-brief-changes" as const, projectId: fixtureState.projectId, ...currentness, reason, requirementKeys });

describe("Brief revision round idempotency", () => {
  it("BRI26/BCP20/BCP21: concurrent duplicate clicks share one top-level operation and never use raw text in the key", async () => {
    const f = await fixture({ delay: 20 });
    const request = revisionRequest(f, "Synthetic duplicate revision with full canonical context.");
    const results = await Promise.allSettled([f.app.handle(request), f.app.handle(request)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]).toMatchObject({ reason: expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }) });
    expect(f.calls).toBe(1);
  });

  it("BCP12/BCP13: a failed revision makes zero persisted Brief changes and permits a later retry", async () => {
    const f = await fixture({ failOnce: true });
    const request = revisionRequest(f, "Synthetic retry after a provider failure.");
    await expect(f.app.handle(request)).rejects.toThrow();
    await expect(f.app.handle(request)).resolves.toMatchObject({ project: { workflowState: "AWAITING_BRIEF_APPROVAL" }, brief: { approved: false } });
    expect(f.calls).toBe(2);
  });

  it("allows a different revision after failure, replays an exact success, and rejects stale currentness", async () => {
    const f = await fixture({ failOnce: true });
    const failedAttempt = revisionRequest(f, "Synthetic revision A that is rejected.");
    await expect(f.app.handle(failedAttempt)).rejects.toThrow();
    const afterFailure = await f.app.handle({ action: "status", projectId: f.projectId });
    expect(afterFailure.project?.projectVersion).toBe(f.currentness.projectVersion);
    expect(afterFailure.project?.rowVersion).toBe(f.currentness.expectedRowVersion);
    expect(afterFailure.brief?.checksum).toBe(f.currentness.briefChecksum);

    const revisionB = revisionRequest(f, "Synthetic legitimate revision B.");
    const accepted = await f.app.handle(revisionB);
    expect(accepted.brief?.checksum).not.toBe(f.currentness.briefChecksum);
    const replay = await f.app.handle(revisionB);
    expect(replay.brief?.checksum).toBe(accepted.brief?.checksum);
    expect(f.calls).toBe(2);

    const staleB = revisionRequest(f, revisionB.reason, ["project-brief", "stale-attempt"]);
    await expect(f.app.handle(staleB)).rejects.toMatchObject({ code: "BRIEF_CHECKSUM_MISMATCH" });
    expect(f.calls).toBe(2);
  });
});
