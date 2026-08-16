import { pathToFileURL } from "node:url";
import { CODEX_ROOT } from "./config";
import { resolveAffectedFromBaseline } from "./affected";
import { runControlledChecks } from "./checks";
import { loadSession } from "./protected-state";

function parseArgs(args: readonly string[]) {
  let run = false;
  let json = false;
  for (const arg of args) {
    if (arg === "--run") run = true;
    else if (arg === "--json") json = true;
    else throw new Error(`CODEX_OPTION_UNKNOWN:${arg}`);
  }
  return { run, json };
}

export async function affected(root = CODEX_ROOT, options: { run?: boolean } = {}) {
  const session = await loadSession(root);
  const resolution = await resolveAffectedFromBaseline(root, session.baselineHead, session.baselineUntrackedFiles);
  const results = options.run ? await runControlledChecks(resolution.checkIds, root) : [];
  return { ...resolution, results };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await affected(CODEX_ROOT, options);
  if (options.json) console.log(JSON.stringify(result));
  else {
    console.log("CODEX AFFECTED CHECKS");
    console.log(`Changed files .......... ${result.changedFiles.length}`);
    console.log(`Changed areas .......... ${result.areas.length ? result.areas.join(", ") : "none"}`);
    console.log(`Regressions ............ ${result.regressionIds.length ? result.regressionIds.join(", ") : "none"}`);
    console.log(`Checks ................. ${result.checkIds.join(", ")}`);
    if (options.run) for (const check of result.results) console.log(`${check.label.padEnd(24, ".")} ${check.passed ? "PASS" : `FAIL (${check.code})`}`);
  }
  if (result.results.some((check) => !check.passed)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "CODEX_AFFECTED_FAILED"); process.exitCode = 1; });

export { parseArgs as parseAffectedArgs };
