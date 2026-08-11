import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFactoryCliEnv } from "./cli-env";
import { runRealFactoryE2EPreflight } from "../src/runtime/e2e/preflight";
import { runRealFactoryE2E } from "../src/runtime/e2e/harness";
import { RealFactoryE2EReportSchema } from "../src/runtime/e2e/contracts";
import { withRuntimeLifecycle } from "../src/runtime/e2e/lifecycle";

loadFactoryCliEnv();

async function main() {
  const preflight = await runRealFactoryE2EPreflight();
  if (!preflight.optIn) { console.log(JSON.stringify({ status: "not-run", releaseEligible: false, reason: "Factory E2E requires explicit preflight opt-in; customer website E2E was not run in this correction.", evidence: "incomplete" })); process.exitCode = 1; return; }
  if (preflight.status !== "passed") { console.error(JSON.stringify({ status: preflight.status, blockers: preflight.blockers, warnings: preflight.warnings })); process.exitCode = 1; return; }
  const { createProductionFactoryRuntime, validateProductionFactoryRuntime } = await import("../src/runtime/server");
  const root = path.resolve(process.env.GENERATED_PROJECTS_ROOT ?? path.resolve(".factory-generated"));
  const runtime = createProductionFactoryRuntime({ context7: preflight.integrations.context7 === "configured" ? "configured" : "not-needed", shadcn: preflight.integrations.shadcn === "configured" ? "configured" : "not-needed", generatedProjectsRoot: root });
  await withRuntimeLifecycle(runtime, async () => {
    validateProductionFactoryRuntime(runtime);
    let resume: { smokeId: string; report: import("../src/runtime/e2e/contracts").RealFactoryE2EReport } | undefined;
    if (process.env.REAL_FACTORY_E2E_RESUME === "true") {
      const smokeId = process.env.REAL_FACTORY_E2E_SMOKE_ID;
      if (!smokeId) throw new Error("REAL_E2E_RESUME_SMOKE_ID_REQUIRED");
      const reportPath = path.join(root, "_smoke", `real-factory-e2e-${smokeId}.json`);
      const report = RealFactoryE2EReportSchema.parse(JSON.parse(await readFile(reportPath, "utf8")));
      if (report.smokeId !== smokeId) throw new Error("REAL_E2E_RESUME_REPORT_ID_MISMATCH");
      resume = { smokeId, report };
    }
    const report = await runRealFactoryE2E({ preflight, generatedProjectsRoot: root, runtime, resume });
    await mkdir(path.join(root, "_smoke"), { recursive: true });
    const reportPath = path.join(root, "_smoke", `real-factory-e2e-${report.smokeId}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: resume ? "w" : "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: report.overallStatus, reportPath, releaseEligible: report.releaseEligible }));
    if (report.overallStatus !== "passed") process.exitCode = 1;
  });
}
void main().catch((error) => { console.error(JSON.stringify({ status: "failed", blocker: error instanceof Error ? error.message : "REAL_E2E_UNKNOWN_FAILURE" })); process.exitCode = 1; });
