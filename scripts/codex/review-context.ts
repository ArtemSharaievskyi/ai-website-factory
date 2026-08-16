import { pathToFileURL } from "node:url";
import { CODEX_ROOT } from "./config";
import { resolveAffectedFromBaseline } from "./affected";
import { classifyBaselineFailures } from "./baseline-failures";
import { gitDiffCheck, readGitHead, trackedChangedFiles } from "./git";
import { runGit } from "./process";
import { loadSession } from "./protected-state";
import { runArchitectureCheck } from "./check-architecture";
import { runRegisteredGuardSnapshot } from "./registered-guards";

export async function buildReviewContext(root = CODEX_ROOT) {
  const session = await loadSession(root);
  const currentHead = await readGitHead(root);
  const resolution = await resolveAffectedFromBaseline(root, session.baselineHead, session.baselineUntrackedFiles);
  const [guards, architecture, trackedFiles, diffStat] = await Promise.all([
    runRegisteredGuardSnapshot(root),
    runArchitectureCheck(root, { emit: false }),
    trackedChangedFiles(root, session.baselineHead),
    runGit(root, ["diff", "--stat", session.baselineHead, "--"]),
  ]);
  const failures = classifyBaselineFailures(session.baselineFailures, guards.failures, resolution.changedFiles);
  return {
    baseline: session.baselineHead,
    currentHead,
    changedFiles: resolution.changedFiles,
    trackedFiles,
    areas: resolution.areas,
    checkIds: resolution.checkIds,
    regressions: resolution.regressionIds,
    diffStat: diffStat.code === 0 ? diffStat.stdout.trim() : "DIFF_STAT_UNAVAILABLE",
    architecture: { passed: architecture.passed, violationCount: architecture.violations.length },
    baselineFailureCodes: failures.baselineFailures.map((failure) => failure.guardId + ":" + failure.code),
    blockingFailureCodes: failures.blocking.map((failure) => failure.guardId + ":" + failure.reason + ":" + failure.code),
    resolvedFailureCount: failures.resolved.length,
    diffCheckPassed: await gitDiffCheck(root),
    protectedProjectCount: session.protectedProjects.length,
  };
}

function printReviewContext(context: Awaited<ReturnType<typeof buildReviewContext>>) {
  console.log("CODEX REVIEW CONTEXT");
  console.log("Baseline ............... " + context.baseline.slice(0, 12));
  console.log("Current HEAD ........... " + context.currentHead.slice(0, 12));
  console.log("Changed files .......... " + (context.changedFiles.length ? context.changedFiles.join(", ") : "none"));
  console.log("Areas .................. " + (context.areas.length ? context.areas.join(", ") : "none"));
  console.log("Checks ................. " + (context.checkIds.length ? context.checkIds.join(", ") : "none"));
  console.log("Regressions ............ " + (context.regressions.length ? context.regressions.join(", ") : "none"));
  console.log("Architecture ........... " + (context.architecture.passed ? "PASS" : "BASELINE_OR_CURRENT_FAILURE") + " (" + context.architecture.violationCount + ")");
  console.log("Baseline guards ........ " + (context.baselineFailureCodes.length ? context.baselineFailureCodes.join(", ") : "none"));
  console.log("Blocking guards ........ " + (context.blockingFailureCodes.length ? context.blockingFailureCodes.join(", ") : "none"));
  console.log("git diff --check ....... " + (context.diffCheckPassed ? "PASS" : "FAIL"));
  console.log("Protected snapshots .... " + context.protectedProjectCount);
}

async function main() {
  const context = await buildReviewContext(CODEX_ROOT);
  printReviewContext(context);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "CODEX_REVIEW_CONTEXT_FAILED"); process.exitCode = 1; });

export { printReviewContext };
