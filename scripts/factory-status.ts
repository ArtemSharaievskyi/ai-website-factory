import { loadFactoryCliEnv } from "./cli-env";
import { parseStatusArgs, renderStatus } from "@/runtime/trial-entry/cli";
import { createProductionTrialEntryRuntime } from "@/runtime/trial-entry/production";

loadFactoryCliEnv();

async function main() {
  const options = parseStatusArgs(process.argv.slice(2));
  const runtime = createProductionTrialEntryRuntime({ requireAi: false });
  try {
    const result = await runtime.service.status(options.projectId);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(renderStatus(result));
  } finally {
    await runtime.close();
  }
}

main().catch(() => {
  console.error("TRIAL_ENTRY_FAILED: The project status could not be read safely.");
  process.exitCode = 1;
});
