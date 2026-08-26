import { pathToFileURL } from "node:url";
import path from "node:path";
import { CODEX_ROOT } from "./config";
import { preflightTaskEnvelope, readTaskEnvelope } from "./task-envelope";

function parseArgs(args: readonly string[]) {
  let filename = "";
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--file") filename = args[++index] ?? "";
    else if (arg === "--json") json = true;
    else throw new Error(`CODEX_OPTION_UNKNOWN:${arg}`);
  }
  if (!filename) throw new Error("CODEX_TASK_FILE_REQUIRED");
  return { filename: path.resolve(CODEX_ROOT, filename), json };
}

export async function runTaskPreflight(root = CODEX_ROOT, filename: string) {
  const envelopePath = path.resolve(root, filename);
  const envelope = await readTaskEnvelope(envelopePath);
  return preflightTaskEnvelope(root, envelope, { envelopePath });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runTaskPreflight(CODEX_ROOT, options.filename);
  if (options.json) console.log(JSON.stringify(report));
  else {
    console.log("CODEX TASK PREFLIGHT");
    console.log(`Mode .................. ${report.envelope.mode}`);
    console.log(`Operation ............. ${report.envelope.operation}`);
    console.log(`Expected HEAD ......... ${report.envelope.expectedHead.slice(0, 12)}`);
    console.log(`Current HEAD .......... ${report.currentHead.slice(0, 12)}`);
    console.log(`Working tree .......... ${report.workingTreePaths.length ? report.workingTreePaths.join(", ") : "clean"}`);
    console.log(`Provider budget ....... ${JSON.stringify(report.envelope.providerBudget)}`);
    console.log(`Protected session ..... ${report.protectedSessionFound ? "PASS" : "not required"}`);
    console.log("CODEX TASK PREFLIGHT: PASS");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "CODEX_TASK_PREFLIGHT_FAILED"); process.exitCode = 1; });

export { parseArgs as parseTaskArgs };
