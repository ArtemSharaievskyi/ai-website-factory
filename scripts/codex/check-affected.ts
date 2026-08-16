import { pathToFileURL } from "node:url";
import { CODEX_ROOT } from "./config";
import { resolveAffectedFromBaseline } from "./affected";
import { classifyBaselineFailures } from "./baseline-failures";
import { runControlledChecks, type ControlledCheckResult } from "./checks";
import { loadSession } from "./protected-state";
import { runRegisteredGuardSnapshot } from "./registered-guards";

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
  if (!options.run) return { ...resolution, results: [] as ControlledCheckResult[] };
  const guardedIds = new Set(["provider-contracts", "architecture"]);
  const results = await runControlledChecks(resolution.checkIds.filter((id) => !guardedIds.has(id)), root);
  const snapshot = await runRegisteredGuardSnapshot(root);
  const classification = classifyBaselineFailures(session.baselineFailures, snapshot.failures, resolution.changedFiles);
  const addGuardResult = (id: "provider-contracts" | "architecture", label: string, knownProductDefects: string[] = []) => {
    const blocking = classification.blocking.filter((failure) => failure.guardId === id);
    const baselineFailures = classification.baselineFailures.filter((failure) => failure.guardId === id);
    results.push({ id, label, passed: blocking.length === 0, code: blocking.length ? blocking.map((failure) => failure.reason + ":" + failure.code).join(",") : baselineFailures.length ? "BASELINE_FAILURE" : "PASS", ...(knownProductDefects.length ? { knownProductDefects } : {}) });
  };
  if (resolution.checkIds.includes("provider-contracts")) addGuardResult("provider-contracts", "Provider contracts", snapshot.provider.knownProductDefects);
  if (resolution.checkIds.includes("architecture")) addGuardResult("architecture", "Architecture boundaries");
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
    if (options.run) for (const check of result.results) console.log(`${check.label.padEnd(24, ".")} ${check.passed ? check.code : `FAIL (${check.code})`}`);
  }
  if (result.results.some((check) => !check.passed)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "CODEX_AFFECTED_FAILED"); process.exitCode = 1; });

export { parseArgs as parseAffectedArgs };
