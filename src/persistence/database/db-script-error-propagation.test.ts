import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

function runDatabaseScript(script: string, withMigrations = false, databaseUrl?: string) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "factory-db-error-test-"));
  if (withMigrations) mkdirSync(path.join(workspace, "supabase", "migrations"), { recursive: true });
  try {
    const isTypeScript = script.endsWith(".ts");
    const result = spawnSync(
      process.execPath,
      isTypeScript ? [tsxCli, path.join(root, script)] : [path.join(root, script)],
      {
        cwd: workspace,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json"),
        },
      },
    );
    return { ...result, stderr: result.stderr.trim(), stdout: result.stdout.trim() };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe("database script error propagation", () => {
  it.each([
    ["scripts/db-status.mjs", false],
    ["scripts/db-migrate.mjs", true],
    ["scripts/db-verify.mjs", false],
    ["scripts/db-smoke.ts", false],
  ])("returns a safe configuration failure for %s", (script, withMigrations) => {
    const result = runDatabaseScript(script, withMigrations);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("DATABASE_CONFIGURATION_MISSING");
    expect(result.stderr).not.toContain("db-common.mjs:18");
    expect(result.stderr).not.toContain("Node.js");
  });

  it("normalizes a malformed pool URL without exposing a raw constructor error", () => {
    const result = runDatabaseScript("scripts/db-smoke.ts", false, "not-a-database-url");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("DATABASE_CONNECTION_FAILED");
    expect(result.stderr).not.toContain("TypeError");
    expect(result.stderr).not.toContain("Node.js");
  });
});
