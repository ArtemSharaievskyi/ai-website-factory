import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runRealFactoryE2EPreflight } from "../src/real-factory-e2e/preflight";
import { runRealFactoryE2E } from "../src/real-factory-e2e/harness";

async function main() {
  const preflight = await runRealFactoryE2EPreflight();
  if (!preflight.optIn) { console.log("REAL_FACTORY_E2E_PENDING"); return; }
  if (preflight.status !== "passed") { console.error(JSON.stringify({ status: preflight.status, blockers: preflight.blockers, warnings: preflight.warnings })); process.exitCode = 1; return; }
  const { createProductionFactoryRuntime, validateProductionFactoryRuntime } = await import("../src/runtime/production-factory-runtime");
  const runtime = createProductionFactoryRuntime({ context7: preflight.integrations.context7 === "configured" ? "configured" : "not-needed", shadcn: preflight.integrations.shadcn === "configured" ? "configured" : "not-needed" });
  validateProductionFactoryRuntime(runtime);
  const root = path.resolve(process.env.GENERATED_PROJECTS_ROOT ?? path.resolve(".factory-generated"));
  const report = await runRealFactoryE2E({ preflight, generatedProjectsRoot: root, runner: undefined });
  await mkdir(path.join(root, "_smoke"), { recursive: true });
  const reportPath = path.join(root, "_smoke", "real-factory-e2e-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: report.overallStatus, reportPath, releaseEligible: report.releaseEligible }));
  if (report.overallStatus !== "passed") process.exitCode = 1;
  await runtime.close();
}
void main().catch((error) => { console.error(JSON.stringify({ status: "failed", blocker: error instanceof Error ? error.message : "REAL_E2E_UNKNOWN_FAILURE" })); process.exitCode = 1; });
