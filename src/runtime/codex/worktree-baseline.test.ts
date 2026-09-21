import { execFile as rawExecFile } from "node:child_process";
import { link, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readGitHead } from "../../../scripts/codex/git";
import { buildSession, loadSession, saveSession, toProtectedSnapshot } from "../../../scripts/codex/protected-state";
import { preflightTaskEnvelope } from "../../../scripts/codex/task-envelope";
import { captureBaselineArtifacts, classifyRepositoryPath, normalizeRepositoryPath, repositoryPathKey } from "../../../scripts/codex/worktree-baseline";

const execFile = promisify(rawExecFile);

const projectId = "11111111-1111-4111-8111-111111111111";
const artifactPaths = [
  "supabase/.branches/_current_branch",
  "supabase/.temp/cli-latest",
  "supabase/.temp/start-secrets/supabase_edge_runtime_fixture/env/docker.env",
] as const;

const snapshot = toProtectedSnapshot({ projectId, projectVersion: 1, rowVersion: 1, workflowState: "AWAITING_PLANNING_GENERATION", pendingUserAction: "GENERATE_PLANNING", operatorLanguage: "en", siteLanguage: "en", brief: { checksum: "a".repeat(64), approved: true, readyForApproval: true } });

async function git(root: string, ...args: string[]) {
  await execFile("git", args, { cwd: root, windowsHide: true });
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "factory-codex-baseline-"));
  await writeFile(path.join(root, ".gitignore"), "/.codex/\n", "utf8");
  await writeFile(path.join(root, "README.md"), "fixture\n", "utf8");
  await git(root, "init");
  await git(root, "config", "user.email", "fixture@example.invalid");
  await git(root, "config", "user.name", "Codex Fixture");
  await git(root, "add", ".gitignore", "README.md");
  await git(root, "commit", "-m", "fixture");
  for (const relativePath of artifactPaths) {
    const filename = path.join(root, relativePath);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, relativePath.endsWith("docker.env") ? "DATABASE_URL=synthetic-secret-value\n" : "fixture\n", "utf8");
  }
  const baselineArtifacts = await captureBaselineArtifacts(root, [...artifactPaths]);
  const head = await readGitHead(root);
  const session = buildSession(head, [snapshot], "2026-09-21T00:00:00.000Z", baselineArtifacts.map((artifact) => artifact.path), [], baselineArtifacts);
  await saveSession(root, session);
  return { root, head, session };
}

function envelope(head: string) {
  return {
    mode: "REAL_LIFECYCLE" as const,
    expectedHead: head,
    protectedProjectId: projectId,
    operation: "BASELINE_RECONCILIATION_TEST",
    providerBudget: {},
    allowedSourceMutation: false,
    allowedCanonicalMutation: true,
    targetState: "TEST_ONLY",
    stopAt: ["BLOCKED"] as const,
    agentPolicy: { mode: "SINGLE" as const, maxSubagents: 0, parallelCanonicalWrites: false, singleIntegrationAuthority: true },
  };
}

async function close(root: string) {
  await rm(root, { recursive: true, force: true });
}

