import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { LeadAgentService } from "@/agents/lead/service";
import {
  DeterministicLeadProvider,
} from "@/agents/lead/ports";
import {
  analyzePromptDeterministically,
  assembleRequirements,
  planClarificationsDeterministically,
} from "@/agents/lead/deterministic";
import { transitionWorkflow } from "@/domain/workflow/engine";
import {
  createInitialProjectRequest,
  MAX_INITIAL_PROJECT_REQUEST_BYTES,
} from "@/domain/project/initial-request";
import {
  parseNewArgs,
  readInitialRequest,
} from "./cli";
import { TrialEntryService } from "./service";

const syntheticPrompt = "Create a local German test business website.";
const answerFor = (requirementKey: string | undefined) => {
  switch (requirementKey) {
    case "business-purpose": return "A local test business website.";
    case "target-audience": return "Local customers.";
    case "languages": return "de";
    case "pages": return "Home, Kontakt";
    case "functionality": return "A contact form.";
    case "contact": return "Test contact only.";
    case "image-source": return "placeholders";
    case "logo": return "no logo";
    case "acceptance": return "Done when the German test site renders.";
    default: return "Confirmed synthetic test answer.";
  }
};

function fixture(options: { calls?: string[] } = {}) {
  const database = new InMemoryPersistenceDatabase();
  const memory = new FakeLeadMemoryPort();
  const deterministic = new DeterministicLeadProvider(
    (input) => {
      options.calls?.push("analyze");
      return analyzePromptDeterministically(input);
    },
    (input) => {
      options.calls?.push("clarify");
      return planClarificationsDeterministically(input);
    },
    (input) => {
      options.calls?.push("brief");
      return assembleRequirements(input);
    },
  );
  const entry = new TrialEntryService({
    database,
    createLeadAgent: () => new LeadAgentService({ database, memory, provider: deterministic }),
  });
  return { database, memory, entry };
}

async function completeClarifications(entry: TrialEntryService, projectId: string) {
  const status = await entry.status(projectId);
  const questions = status.clarification?.questions.filter((question) => question.answerStatus === "unresolved") ?? [];
  return entry.respond(projectId, questions.map((question) => ({ questionId: question.id, answer: answerFor(question.requirementKey) })));
}

