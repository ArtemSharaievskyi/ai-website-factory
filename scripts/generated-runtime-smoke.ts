import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadFactoryCliEnv } from "./cli-env";
import { GeneratedRuntimeValidator } from "../src/runtime/validation";

loadFactoryCliEnv();

async function main() {
  if (process.env.ALLOW_GENERATED_RUNTIME_SMOKE !== "true") {
    console.log(JSON.stringify({ status: "not-run", releaseEligible: false, reason: "Explicit generated-runtime smoke opt-in is required.", evidence: "incomplete" }));
    process.exitCode = 1;
  } else {
    const root = await mkdtemp(path.join(os.tmpdir(), "generated-runtime-smoke-"));
    const workspace = path.join(root, "fixture", "1");
    await mkdir(workspace, { recursive: true });
    const script = 'node -e "process.exit(0)"';
    await writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "generated-runtime-smoke", version: "1.0.0", scripts: { lint: script, typecheck: script, test: script, build: script } }));
    await writeFile(path.join(workspace, "package-lock.json"), JSON.stringify({ name: "generated-runtime-smoke", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "generated-runtime-smoke", version: "1.0.0" } } }));
    try {
      const report = await new GeneratedRuntimeValidator().runValidationSequence({ projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 1, workspacePath: workspace, generatedProjectsRoot: root, mutable: true });
      console.log(JSON.stringify({ status: report.overallStatus === "passed" ? "passed" : "failed", releaseEligible: false, overallStatus: report.overallStatus, validationRunId: report.validationRunId, projectId: report.projectId, projectVersion: report.projectVersion, workspaceReference: report.workspaceReference, packageChecksum: report.packageChecksum, lockfileChecksum: report.lockfileChecksum, commandResults: report.commandResults.map((result) => ({ commandType: result.commandType, passed: result.passed, exitCode: result.exitCode })), qualityChecks: report.qualityChecks.map((check) => ({ name: check.name, status: check.status })), commandCount: report.commandResults.length, policyVersion: report.policyVersion, releaseEvidence: report.overallStatus === "passed" ? "executed-runtime-validation" : "incomplete" }));
      if (report.overallStatus !== "passed") process.exitCode = 1;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

void main();