describe("protected worktree baseline reconciliation", () => {
  it("reproduces the old dirty-path rejection and admits unchanged Supabase runtime artifacts through the supported flow", async () => {
    const value = await fixture();
    try {
      const report = await preflightTaskEnvelope(value.root, envelope(value.head), { envelopePath: path.join(value.root, ".codex", "task-envelope.json") });
      expect(report.protectedSessionFound).toBe(true);
      expect(report.pathDiagnostics.filter((item) => item.accepted && item.category === "PROTECTED_RUNTIME_ARTIFACT")).toHaveLength(3);
      expect(value.session.baselineArtifacts).toHaveLength(3);
    } finally { await close(value.root); }
  });

  it("rejects a new arbitrary source file and tracked source modification", async () => {
    const value = await fixture();
    try {
      await mkdir(path.join(value.root, "src"), { recursive: true });
      await writeFile(path.join(value.root, "src", "new-file.ts"), "export const unsafe = true;\n", "utf8");
      await expect(preflightTaskEnvelope(value.root, envelope(value.head))).rejects.toThrow(/UNEXPECTED_SOURCE.*NEW/);
      await rm(path.join(value.root, "src"), { recursive: true, force: true });
      await writeFile(path.join(value.root, "README.md"), "changed\n", "utf8");
      await expect(preflightTaskEnvelope(value.root, envelope(value.head))).rejects.toThrow(/UNEXPECTED_SOURCE.*CHANGED/);
    } finally { await close(value.root); }
  });

  it("rejects a replaced or redirected baseline artifact", async () => {
    const value = await fixture();
    try {
      const target = path.join(value.root, artifactPaths[0]);
      await rm(target);
      await writeFile(target, "replacement\n", "utf8");
      await expect(preflightTaskEnvelope(value.root, envelope(value.head))).rejects.toThrow(/PROTECTED_RUNTIME_ARTIFACT.*REPLACED|PROTECTED_RUNTIME_ARTIFACT.*CHANGED/);

      const redirected = await fixture();
      try {
        const redirectedPath = path.join(redirected.root, artifactPaths[1]);
        await rm(redirectedPath);
        const targetPath = path.join(redirected.root, "redirect-target");
        await writeFile(targetPath, "redirected\n", "utf8");
        await link(targetPath, redirectedPath);
        await expect(preflightTaskEnvelope(redirected.root, envelope(redirected.head))).rejects.toThrow(/PROTECTED_RUNTIME_ARTIFACT.*REPLACED|PROTECTED_RUNTIME_ARTIFACT.*CHANGED/);
      } finally { await close(redirected.root); }
    } finally { await close(value.root); }
  });

  it("rejects unauthorized runtime/configuration paths, including a new runtime-shaped path", async () => {
    const value = await fixture();
    try {
      const unauthorized = path.join(value.root, "supabase", ".temp", "unauthorized.env");
      await writeFile(unauthorized, "DATABASE_URL=synthetic-secret-value\n", "utf8");
      await expect(preflightTaskEnvelope(value.root, envelope(value.head))).rejects.toThrow(/UNEXPECTED_SOURCE.*NEW/);
      await rm(unauthorized);
      const newRuntime = path.join(value.root, "supabase", ".temp", "start-secrets", "supabase_edge_runtime_new", "env", "docker.env");
      await mkdir(path.dirname(newRuntime), { recursive: true });
      await writeFile(newRuntime, "DATABASE_URL=synthetic-secret-value\n", "utf8");
      await expect(preflightTaskEnvelope(value.root, envelope(value.head))).rejects.toThrow(/PROTECTED_RUNTIME_ARTIFACT.*NEW/);
    } finally { await close(value.root); }
  });

  it("normalizes Windows separators and case without allowing traversal or prefix collisions", () => {
    expect(repositoryPathKey("SUPABASE\\.TEMP\\CLI-LATEST", "win32")).toBe("supabase/.temp/cli-latest");
    expect(classifyRepositoryPath("SUPABASE\\.TEMP\\CLI-LATEST", "win32").category).toBe("PROTECTED_RUNTIME_ARTIFACT");
    expect(() => normalizeRepositoryPath("supabase/.temp/../secret", "win32")).toThrow("CODEX_PATH_TRAVERSAL");
    expect(classifyRepositoryPath("supabase/.temp/cli-latest-copy").category).toBe("UNEXPECTED_SOURCE");
  });

  it("works in an external clean worktree and rejects legacy sessions without baseline metadata", async () => {
    const value = await fixture();
    try {
      expect(value.root.toLowerCase()).not.toBe(process.cwd().toLowerCase());
      await expect(preflightTaskEnvelope(value.root, envelope(value.head), { envelopePath: path.join(value.root, ".codex", "task-envelope.json") })).resolves.toMatchObject({ currentHead: value.head });
      await writeFile(path.join(value.root, ".codex", "session.json"), JSON.stringify({ schemaVersion: 2, baselineHead: value.head, baselineUntrackedFiles: artifactPaths, baselineFailures: [], protectedProjects: [snapshot] }), "utf8");
      await expect(loadSession(value.root)).rejects.toThrow("CODEX_SESSION_INVALID");
      await expect(preflightTaskEnvelope(value.root, envelope(value.head))).rejects.toThrow("TASK_ENVELOPE_PROTECTED_SESSION_INVALID");
    } finally { await close(value.root); }
  });

  it("never stores or reports runtime secret contents", async () => {
    const value = await fixture();
    try {
      const sessionText = await readFile(path.join(value.root, ".codex", "session.json"), "utf8");
      expect(sessionText).not.toContain("synthetic-secret-value");
      const dockerEnv = path.join(value.root, artifactPaths[2]);
      await writeFile(dockerEnv, "DATABASE_URL=another-synthetic-secret\n", "utf8");
      await expect(preflightTaskEnvelope(value.root, envelope(value.head))).rejects.toThrow(/PROTECTED_RUNTIME_ARTIFACT/);
      try { await preflightTaskEnvelope(value.root, envelope(value.head)); } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain("synthetic-secret-value");
        expect(message).not.toContain("another-synthetic-secret");
      }
    } finally { await close(value.root); }
  });
});
