import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { readDirectory, readDirectoryTree } from "@/runtime/filesystem/directory";
import path from "node:path";
import {
  LOCAL_SUPABASE_RUNTIME_POLICY_VERSION,
  type GeneratedDatabaseCommand,
  type GeneratedDatabaseProcessPort,
  type GeneratedDatabaseProcessResult,
  type GeneratedDatabaseValidationResult,
  type GeneratedDatabaseValidatorPort,
} from "./contracts";
import { isBehavioralSecurityFixture } from "./security-fixtures";

const MAX_OUTPUT_BYTES = 16_000;
const SUMMARY_BYTES = 2_000;
const COMMAND_TIMEOUT_MS = 180_000;
const forbiddenSql = /\b(?:drop\s+(?:database|schema)|alter\s+system|copy\s+.*\bprogram\b|disable\s+row\s+level\s+security|grant\s+all)\b/i;

const bounded = (value: string) => value.replaceAll(/\s+/g, " ").trim().slice(0, SUMMARY_BYTES);

function assertWorkspace(workspacePath: string, generatedProjectsRoot: string) {
  const workspace = path.resolve(workspacePath);
  const root = path.resolve(generatedProjectsRoot);
  const relative = path.relative(root, workspace);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("GENERATED_DATABASE_WORKSPACE_SCOPE_INVALID");
  return workspace;
}

const commandSpec = (command: GeneratedDatabaseCommand, factoryRoot: string) => {
  if (command === "docker-info") return { executable: "docker", args: ["info", "--format", "{{json .ServerVersion}}"] };
  const cli = path.join(factoryRoot, "node_modules", "supabase", "dist", "supabase.js");
  const args: Record<Exclude<GeneratedDatabaseCommand, "docker-info">, string[]> = {
    "supabase-version": [cli, "--version"],
    "supabase-init": [cli, "init", "--force"],
    "supabase-start": [cli, "start"],
    "supabase-status": [cli, "status", "--output", "json"],
    "supabase-reset": [cli, "db", "reset", "--local"],
    "supabase-test": [cli, "test", "db"],
    "supabase-stop": [cli, "stop", "--no-backup"],
  };
  return { executable: process.execPath, args: args[command] };
};

export class NodeGeneratedDatabaseProcessRunner implements GeneratedDatabaseProcessPort {
  constructor(private readonly factoryRoot = process.cwd()) {}

  async run(input: { command: GeneratedDatabaseCommand; workspacePath: string; signal?: AbortSignal }): Promise<GeneratedDatabaseProcessResult> {
    const startedAt = new Date().toISOString();
    const spec = commandSpec(input.command, this.factoryRoot);
    return new Promise((resolve) => {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: process.env.NODE_ENV ?? "test",
        PATH: process.env.PATH,
        Path: process.env.Path,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
        SUPABASE_TELEMETRY_DISABLED: "1",
      };
      const child = spawn(spec.executable, spec.args, {
        cwd: input.workspacePath,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        signal: input.signal,
        env,
      });
      let stdout = "";
      let stderr = "";
      const append = (current: string, chunk: Buffer) => `${current}${chunk.toString("utf8")}`.slice(-MAX_OUTPUT_BYTES);
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const timer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS);
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ command: input.command, exitCode: null, stdoutSummary: bounded(stdout), stderrSummary: bounded(error.message), startedAt, completedAt: new Date().toISOString() });
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ command: input.command, exitCode, stdoutSummary: bounded(stdout), stderrSummary: bounded(stderr), startedAt, completedAt: new Date().toISOString() });
      });
    });
  }
}

export class LocalSupabaseDatabaseValidator implements GeneratedDatabaseValidatorPort {
  constructor(private readonly processes: GeneratedDatabaseProcessPort = new NodeGeneratedDatabaseProcessRunner()) {}

