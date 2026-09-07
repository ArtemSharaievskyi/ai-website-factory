import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LocalSupabaseDatabaseValidator, NodeGeneratedDatabaseProcessRunner, renderBehavioralSecurityFixture } from "../src/runtime/database";

export function renderFoundationRequestsSecurityFixture() {
  return renderBehavioralSecurityFixture({ table: "foundation_requests", ownerColumn: "user_id", role: "privileged", scope: "OWNER", roleAuthority: "JWT_APP_METADATA" });
}

async function main() {
  const generatedProjectsRoot = path.resolve(process.cwd(), ".factory-generated-debug");
  const workspacePath = path.join(generatedProjectsRoot, `foundation-${randomUUID()}`);
  const processes = new NodeGeneratedDatabaseProcessRunner(process.cwd());
  await mkdir(workspacePath, { recursive: true });
  try {
    // Keep the smoke aligned with the generated-project runtime admission
    // boundary.  A missing container runtime must stop before the CLI creates
    // project state (and, consequently, before any downstream work could be
    // scheduled).
    const docker = await processes.run({ command: "docker-info", workspacePath });
    if (docker.exitCode !== 0)
      throw new Error("LOCAL_SUPABASE_RUNTIME_UNAVAILABLE");
    const initialized = await processes.run({ command: "supabase-init", workspacePath });
    if (initialized.exitCode !== 0) throw new Error(`LOCAL_SUPABASE_INIT_FAILED:${initialized.stderrSummary}`);
    await mkdir(path.join(workspacePath, "supabase", "migrations"), { recursive: true });
    await mkdir(path.join(workspacePath, "supabase", "tests", "database"), { recursive: true });
    await writeFile(path.join(workspacePath, "supabase", "migrations", "20260905000000_create_foundation_requests.sql"), `
create table public.foundation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  status text not null default 'submitted' check (status in ('submitted', 'in_progress', 'resolved'))
);
alter table public.foundation_requests enable row level security;
create policy foundation_requests_select on public.foundation_requests for select to authenticated using (auth.uid() = user_id);
create policy foundation_requests_insert on public.foundation_requests for insert to authenticated with check (auth.uid() = user_id);
create policy foundation_requests_update on public.foundation_requests for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy foundation_requests_delete on public.foundation_requests for delete to authenticated using (auth.uid() = user_id);
`, "utf8");
    await writeFile(path.join(workspacePath, "supabase", "tests", "database", "001_foundation_requests.test.sql"), renderFoundationRequestsSecurityFixture(), "utf8");
    const result = await new LocalSupabaseDatabaseValidator(processes).validate({ workspacePath, generatedProjectsRoot });
    if (!result.passed) {
      const failedCommand = result.commands.find((command) => command.exitCode !== 0);
      throw new Error(`${result.safeFailureCode ?? "GENERATED_DATABASE_VALIDATION_FAILED"}:${result.summary};command=${failedCommand?.command ?? "none"};exitCode=${failedCommand?.exitCode ?? "none"};diagnostic=${failedCommand?.stderrSummary ?? "none"}`);
    }
    process.stdout.write(`${JSON.stringify({ passed: result.passed, policyVersion: "local-supabase-runtime-v1", migrationCount: result.migrationCount, testCount: result.testCount, commands: result.commands.map((command) => ({ command: command.command, exitCode: command.exitCode })), workspaceRemoved: true })}\n`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "LOCAL_SUPABASE_SMOKE_FAILED"}\n`); process.exitCode = 1; });
