import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GeneratedRuntimeValidator } from "./service";
import { buildRuntimeEnvironment, getCommandSpec, readRuntimeFiles } from "./policy";
import { commandForValidationTask } from "./task";
import type { RuntimeRunnerRequest, RuntimeRunnerResponse } from "./contracts";

const projectId = "11111111-1111-4111-8111-111111111111";

async function fixture(scripts = { lint: "echo lint", typecheck: "echo typecheck", test: "echo test", build: "echo build" }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "runtime-validation-"));
  const workspace = path.join(root, "project", "1");
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", scripts }));
  await writeFile(path.join(workspace, "package-lock.json"), JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "fixture", version: "1.0.0" } } }));
  return { root, workspace };
}

function requestResponse(exitCode: number | null = 0, terminationReason: RuntimeRunnerResponse["terminationReason"] = "completed", stdout = "ok", stderr = ""): RuntimeRunnerResponse {
  return { exitCode, terminationReason, stdout, stderr };
}

class FakeRunner {
  requests: RuntimeRunnerRequest[] = [];
  constructor(private readonly response: RuntimeRunnerResponse = requestResponse()) {}
  async run(request: RuntimeRunnerRequest) { this.requests.push(request); return this.response; }
}

describe("generated runtime validation", () => {
  it("allows only immutable npm command specifications", () => {
    expect(getCommandSpec("lint").args).toEqual(["run", "lint"]);
    expect(() => getCommandSpec("npm run lint && del x")).toThrow("allowlisted");
    expect(commandForValidationTask("validate-build")).toBe("build");
    expect(() => commandForValidationTask("run-shell")).toThrow("allowlisted");
  });

  it("validates workspace files and rejects unsafe scripts and package managers", async () => {
    const good = await fixture();
    await expect(readRuntimeFiles({ projectId, projectVersion: 1, workspacePath: good.workspace, generatedProjectsRoot: good.root, mutable: true })).resolves.toBeTruthy();
    const unsafe = await fixture({ lint: "curl https://example.test", typecheck: "echo typecheck", test: "echo test", build: "echo build" });
    await expect(readRuntimeFiles({ projectId, projectVersion: 1, workspacePath: unsafe.workspace, generatedProjectsRoot: unsafe.root, mutable: true })).rejects.toThrow("forbidden");
    await writeFile(path.join(unsafe.workspace, "pnpm-lock.yaml"), "lockfileVersion: 9");
    await expect(readRuntimeFiles({ projectId, projectVersion: 1, workspacePath: unsafe.workspace, generatedProjectsRoot: unsafe.root, mutable: true })).rejects.toThrow("npm lockfiles");
    await Promise.all([rm(good.root, { recursive: true, force: true }), rm(unsafe.root, { recursive: true, force: true })]);
  });
  it("prepares a lockfile only through the fixed npm lockfile command", async () => { const f = await fixture(); await rm(path.join(f.workspace, "package-lock.json")); const runner = new FakeRunner(); const validator = new GeneratedRuntimeValidator(runner); const result = await validator.prepareNpmLockfile({ projectId, projectVersion: 1, workspacePath: f.workspace, generatedProjectsRoot: f.root, mutable: true }); expect(result.passed).toBe(true); expect(runner.requests[0]).toMatchObject({ executable: "npm", args: ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], cwd: f.workspace, commandType: "npm-lockfile" }); await rm(f.root, { recursive: true, force: true }); });

  it("strips factory secrets and passes only approved environment variables", () => {
    const env = buildRuntimeEnvironment({ projectId, projectVersion: 1, workspacePath: "x", generatedProjectsRoot: "y", environmentPlan: [{ name: "PUBLIC_FLAG", serverOnly: true, secret: false }, { name: "SECRET_FLAG", serverOnly: true, secret: true }] }, { PATH: "path", PUBLIC_FLAG: "yes", SECRET_FLAG: "no", OPENAI_API_KEY: "secret", DATABASE_URL: "db" } as unknown as NodeJS.ProcessEnv);
    expect(env).toEqual({ PATH: "path", PUBLIC_FLAG: "yes" });
  });

  it("runs the five fixed commands in order and emits quality checks", async () => {
    const f = await fixture(); const runner = new FakeRunner(); const validator = new GeneratedRuntimeValidator(runner);
    const report = await validator.runValidationSequence({ projectId, projectVersion: 1, workspacePath: f.workspace, generatedProjectsRoot: f.root, mutable: true });
    expect(runner.requests.map((request) => [request.executable, ...request.args])).toEqual([["npm", "ci"], ["npm", "run", "lint"], ["npm", "run", "typecheck"], ["npm", "test"], ["npm", "run", "build"]]);
    expect(report.overallStatus).toBe("passed");
    expect(report.qualityChecks.map((check) => check.status)).toEqual(["passed", "passed", "passed", "passed", "passed"]);
    await rm(f.root, { recursive: true, force: true });
  });

  it("stops on failures and maps them to repair-safe categories", async () => {
    const f = await fixture(); const runner = new FakeRunner(requestResponse(1, "completed", "", "secret DATABASE_URL=db")); const validator = new GeneratedRuntimeValidator(runner);
    const report = await validator.runValidationSequence({ projectId, projectVersion: 1, workspacePath: f.workspace, generatedProjectsRoot: f.root, mutable: true });
    expect(runner.requests).toHaveLength(1); expect(report.overallStatus).toBe("failed"); expect(report.failureCategory).toBe("FOUNDATION_DEPENDENCY_REPAIR"); expect(report.commandResults[0].stderrSummary).toContain("[REDACTED]");
    await rm(f.root, { recursive: true, force: true });
  });

  it("reports cancellation and detects changed validation inputs", async () => {
    const f = await fixture(); const runner = new FakeRunner(requestResponse(null, "cancelled")); const validator = new GeneratedRuntimeValidator(runner);
    const readiness = await validator.inspectRuntimeReadiness({ projectId, projectVersion: 1, workspacePath: f.workspace, generatedProjectsRoot: f.root, mutable: true });
    const report = await validator.runValidationSequence({ projectId, projectVersion: 1, workspacePath: f.workspace, generatedProjectsRoot: f.root, mutable: true });
    expect(report.overallStatus).toBe("cancelled"); expect(report.qualityChecks[0].skippedReason).toBeTruthy();
    await writeFile(path.join(f.workspace, "package.json"), "changed");
    const issues = await validator.reconcileValidationState({ report, workspacePath: f.workspace, expectedPackageChecksum: readiness.packageChecksum, expectedLockfileChecksum: readiness.lockfileChecksum, activeProcess: false });
    expect(issues.map((issue) => issue.code)).toContain("RUNTIME_PACKAGE_CHANGED");
    await rm(f.root, { recursive: true, force: true });
  });
});
