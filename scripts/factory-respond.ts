import { loadFactoryCliEnv } from "./cli-env";
import { parseRespondArgs, readAnswers, renderWorkflowResult } from "@/runtime/trial-entry/cli";
import { createNodeTrialEntryRuntime } from "@/runtime/trial-entry/node";

loadFactoryCliEnv();

async function main() {
  const options = parseRespondArgs(process.argv.slice(2));
  const runtime = createNodeTrialEntryRuntime({ requireAi: true });
  try {
    const status = await runtime.service.status(options.projectId);
    const answers = await readAnswers(options, status.clarification?.questions ?? []);
    const result = await runtime.service.respond(options.projectId, answers);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(renderWorkflowResult(result));
    console.error(`Factory telemetry: providerRequests=${runtime.evidence.providerRequests}`);
  } finally {
    await runtime.close();
  }
}

main().catch(() => {
  console.error("TRIAL_ENTRY_FAILED: The clarification response could not be submitted safely.");
  process.exitCode = 1;
});
