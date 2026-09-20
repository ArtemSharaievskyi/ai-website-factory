import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadFactoryCliEnv } from "./cli-env";
import { Context7Cache } from "../src/integrations/context7/cache";
import { readContext7Config } from "../src/integrations/context7/config";
import { Context7Service } from "../src/integrations/context7/service";
import { createContext7McpTransport } from "../src/integrations/context7/transport";
import { requestPlannerDocumentation } from "../src/integrations/context7/planner";

loadFactoryCliEnv();

async function main() {
  if (process.env.ALLOW_REAL_CONTEXT7_SMOKE !== "true") { console.log(JSON.stringify({ status: "not-run", releaseEligible: false, reason: "Explicit Context7 smoke opt-in is required.", evidence: "incomplete" })); process.exitCode = 1; return; }
  const root = await mkdtemp(path.join(os.tmpdir(), "context7-smoke-"));
  try { const config = { ...readContext7Config({ ...process.env, CONTEXT7_ENABLED: "true" }), enabled: true }; const service = new Context7Service(createContext7McpTransport(config), config, new Context7Cache(root, 60, 2)); const library = await service.resolveLibrary({ packageName: "next", dependencyPlan: [{ name: "next", version: "16.2.12" }], requesterRole: "planner-architect", taskType: "documentation-smoke", projectId: "00000000-0000-0000-0000-000000000001", projectVersion: 1, requestId: "context7-smoke" }); const result = await requestPlannerDocumentation(service, { allowedTools: ["Context7-read"], packageName: library.packageName, resolvedLibraryId: library.resolvedLibraryId, version: library.version, topic: "Next.js App Router metadata API", reason: "Verify current framework documentation during planning", projectId: "00000000-0000-0000-0000-000000000001", projectVersion: 1, taskType: "documentation-smoke" }); console.log(JSON.stringify({ status: "passed", releaseEligible: false, transport: "live-context7-mcp-http", dispatch: "planner-requestPlannerDocumentation", package: library.packageName, requestedVersion: library.version, excerptCount: result.length, totalBytes: result.reduce((sum, item) => sum + Buffer.byteLength(item.content, "utf8"), 0), sourceReference: result[0]?.sourceReference, releaseEvidence: "executed-live-integration-boundary" })); } finally { await rm(root, { recursive: true, force: true }); }
}
void main();
