import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readGitHead } from "../../../scripts/codex/git";
import { runGit } from "../../../scripts/codex/process";
import { parsePorcelainPaths, preflightTaskEnvelope, validateTaskEnvelope, type TaskEnvelope } from "../../../scripts/codex/task-envelope";

const projectId = "11111111-1111-4111-8111-111111111111";
const head = "a".repeat(40);
const budget = { planner: 0, architectureReview: 0, design: 0 };
const base = (overrides: Partial<TaskEnvelope> = {}): TaskEnvelope => ({
  mode: "SOURCE_REPAIR",
  expectedHead: head,
  operation: "SOURCE_REPAIR",
  providerBudget: budget,
  allowedSourceMutation: true,
  allowedCanonicalMutation: false,
  targetState: "CERTIFIED",
  stopAt: ["SOURCE_DEFECT", "PROVIDER_FAILURE"],
  subagents: 0,
  ...overrides,
});

describe("Codex task envelope", () => {
  it.each([
    ["SOURCE_REPAIR", base()],
    ["REAL_LIFECYCLE", base({ mode: "REAL_LIFECYCLE", operation: "PLANNING_REFRESH", protectedProjectId: projectId, allowedSourceMutation: false, allowedCanonicalMutation: true, providerBudget: { planner: 1 } })],
    ["READ_ONLY_AUDIT", base({ mode: "READ_ONLY_AUDIT", operation: "AUDIT", allowedSourceMutation: false, allowedCanonicalMutation: false })],
  ])("accepts a valid %s envelope", (_, envelope) => {
    expect(validateTaskEnvelope(envelope)).toEqual(envelope);
  });

  it("rejects an invalid mode", () => {
    expect(() => validateTaskEnvelope(base({ mode: "NOT_A_MODE" as TaskEnvelope["mode"] }))).toThrow("TASK_ENVELOPE_SCHEMA_INVALID");
  });

  it("rejects REAL_LIFECYCLE source mutation", () => {
    expect(() => validateTaskEnvelope(base({ mode: "REAL_LIFECYCLE", protectedProjectId: projectId, allowedSourceMutation: true, allowedCanonicalMutation: true }))).toThrow("TASK_ENVELOPE_REAL_LIFECYCLE_MUTATION_INVALID");
  });

  it("rejects provider budget in READ_ONLY_AUDIT", () => {
    expect(() => validateTaskEnvelope(base({ mode: "READ_ONLY_AUDIT", allowedSourceMutation: false, providerBudget: { planner: 1 } }))).toThrow("TASK_ENVELOPE_READ_ONLY_PROVIDER_BUDGET_FORBIDDEN");
  });

  it("requires expectedHead", () => {
    const value = { ...base() } as Record<string, unknown>;
    delete value.expectedHead;
    expect(() => validateTaskEnvelope(value)).toThrow("TASK_ENVELOPE_SCHEMA_INVALID");
  });

  it("rejects malformed provider budgets and non-zero source-repair budgets", () => {
    expect(() => validateTaskEnvelope(base({ providerBudget: { planner: "one" } as never }))).toThrow("TASK_ENVELOPE_SCHEMA_INVALID");
    expect(() => validateTaskEnvelope(base({ providerBudget: { planner: 1 } }))).toThrow("TASK_ENVELOPE_SOURCE_REPAIR_PROVIDER_BUDGET_FORBIDDEN");
    expect(() => validateTaskEnvelope(base({ providerBudget: { unknown: 0 } as never }))).toThrow("TASK_ENVELOPE_SCHEMA_INVALID");
  });

  it("parses status paths without mutating state", () => {
    expect(parsePorcelainPaths(" M src\\file.ts\n?? docs/admin/evidence.md\nR  old.md -> new.md\n")).toEqual(["src/file.ts", "docs/admin/evidence.md", "new.md"]);
  });

  it("accepts a clean read-only preflight and leaves the repository unchanged", async () => {
    const root = await mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "codex-task-envelope-test-"));
    try {
      await writeFile(path.join(root, "README.md"), "synthetic fixture\n", "utf8");
      for (const args of [["init"], ["config", "user.email", "codex@example.invalid"], ["config", "user.name", "Codex Test"], ["add", "README.md"], ["commit", "-m", "fixture"]]) {
        const result = await runGit(root, args);
        expect(result.code, args.join(" ")).toBe(0);
      }
      const currentHead = await readGitHead(root);
      const before = (await runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
      const envelope = base({ mode: "READ_ONLY_AUDIT", operation: "AUDIT", expectedHead: currentHead, allowedSourceMutation: false, allowedCanonicalMutation: false });
      const report = await preflightTaskEnvelope(root, envelope, { envelopePath: path.join(root, "task.json") });
      const after = (await runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
      expect(report.envelope.mode).toBe("READ_ONLY_AUDIT");
      expect(after).toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the example and procedural skills free of current pilot state", async () => {
    const example = await readFile(path.join(process.cwd(), "config/codex/task-envelope.example.json"), "utf8");
    const schema = JSON.parse(await readFile(path.join(process.cwd(), "config/codex/task-envelope.schema.json"), "utf8")) as { required: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(["mode", "expectedHead", "providerBudget", "stopAt"]));
    expect(validateTaskEnvelope(JSON.parse(example))).toMatchObject({ mode: "REAL_LIFECYCLE", operation: "PLANNING_REFRESH" });
    expect(example).toContain("00000000-0000-4000-8000-000000000000");
    expect(example).not.toMatch(/[0-9a-f]{64}/i);
    const skillDirectories = await readdir(path.join(process.cwd(), ".agents/skills"), { withFileTypes: true });
    for (const directory of skillDirectories.filter((entry) => entry.isDirectory())) {
      const skillPath = path.join(process.cwd(), ".agents/skills", directory.name, "SKILL.md");
      const content = await readFile(skillPath, "utf8");
      expect(content).not.toMatch(/[0-9a-f]{64}/i);
      expect(content).not.toMatch(/protectedProjectId|expectedHead/);
    }
  });

  it("does not introduce current-state Markdown and keeps authority guidance singular", async () => {
    const docs = await readdir(path.join(process.cwd(), "docs"), { recursive: true });
    const forbidden = new Set(["CURRENT_STATE.md", "PILOT_STATUS.md", "CHECKSUMS.md"]);
    expect(docs.some((entry) => forbidden.has(String(entry).split(/[\\/]/).at(-1)!))).toBe(false);
    const lifecycle = await readFile(path.join(process.cwd(), "docs/codex/LIFECYCLE_AUTHORITY.md"), "utf8");
    const architecture = await readFile(path.join(process.cwd(), "docs/codex/ARCHITECTURE.md"), "utf8");
    expect(lifecycle).toContain("not a second runtime authority");
    expect(architecture).toContain("LIFECYCLE_AUTHORITY.md");
  });

  it("keeps root AGENTS guidance bounded", async () => {
    const lines = (await readFile(path.join(process.cwd(), "AGENTS.md"), "utf8")).split(/\r?\n/).length;
    expect(lines).toBeLessThan(155);
  });
});
