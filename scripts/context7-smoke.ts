import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadFactoryCliEnv } from "./cli-env";
import { Context7Cache } from "../src/integrations/context7/cache";
import { readContext7Config } from "../src/integrations/context7/config";
import { Context7Service, syntheticContext7Transport } from "../src/integrations/context7/service";

loadFactoryCliEnv();

async function main() {
  if (process.env.ALLOW_REAL_CONTEXT7_SMOKE !== "true") { console.error("REAL_CONTEXT7_SMOKE_PENDING: explicit opt-in is required."); process.exitCode = 1; return; }
  const root = await mkdtemp(path.join(os.tmpdir(), "context7-smoke-"));
  try { const config = { ...readContext7Config({ CONTEXT7_ENABLED: "true" }), enabled: true }; const service = new Context7Service(syntheticContext7Transport(), config, new Context7Cache(root, 60, 2)); const library = await service.resolveLibrary({ packageName: "next", dependencyPlan: [{ name: "next", version: "16.2.12" }], requesterRole: "planner-architect", taskType: "documentation-smoke", projectId: "00000000-0000-0000-0000-000000000001", projectVersion: 1, requestId: "context7-smoke" }); const result = await service.queryDocumentation({ idempotencyKey: "context7-smoke", plan: { queryId: crypto.randomUUID(), requesterRole: "planner-architect", taskType: "documentation-smoke", packageName: "next", resolvedLibraryId: library.resolvedLibraryId, version: library.version, topic: "Next.js App Router metadata API", reason: "Synthetic smoke validation", requirementReferences: [], planningReferences: [], expectedUse: "Validate read-only documentation normalization", maxExcerpts: 1, maxBytes: 2000, createdAt: new Date().toISOString() } }); console.log(JSON.stringify({ package: library.packageName, version: library.version, excerptCount: result.excerpts.length, totalBytes: result.totalBytes })); } finally { await rm(root, { recursive: true, force: true }); }
}
void main();
