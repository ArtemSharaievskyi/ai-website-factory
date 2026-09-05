import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GeneratedDatabaseCommand, GeneratedDatabaseProcessPort } from "./contracts";
import { LocalSupabaseDatabaseValidator } from "./local-supabase";

const now = "2026-01-01T00:00:00.000Z";
const result = (command: GeneratedDatabaseCommand, exitCode = 0) => ({ command, exitCode, stdoutSummary: "ok", stderrSummary: "", startedAt: now, completedAt: now });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "generated-db-root-"));
  const workspace = path.join(root, "project", "v1");
  await mkdir(path.join(workspace, "supabase", "migrations"), { recursive: true });
  await mkdir(path.join(workspace, "supabase", "tests", "database"), { recursive: true });
  await writeFile(path.join(workspace, "supabase", "config.toml"), "project_id = \"foundation-fixture\"\n");
  await writeFile(path.join(workspace, "supabase", "migrations", "20260905000000_create_fixture.sql"), "create table public.fixture_rows (id uuid primary key);\n");
  await writeFile(path.join(workspace, "supabase", "tests", "database", "001_fixture.test.sql"), "-- FACTORY_SECURITY_FIXTURE_V1 OWNER_A OWNER_B PRIVILEGED ANONYMOUS OWNER_ONLY ROLE_WIDE OWNER_OR_ROLE DENY ANONYMOUS_DENY SELF_ESCALATION_DENY app_metadata\nbegin; select plan(1); select has_table('fixture_rows'); select * from finish(); rollback;\n");
  return { root, workspace, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("generated-project local Supabase validator", () => {
  it("fails on Docker before touching Supabase or provider work", async () => {
    const f = await fixture();
    const calls: GeneratedDatabaseCommand[] = [];
    const processes: GeneratedDatabaseProcessPort = { run: async ({ command }) => { calls.push(command); return result(command, 1); } };
    try {
      const validation = await new LocalSupabaseDatabaseValidator(processes).validate({ workspacePath: f.workspace, generatedProjectsRoot: f.root });
      expect(validation).toMatchObject({ passed: false, safeFailureCode: "LOCAL_SUPABASE_RUNTIME_UNAVAILABLE" });
      expect(calls).toEqual(["docker-info"]);
    } finally { await f.cleanup(); }
  });

  it("runs the fixed local lifecycle and always stops the stack", async () => {
    const f = await fixture();
    const calls: GeneratedDatabaseCommand[] = [];
    const processes: GeneratedDatabaseProcessPort = { run: async ({ command }) => { calls.push(command); return result(command); } };
    try {
      const validation = await new LocalSupabaseDatabaseValidator(processes).validate({ workspacePath: f.workspace, generatedProjectsRoot: f.root });
      expect(validation).toMatchObject({ passed: true, migrationCount: 1, testCount: 1 });
      expect(calls).toEqual(["docker-info", "supabase-version", "supabase-start", "supabase-status", "supabase-reset", "supabase-test", "supabase-stop"]);
    } finally { await f.cleanup(); }
  });

  it("does not start a stack when migrations or tests are missing", async () => {
    const f = await fixture();
    await rm(path.join(f.workspace, "supabase", "tests"), { recursive: true, force: true });
    const calls: GeneratedDatabaseCommand[] = [];
    const processes: GeneratedDatabaseProcessPort = { run: async ({ command }) => { calls.push(command); return result(command); } };
    try {
      const validation = await new LocalSupabaseDatabaseValidator(processes).validate({ workspacePath: f.workspace, generatedProjectsRoot: f.root });
      expect(validation.safeFailureCode).toBe("GENERATED_DATABASE_TESTS_MISSING");
      expect(calls).toEqual(["docker-info", "supabase-version"]);
    } finally { await f.cleanup(); }
  });

  it("rejects workspaces outside the generated-project root", async () => {
    const f = await fixture();
    try {
      await expect(new LocalSupabaseDatabaseValidator({ run: async ({ command }) => result(command) }).validate({ workspacePath: os.tmpdir(), generatedProjectsRoot: f.root })).rejects.toThrow("GENERATED_DATABASE_WORKSPACE_SCOPE_INVALID");
    } finally { await f.cleanup(); }
  });
});