describe("first-trial canonical entry matrix", () => {
  it("T1 creates and initializes a canonical project through existing authority", async () => {
    const { database, memory, entry } = fixture();
    const result = await entry.createProject({ requestText: syntheticPrompt });
    expect(database.projects.has(result.project.projectId)).toBe(true);
    expect(memory.documents.get(`${result.project.projectId}:1`)).toHaveProperty("original-prompt.md");
    expect(result.workflowState).toBe("CLARIFYING");
  });

  it("T2 routes the initial request to Lead first", async () => {
    const calls: string[] = [];
    const { entry } = fixture({ calls });
    const result = await entry.createProject({ requestText: syntheticPrompt });
    expect(result.lead.firstSemanticOwner).toBe("lead");
    expect(calls.slice(0, 2)).toEqual(["analyze", "clarify"]);
  });

  it("T3 prevents Planner execution before Lead and Brief rules allow it", () => {
    expect(() => transitionWorkflow("CLARIFYING", "AWAITING_DESIGN_SELECTION")).toThrow();
  });

  it("T4 prevents Design execution before required upstream approvals", () => {
    expect(() => transitionWorkflow("AWAITING_BRIEF_APPROVAL", "ARCHITECTURE_REVIEW")).toThrow();
  });

  it("T5 prevents implementation from starting from a raw request", () => {
    expect(() => transitionWorkflow("DRAFT", "IMPLEMENTING")).toThrow();
  });

  it("T6 rejects an empty project request", () => {
    expect(() => createInitialProjectRequest({ requestText: "\n  " })).toThrow("INITIAL_REQUEST_EMPTY");
  });

  it("T7 rejects a request above the explicit byte bound", () => {
    expect(() => createInitialProjectRequest({ requestText: "x".repeat(MAX_INITIAL_PROJECT_REQUEST_BYTES + 1) })).toThrow("INITIAL_REQUEST_TOO_LARGE");
  });

  it("T8 accepts a multiline request", async () => {
    const { entry } = fixture();
    await expect(entry.createProject({ requestText: "Title: Test\nPages: Home, Kontakt\nAcceptance: renders" })).resolves.toMatchObject({ workflowState: "CLARIFYING" });
  });

  it("T9 accepts UTF-8 request text", async () => {
    const { entry } = fixture();
    await expect(entry.createProject({ requestText: "Erstelle eine kleine Prüfung: äöü ß — Testseite." })).resolves.toHaveProperty("request.byteSize");
  });

  it("T10 keeps English instructions and German site language independent of internal IDs", async () => {
    const { entry } = fixture();
    const result = await entry.createProject({ requestText: "Create an English brief for a German customer-facing website.\nLanguages: de" });
    expect(result.project.slug).toMatch(/^project-[a-f0-9]{8}$/);
    expect(result.project.slug).not.toContain("de");
  });

  it("T11 never treats project text as a filesystem path", async () => {
    const { entry } = fixture();
    const result = await entry.createProject({ requestText: "Workspace: D:\\outside\\customer\\src\\app\\page.tsx" });
    expect(result.project.slug).toMatch(/^project-[a-f0-9]{8}$/);
  });

  it("T12 safely reads prompt-file mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "factory-entry-"));
    try {
      const file = path.join(root, "trial-site-prompt.txt");
      await writeFile(file, syntheticPrompt, "utf8");
      const result = await readInitialRequest(parseNewArgs(["--prompt-file", file]), process.stdin);
      expect(result).toBe(syntheticPrompt);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("T13 does not shell-interpolate prompt-file contents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "factory-entry-"));
    try {
      const value = "$(Get-ChildItem) `whoami` & <script>";
      const file = path.join(root, "prompt.txt");
      await writeFile(file, value, "utf8");
      expect(await readInitialRequest(parseNewArgs(["--prompt-file", file]), process.stdin)).toBe(value);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("T14 assigns project identity in the host entry layer", async () => {
    const { entry } = fixture();
    const first = await entry.createProject({ requestText: syntheticPrompt });
    const second = await entry.createProject({ requestText: syntheticPrompt });
    expect(first.project.projectId).not.toBe(second.project.projectId);
  });

  it("T15 returns Lead clarification questions to the entry layer", async () => {
    const { entry } = fixture();
    const result = await entry.createProject({ requestText: syntheticPrompt });
    expect(result.lead.clarificationQuestions.length).toBeGreaterThan(0);
    expect(result.lead.clarificationQuestions[0]).toHaveProperty("question");
  });

  it("T16 resumes the same workflow after a clarification answer", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: syntheticPrompt });
    const question = created.lead.clarificationQuestions[0];
    const resumed = await entry.respond(created.project.projectId, [{ questionId: question.id, answer: "Synthetic answer" }]);
    expect(resumed.project.projectId).toBe(created.project.projectId);
    expect(resumed.workflowState).toBe("CLARIFYING");
  });

  it("T17 does not create a second project when clarification resumes", async () => {
    const { database, entry } = fixture();
    const created = await entry.createProject({ requestText: syntheticPrompt });
    await entry.respond(created.project.projectId, [{ questionId: created.lead.clarificationQuestions[0].id, answer: "Synthetic answer" }]);
    expect(database.projects.size).toBe(1);
  });

  it("T18 keeps Project Brief approval explicit", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: syntheticPrompt });
    const completed = await completeClarifications(entry, created.project.projectId);
    const status = await entry.status(created.project.projectId);
    expect(completed.project.projectId).toBe(created.project.projectId);
    expect(status.nextAllowedActions).toContain("APPROVE_BRIEF");
  });

  it("T19 does not treat silence as approval", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: syntheticPrompt });
    await completeClarifications(entry, created.project.projectId);
    expect((await entry.status(created.project.projectId)).workflowState).toBe("AWAITING_BRIEF_APPROVAL");
  });

  it("T20 exposes current workflow state through status", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: syntheticPrompt });
    const status = await entry.status(created.project.projectId);
    expect(status).toMatchObject({ projectId: created.project.projectId, workflowState: "CLARIFYING", projectVersion: 1 });
  });

  it("T21 status has no environment secret fields", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: syntheticPrompt });
    const serialized = JSON.stringify(await entry.status(created.project.projectId));
    expect(serialized).not.toMatch(/OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("T22 routine entry results do not dump the full request", async () => {
    const { entry } = fixture();
    const result = await entry.createProject({ requestText: syntheticPrompt });
    expect(JSON.stringify(result)).not.toContain(syntheticPrompt);
    expect(result.request).toHaveProperty("checksum");
    expect(result.request).toHaveProperty("byteSize");
  });

  it("T23 keeps the Phase 7G ContextAssembler bridge on the Lead provider path", async () => {
    const source = await readFile(path.resolve("src/integrations/openai/adapters.ts"), "utf8");
    expect(source).toContain("boundedRolePrompt as rolePrompt");
  });

  it("T24 keeps provider usage telemetry in the normal production entry composition", async () => {
    const source = await readFile(path.resolve("src/runtime/trial-entry/production.ts"), "utf8");
    expect(source).toContain("usageSink");
    expect(source).toContain("cachedInputTokens");
  });

  it("T25 does not generate source files during intake or clarification", async () => {
    const { database, entry } = fixture();
    await entry.createProject({ requestText: syntheticPrompt });
    expect([...database.documents.values()].some((document) => document.documentType === "source-manifest")).toBe(false);
    expect([...database.documents.values()].some((document) => document.documentType === "task-graph")).toBe(false);
  });

  it("T26 does not execute a TaskGraph during the initial request test", async () => {
    const { database, entry } = fixture();
    await entry.createProject({ requestText: syntheticPrompt });
    expect([...database.events].some((event) => event.toState === "IMPLEMENTING")).toBe(false);
  });

  it("T27 does not introduce a Codex provider", async () => {
    const source = await readFile(path.resolve("src/runtime/trial-entry/production.ts"), "utf8");
    expect(source).toContain("createProductionProviderBundle");
    expect(source).not.toMatch(/Codex|codex/);
  });

  it("T28 adds no database or migration authority for the entry layer", async () => {
    const source = await readFile(path.resolve("src/runtime/trial-entry/service.ts"), "utf8");
    expect(source).not.toMatch(/CREATE TABLE|migration|ALTER TABLE/i);
  });

  it("T29 retains the existing full workflow test command", async () => {
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts.test).toBe("vitest run");
    expect(packageJson.scripts["test:reviewers"]).toBeTruthy();
  });

  it("T30 uses only a synthetic request and does not generate a real customer project", async () => {
    const { database, entry } = fixture();
    const result = await entry.createProject({ requestText: syntheticPrompt });
    expect(syntheticPrompt).not.toMatch(/Haus|Halenko|Volodimir/i);
    expect(result.project.projectId).toBeTruthy();
    expect([...database.documents.values()].some((document) => document.documentType === "task-graph")).toBe(false);
  });
});
