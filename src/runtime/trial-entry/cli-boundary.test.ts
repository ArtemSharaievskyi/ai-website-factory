import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { LeadAgentService } from "@/agents/lead/service";
import { DeterministicLeadProvider } from "@/agents/lead/ports";
import { analyzePromptDeterministically, assembleRequirements, planClarificationsDeterministically } from "@/agents/lead/deterministic";
import { TrialEntryService } from "./service";
import { parseStatusArgs, renderStatus } from "./cli";

const root = path.resolve(__dirname, "../../..");
const read = (file: string) => readFile(path.join(root, file), "utf8");
const projectId = "11111111-1111-4111-8111-111111111111";
const prompt = "Create a synthetic local test business website.";

function fixture() {
  const database = new InMemoryPersistenceDatabase();
  const provider = new DeterministicLeadProvider(
    analyzePromptDeterministically,
    planClarificationsDeterministically,
    assembleRequirements,
  );
  const entry = new TrialEntryService({
    database,
    createLeadAgent: () => new LeadAgentService({ database, memory: new FakeLeadMemoryPort(), provider }),
  });
  return { database, entry };
}

describe("CLI1-CLI24 standalone Trial Entry boundary matrix", () => {
  it("CLI1: status does not import the Next server adapter", async () => {
    const source = await read("scripts/factory-status.ts");
    expect(source).toContain("trial-entry/node");
    expect(source).not.toContain("trial-entry/production");
  });

  it("CLI2: the Workbench server composition retains server-only", async () => {
    expect(await read("src/runtime/workbench/production.ts")).toContain('import "server-only"');
  });

  it("CLI3: factory:new uses Node-safe composition", async () => {
    expect(await read("scripts/factory-new.ts")).toContain("trial-entry/node");
  });

  it("CLI4: factory:respond uses Node-safe composition", async () => {
    expect(await read("scripts/factory-respond.ts")).toContain("trial-entry/node");
  });

  it("CLI5: factory:status uses Node-safe composition", async () => {
    expect(await read("scripts/factory-status.ts")).toContain("trial-entry/node");
  });

  it("CLI6: all commands reuse TrialEntryService", async () => {
    const node = await read("src/runtime/trial-entry/node.ts");
    for (const file of ["scripts/factory-new.ts", "scripts/factory-respond.ts", "scripts/factory-status.ts"]) {
      expect(await read(file)).toContain("createNodeTrialEntryRuntime");
    }
    expect(node).toContain("new TrialEntryService");
  });

  it("CLI7: TrialEntryService has one implementation", async () => {
    const service = await read("src/runtime/trial-entry/service.ts");
    expect((service.match(/export class TrialEntryService/g) ?? []).length).toBe(1);
    expect(await read("src/runtime/trial-entry/node.ts")).not.toContain("class TrialEntryService");
  });

  it("CLI8: workflow state calculation remains in the canonical service", async () => {
    expect(await read("src/runtime/trial-entry/service.ts")).toContain("actionForState");
    expect(await read("src/runtime/trial-entry/node.ts")).not.toContain("actionForState");
  });

  it("CLI9: persistence remains injected and canonical", async () => {
    const node = await read("src/runtime/trial-entry/node.ts");
    expect(node).toContain("PostgresPersistenceDatabase");
    expect(node).not.toMatch(/CREATE TABLE|ALTER TABLE|migration/i);
  });

  it("CLI10: every command uses the canonical CLI environment bootstrap", async () => {
    expect(await read("scripts/cli-env.ts")).toContain("loadEnvConfig");
    for (const file of ["scripts/factory-new.ts", "scripts/factory-respond.ts", "scripts/factory-status.ts"]) {
      expect(await read(file)).toContain("loadFactoryCliEnv");
    }
  });

  it("CLI11: the Node composition does not log provider secrets", async () => {
    const source = await read("src/runtime/trial-entry/node.ts");
    expect(source).not.toMatch(/console\.(log|error).*process\.env/);
    expect(source).not.toMatch(/OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("CLI12: status is composed without an AI provider", async () => {
    const source = await read("scripts/factory-status.ts");
    expect(source).toContain("requireAi: false");
    expect(source).not.toContain("createProject");
    expect(source).not.toContain("respond(");
  });

  it("CLI13: malformed project IDs reject at the CLI boundary", () => {
    expect(() => parseStatusArgs(["--project", "not-a-uuid"])).toThrow("TRIAL_ENTRY_PROJECT_INVALID");
  });

  it("CLI14: unknown UUIDs reject through the canonical service", async () => {
    const { entry } = fixture();
    expect(() => parseStatusArgs(["--project", projectId])).not.toThrow();
    await expect(entry.status(projectId)).rejects.toThrow("TRIAL_ENTRY_PROJECT_NOT_FOUND");
  });

  it("CLI15: a known synthetic project returns status", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: prompt });
    await expect(entry.status(created.project.projectId)).resolves.toMatchObject({
      projectId: created.project.projectId,
      workflowState: "CLARIFYING",
    });
  });

  it("CLI16: JSON mode is machine-readable", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: prompt });
    const status = await entry.status(created.project.projectId);
    expect(JSON.parse(JSON.stringify(status))).toMatchObject({ projectId: created.project.projectId });
  });

  it("CLI17: human mode is concise and readable", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: prompt });
    const rendered = renderStatus(await entry.status(created.project.projectId));
    expect(rendered).toContain("Current stage: CLARIFYING");
    expect(rendered).not.toContain(prompt);
  });

  it("CLI18: status excludes raw prompts and secret fields", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: prompt });
    const serialized = JSON.stringify(await entry.status(created.project.projectId));
    expect(serialized).not.toContain(prompt);
    expect(serialized).not.toMatch(/OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("CLI19: synthetic respond resumes the same project", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: prompt });
    const question = created.lead.clarificationQuestions[0];
    const resumed = await entry.respond(created.project.projectId, [{ questionId: question.id, answer: "Synthetic answer" }]);
    expect(resumed.project.projectId).toBe(created.project.projectId);
  });

  it("CLI20: a stale synthetic question ID is rejected", async () => {
    const { entry } = fixture();
    const created = await entry.createProject({ requestText: prompt });
    await expect(entry.respond(created.project.projectId, [{ questionId: "22222222-2222-4222-8222-222222222222", answer: "stale" }])).rejects.toThrow("TRIAL_ENTRY_QUESTION_NOT_FOUND");
  });

  it("CLI21: synthetic respond does not create a second project", async () => {
    const { database, entry } = fixture();
    const created = await entry.createProject({ requestText: prompt });
    await entry.respond(created.project.projectId, [{ questionId: created.lead.clarificationQuestions[0].id, answer: "Synthetic answer" }]);
    expect(database.projects.size).toBe(1);
  });

  it("CLI22: synthetic new uses the canonical entry authority", async () => {
    const { database, entry } = fixture();
    const created = await entry.createProject({ requestText: prompt });
    expect(database.projects.has(created.project.projectId)).toBe(true);
    expect(created.workflowState).toBe("CLARIFYING");
  });

  it("CLI23: the existing Workbench focused test remains present", async () => {
    const source = await read("src/runtime/workbench/workbench.test.ts");
    expect(source).toContain("WorkbenchApplication");
  });

  it("CLI24: synthetic boundary fixtures start without customer projects", () => {
    const { database } = fixture();
    expect(database.projects.size).toBe(0);
  });
});
