import { loadFactoryCliEnv } from "./cli-env";
import { parseNewArgs, readInitialRequest, renderNewResult } from "@/runtime/trial-entry/cli";
import { createNodeTrialEntryRuntime } from "@/runtime/trial-entry/node";

loadFactoryCliEnv();

async function main() {
  const options = parseNewArgs(process.argv.slice(2));
  const runtime = createNodeTrialEntryRuntime({ requireAi: true });
  try {
    const requestText = await readInitialRequest(options);
    const result = await runtime.service.createProject({ requestText });
    if (options.json) console.log(JSON.stringify(result));
    else console.log(renderNewResult(result));
    console.error(`Factory telemetry: providerRequests=${runtime.evidence.providerRequests}`);
  } finally {
    await runtime.close();
  }
}

main().catch(() => {
  console.error("TRIAL_ENTRY_FAILED: The project request could not be submitted safely.");
  process.exitCode = 1;
});
