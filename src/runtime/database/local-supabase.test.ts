import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GeneratedDatabaseCommand, GeneratedDatabaseProcessPort } from "./contracts";
import { LocalSupabaseDatabaseValidator } from "./local-supabase";
import { renderBehavioralSecurityFixture } from "./security-fixtures";

const now = "2026-01-01T00:00:00.000Z";
const result = (command: GeneratedDatabaseCommand, exitCode = 0) => ({ command, exitCode, stdoutSummary: "ok", stderrSummary: "", startedAt: now, completedAt: now });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "generated-db-root-"));
  const workspace = path.join(root, "project", "v1");
  await mkdir(path.join(workspace, "supabase", "migrations"), { recursive: true });
  await mkdir(path.join(workspace, "supabase", "tests", "database"), { recursive: true });
  await writeFile(path.join(workspace, "supabase", "config.toml"), "project_id = \"foundation-fixture\"\n");
  await writeFile(path.join(workspace, "supabase", "migrations", "20260905000000_create_fixture.sql"), "create table public.fixture_rows (id uuid primary key);\n");
  await writeFile(path.join(workspace, "supabase", "tests", "database", "001_fixture.test.sql"), renderBehavioralSecurityFixture({ table: "fixture_rows", ownerColumn: "id", role: "privileged", scope: "OWNER", roleAuthority: "JWT_APP_METADATA" }));
  return { root, workspace, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("generated-project local Supabase validator", () => {
  it("reports runtime unavailability only after static security discovery", async () => {
    const f = await fixture();
    const calls: GeneratedDatabaseCommand[] = [];
    const processes: GeneratedDatabaseProcessPort = { run: async ({ command }) => { calls.push(command); return result(command, 1); } };
    try {
      const validation = await new LocalSupabaseDatabaseValidator(processes).validate({ workspacePath: f.workspace, generatedProjectsRoot: f.root });
      expect(validation).toMatchObject({ passed: false, status: "BEHAVIORAL_VALIDATION_RUNTIME_UNAVAILABLE", staticValidation: "PASSED", behavioralValidation: "RUNTIME_UNAVAILABLE", safeFailureCode: "LOCAL_SUPABASE_RUNTIME_UNAVAILABLE" });
      expect(calls).toEqual(["docker-info"]);
    } finally { await f.cleanup(); }
  });

  it("runs the fixed local lifecycle and always stops the stack", async () => {
    const f = await fixture();
    const calls: GeneratedDatabaseCommand[] = [];
    const processes: GeneratedDatabaseProcessPort = { run: async ({ command }) => { calls.push(command); return result(command); } };
    try {
      const validation = await new LocalSupabaseDatabaseValidator(processes).validate({ workspacePath: f.workspace, generatedProjectsRoot: f.root });
      expect(validation).toMatchObject({ passed: true, status: "BEHAVIORAL_VALIDATION_PASSED", staticValidation: "PASSED", behavioralValidation: "PASSED", migrationCount: 1, testCount: 1 });
      expect(calls).toEqual(["docker-info", "supabase-version", "supabase-start", "supabase-status", "supabase-reset", "supabase-test", "supabase-stop"]);
    } finally { await f.cleanup(); }
  });

  it("classifies an available runtime with failing pgTAP as behavioral failure", async () => {
    const f = await fixture();
    const calls: GeneratedDatabaseCommand[] = [];
    const processes: GeneratedDatabaseProcessPort = { run: async ({ command }) => { calls.push(command); return result(command, command === "supabase-test" ? 1 : 0); } };
    try {
      const validation = await new LocalSupabaseDatabaseValidator(processes).validate({ workspacePath: f.workspace, generatedProjectsRoot: f.root });
      expect(validation).toMatchObject({ passed: false, status: "BEHAVIORAL_VALIDATION_FAILED", staticValidation: "PASSED", behavioralValidation: "FAILED", safeFailureCode: "GENERATED_DATABASE_VALIDATION_FAILED" });
      expect(calls.at(-1)).toBe("supabase-stop");
    } finally { await f.cleanup(); }
  });

  it("does not start a stack when migrations or tests are missing", async () => {
    const f = await fixture();
    await rm(path.join(f.workspace, "supabase", "tests"), { recursive: true, force: true });
    const calls: GeneratedDatabaseCommand[] = [];
    const processes: GeneratedDatabaseProcessPort = { run: async ({ command }) => { calls.push(command); return result(command); } };
    try {
      const validation = await new LocalSupabaseDatabaseValidator(processes).validate({ workspacePath: f.workspace, generatedProjectsRoot: f.root });
      expect(validation).toMatchObject({ status: "STATIC_VALIDATION_FAILED", staticValidation: "FAILED", behavioralValidation: "NOT_RUN", safeFailureCode: "GENERATED_DATABASE_TESTS_MISSING" });
      expect(calls).toEqual([]);
    } finally { await f.cleanup(); }
  });

  it("rejects workspaces outside the generated-project root", async () => {
    const f = await fixture();
    try {
      await expect(new LocalSupabaseDatabaseValidator({ run: async ({ command }) => result(command) }).validate({ workspacePath: os.tmpdir(), generatedProjectsRoot: f.root })).rejects.toThrow("GENERATED_DATABASE_WORKSPACE_SCOPE_INVALID");
    } finally { await f.cleanup(); }
  });
});
