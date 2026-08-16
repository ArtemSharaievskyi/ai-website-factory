import { pathToFileURL } from "node:url";
import { CODEX_ROOT } from "./config";
import { readGitHead, untrackedFiles } from "./git";
import { runRegisteredGuards } from "./registered-guards";
import { assertSessionStartAllowed, buildSession, readExistingBaselineUntrackedFiles, readProtectedProjectSnapshot, saveSession, sessionExists } from "./protected-state";

type StartOptions = { projectIds: string[]; reset: boolean; json: boolean };

function parseArgs(args: readonly string[]): StartOptions {
  const projectIds: string[] = [];
  let reset = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--protect") {
      const value = args[++index];
      if (!value) throw new Error("CODEX_PROTECTED_PROJECT_REQUIRED");
      projectIds.push(value);
    } else if (arg === "--reset") reset = true;
    else if (arg === "--json") json = true;
    else throw new Error(`CODEX_OPTION_UNKNOWN:${arg}`);
  }
  if (!projectIds.length) throw new Error("CODEX_PROTECTED_PROJECT_REQUIRED");
  return { projectIds: [...new Set(projectIds)], reset, json };
}

export async function startSession(root = CODEX_ROOT, options: StartOptions) {
  assertSessionStartAllowed(await sessionExists(root), options.reset);
  const baselineHead = await readGitHead(root);
  const existingBaselineUntrackedFiles = await readExistingBaselineUntrackedFiles(root);
  const baselineUntrackedFiles = existingBaselineUntrackedFiles ?? await untrackedFiles(root);
  const baselineFailures = await runRegisteredGuards(root);
  const protectedProjects = [];
  for (const projectId of options.projectIds) protectedProjects.push(await readProtectedProjectSnapshot(root, projectId));
  const session = buildSession(baselineHead, protectedProjects, new Date().toISOString(), baselineUntrackedFiles, baselineFailures);
  await saveSession(root, session);
  return session;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const session = await startSession(CODEX_ROOT, options);
  if (options.json) console.log(JSON.stringify(session));
  else {
    console.log("CODEX START");
    console.log(`Baseline ............... ${session.baselineHead.slice(0, 12)}`);
    console.log(`Protected projects ..... ${session.protectedProjects.length}`);
    console.log("Session ................ .codex/session.json");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "CODEX_START_FAILED"); process.exitCode = 1; });

export { parseArgs as parseStartArgs };
