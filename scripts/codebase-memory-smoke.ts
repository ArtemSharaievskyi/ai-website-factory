import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadFactoryCliEnv } from "./cli-env";
import { readCodebaseMemoryConfig } from "../src/integrations/codebase-memory/config";
import { CodebaseMemoryError } from "../src/integrations/codebase-memory/errors";
import { CodebaseMemoryService } from "../src/integrations/codebase-memory/service";
import { CodebaseMemoryProcessTransport } from "../src/integrations/codebase-memory/transport";

loadFactoryCliEnv();

async function main() {
  if (process.env.ALLOW_REAL_CODEBASE_MEMORY_SMOKE !== "true") {
    console.log(JSON.stringify({ status: "NOT_CONFIGURED", releaseEligible: false, reason: "Explicit Codebase Memory smoke opt-in is required.", evidence: "incomplete" }));
    process.exitCode = 1;
    return;
  }
  const configuredExecutable = process.env.CODEBASE_MEMORY_EXECUTABLE;
  if (!configuredExecutable) {
    console.log(JSON.stringify({ status: "NOT_CONFIGURED", releaseEligible: false, reason: "CODEBASE_MEMORY_EXECUTABLE is not configured.", evidence: "configuration-incomplete" }));
    process.exitCode = 1;
    return;
  }
  const config = readCodebaseMemoryConfig({ ...process.env, CODEBASE_MEMORY_ENABLED: "true", GENERATED_PROJECTS_ROOT: os.tmpdir() });
  if (!config.enabled || !config.executable) {
    console.log(JSON.stringify({ status: "NOT_INSTALLED", releaseEligible: false, reason: "Configured Codebase Memory executable is not available.", evidence: "executable-unavailable" }));
    process.exitCode = 1;
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "factory-codebase-memory-smoke-"));
  const workspace = path.join(root, "fixture", "v1");
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "index.ts"), "export function submitRepairRequest() { return ContactForm(); }\nfunction ContactForm() { return true; }\n");
  const transport = new CodebaseMemoryProcessTransport(config.executable, workspace, config.timeoutMs);
  try {
    const service = new CodebaseMemoryService((tool, args, signal) => transport.call(tool, args, signal), config);
    const scope = { projectId: randomUUID(), projectVersion: 1, workspacePath: workspace, generatedProjectsRoot: root, workspaceManagerReference: "fixture:v1" };
    const index = await service.ensureIndex(scope, "smoke");
    const plan = { queryId: randomUUID(), projectId: scope.projectId, projectVersion: 1, taskId: "smoke", requesterRole: "implementation" as const, operation: "findSymbol" as const, symbol: "submitRepairRequest", reason: "Verify the known fixture symbol is indexed.", requirementReferences: ["smoke"], taskReferences: ["smoke"], maxResults: 5, maxBytes: 4000, sourceManifestChecksum: index.manifestChecksum, workspaceScope: scope };
    const result = await service.findSymbol(plan);
    if (!result.symbols.length) throw new CodebaseMemoryError("CODEBASE_MEMORY_INDEX_FAILED", "Smoke fixture symbol was not returned by the indexed query.");
    console.log(JSON.stringify({ status: "PASS", releaseEligible: false, resultCount: result.symbols.length, evidence: "executed-codebase-memory-boundary" }));
  } catch (error) {
    const code = error instanceof CodebaseMemoryError ? error.code : "CODEBASE_MEMORY_UNAVAILABLE";
    const status = code === "CODEBASE_MEMORY_INDEX_STALE" ? "INDEX_STALE" : code === "CODEBASE_MEMORY_INDEX_FAILED" ? "INDEX_UNAVAILABLE" : "INDEX_UNAVAILABLE";
    console.log(JSON.stringify({ status, releaseEligible: false, reason: "Codebase Memory smoke failed at the bounded index/query boundary.", errorCode: code, evidence: "executed-codebase-memory-boundary" }));
    process.exitCode = 1;
  } finally {
    await transport.close();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EBUSY" || attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}
void main();