  async validate(input: { workspacePath: string; generatedProjectsRoot: string; signal?: AbortSignal }): Promise<GeneratedDatabaseValidationResult> {
    const startedAt = new Date().toISOString();
    const workspacePath = assertWorkspace(input.workspacePath, input.generatedProjectsRoot);
    const commands: GeneratedDatabaseProcessResult[] = [];
    const finish = (status: GeneratedDatabaseValidationResult["status"], summary: string, safeFailureCode?: GeneratedDatabaseValidationResult["safeFailureCode"], migrationCount = 0, testCount = 0): GeneratedDatabaseValidationResult => ({
      passed: status === "BEHAVIORAL_VALIDATION_PASSED",
      status,
      staticValidation: status === "STATIC_VALIDATION_FAILED" ? "FAILED" : "PASSED",
      behavioralValidation: status === "BEHAVIORAL_VALIDATION_PASSED" ? "PASSED" : status === "BEHAVIORAL_VALIDATION_FAILED" ? "FAILED" : status === "BEHAVIORAL_VALIDATION_RUNTIME_UNAVAILABLE" ? "RUNTIME_UNAVAILABLE" : "NOT_RUN",
      ...(safeFailureCode ? { safeFailureCode } : {}),
      summary: `${summary};policy=${LOCAL_SUPABASE_RUNTIME_POLICY_VERSION}`,
      startedAt,
      completedAt: new Date().toISOString(),
      commands,
      migrationCount,
      testCount,
    });
    const run = async (command: GeneratedDatabaseCommand) => {
      const result = await this.processes.run({ command, workspacePath, signal: input.signal });
      commands.push(result);
      return result;
    };

    try { await access(path.join(workspacePath, "supabase", "config.toml")); }
    catch { return finish("STATIC_VALIDATION_FAILED", "Generated Supabase configuration is missing.", "GENERATED_DATABASE_NOT_INITIALIZED"); }
    const migrationsPath = path.join(workspacePath, "supabase", "migrations");
    const testsPath = path.join(workspacePath, "supabase", "tests");
    const migrations = (await readDirectory(migrationsPath).catch(() => [])).map((entry) => entry.name).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
    const tests = (await readDirectoryTree(testsPath).catch(() => [])).filter((name) => /\.sql$/.test(name));
    if (!migrations.length) return finish("STATIC_VALIDATION_FAILED", "No ordered generated migration is available.", "GENERATED_DATABASE_MIGRATION_INVALID");
    for (const migration of migrations) if (forbiddenSql.test(await readFile(path.join(migrationsPath, migration), "utf8"))) return finish("STATIC_VALIDATION_FAILED", "A generated migration violates the local database safety policy.", "GENERATED_DATABASE_MIGRATION_INVALID", migrations.length, tests.length);
    if (!tests.length) return finish("STATIC_VALIDATION_FAILED", "Generated database tests are required.", "GENERATED_DATABASE_TESTS_MISSING", migrations.length, tests.length);
    const behavioralTests = await Promise.all(tests.map(async (name) => readFile(path.join(testsPath, name), "utf8").catch(() => "")));
    if (!behavioralTests.some(isBehavioralSecurityFixture)) return finish("STATIC_VALIDATION_FAILED", "Generated behavioral access-control security tests are required.", "GENERATED_DATABASE_TESTS_MISSING", migrations.length, tests.length);
    const docker = await run("docker-info");
    if (docker.exitCode !== 0) return finish("BEHAVIORAL_VALIDATION_RUNTIME_UNAVAILABLE", "Docker-compatible local runtime is unavailable after static database and behavioral-security discovery.", "LOCAL_SUPABASE_RUNTIME_UNAVAILABLE", migrations.length, tests.length);
    const cli = await run("supabase-version");
    if (cli.exitCode !== 0) return finish("BEHAVIORAL_VALIDATION_RUNTIME_UNAVAILABLE", "The pinned project-local Supabase CLI is unavailable.", "LOCAL_SUPABASE_CLI_UNAVAILABLE", migrations.length, tests.length);
    let started = false;
    try {
      const start = await run("supabase-start");
      if (start.exitCode !== 0) return finish("BEHAVIORAL_VALIDATION_RUNTIME_UNAVAILABLE", "Local Supabase failed to start.", "LOCAL_SUPABASE_RUNTIME_UNAVAILABLE", migrations.length, tests.length);
      started = true;
      for (const command of ["supabase-status", "supabase-reset", "supabase-test"] as const) {
        const result = await run(command);
        if (result.exitCode !== 0) return finish("BEHAVIORAL_VALIDATION_FAILED", `Generated database command ${command} failed.`, "GENERATED_DATABASE_VALIDATION_FAILED", migrations.length, tests.length);
      }
      return finish("BEHAVIORAL_VALIDATION_PASSED", "Local migrations and database tests passed.", undefined, migrations.length, tests.length);
    } finally {
      if (started) await run("supabase-stop");
    }
  }
}
