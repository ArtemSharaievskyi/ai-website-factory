import { pathToFileURL } from "node:url";
import { CODEX_ROOT } from "./config";
import { resolveAffectedFromBaseline } from "./affected";
import { requiredChecksPassed, runControlledChecks, type ControlledCheckResult } from "./checks";
import { classifyBaselineFailures, type ClassifiedFailure, type GuardFailure } from "./baseline-failures";
import { forbiddenTrackedPaths, gitDiffCheck, isBaselineAncestor, readGitHead, trackedChangedFiles } from "./git";
import { loadSession, verifyProtectedProjects, type ProtectedDifference } from "./protected-state";
import { verifyProductionPathEvidence, type ProductionPathResult } from "./production-paths";
import { runRegisteredGuardSnapshot } from "./registered-guards";

export type CodexVerifyReport = {
  baseline: string;
  currentHead: string;
  baselineRelated: boolean;
  changedFiles: string[];
  areas: string[];
  regressions: string[];
  checks: ControlledCheckResult[];
  productionPaths: ProductionPathResult[];
  protectedDifferences: ProtectedDifference[];
  protectedReadFailed: boolean;
  diffCheckPassed: boolean;
  forbiddenTrackedFiles: string[];
  baselineFailures: ClassifiedFailure[];
  blockingFailures: ClassifiedFailure[];
  resolvedFailures: GuardFailure[];
  passed: boolean;
};

const unique = <T>(values: readonly T[]) => [...new Set(values)];

function guardResult(id: "provider-contracts" | "architecture", label: string, classification: ReturnType<typeof classifyBaselineFailures>, knownProductDefects: string[] = []): ControlledCheckResult {
  const blocking = classification.blocking.filter((failure) => failure.guardId === id);
  const baselineFailures = classification.baselineFailures.filter((failure) => failure.guardId === id);
  return {
    id,
    label,
    passed: blocking.length === 0,
    code: blocking.length ? blocking.map((failure) => failure.reason + ":" + failure.code).join(",") : baselineFailures.length ? "BASELINE_FAILURE" : "PASS",
    ...(knownProductDefects.length ? { knownProductDefects } : {}),
  };
}

export async function verifySession(root = CODEX_ROOT): Promise<CodexVerifyReport> {
  const session = await loadSession(root);
  const currentHead = await readGitHead(root);
  const baselineRelated = await isBaselineAncestor(root, session.baselineHead, currentHead);
  const resolution = await resolveAffectedFromBaseline(root, session.baselineHead, session.baselineUntrackedFiles);
  const guardSnapshot = await runRegisteredGuardSnapshot(root);
  const failureClassification = classifyBaselineFailures(session.baselineFailures, guardSnapshot.failures, resolution.changedFiles);
  const guardedIds = new Set(["provider-contracts", "architecture"]);
  const checkIds = unique(["typecheck", "lint", ...resolution.checkIds].filter((id) => !guardedIds.has(id))) as Parameters<typeof runControlledChecks>[0];
  const checks = await runControlledChecks(checkIds, root);
  const hasProviderGuard = resolution.checkIds.includes("provider-contracts") || session.baselineFailures.some((failure) => failure.guardId === "provider-contracts") || guardSnapshot.failures.some((failure) => failure.guardId === "provider-contracts");
  const hasArchitectureGuard = resolution.checkIds.includes("architecture") || session.baselineFailures.some((failure) => failure.guardId === "architecture") || guardSnapshot.failures.some((failure) => failure.guardId === "architecture");
  if (hasProviderGuard) checks.push(guardResult("provider-contracts", "Provider contracts", failureClassification, guardSnapshot.provider.knownProductDefects));
  if (hasArchitectureGuard) checks.push(guardResult("architecture", "Architecture boundaries", failureClassification));
  const productionPaths = await verifyProductionPathEvidence(root, resolution.productionPathIds);
  let protectedDifferences: ProtectedDifference[] = [];
  let protectedReadFailed = false;
  try { protectedDifferences = await verifyProtectedProjects(root, session); } catch { protectedReadFailed = true; }
  const trackedFiles = await trackedChangedFiles(root, session.baselineHead);
  const diffCheckPassed = await gitDiffCheck(root);
  const forbidden = forbiddenTrackedPaths(trackedFiles);
  const passed = baselineRelated && requiredChecksPassed(checks) && failureClassification.blocking.length === 0 && productionPaths.every((path) => path.present) && !protectedReadFailed && protectedDifferences.length === 0 && diffCheckPassed && forbidden.length === 0;
  return { baseline: session.baselineHead, currentHead, baselineRelated, changedFiles: resolution.changedFiles, areas: resolution.areas, regressions: resolution.regressionIds, checks, productionPaths, protectedDifferences, protectedReadFailed, diffCheckPassed, forbiddenTrackedFiles: forbidden, baselineFailures: failureClassification.baselineFailures, blockingFailures: failureClassification.blocking, resolvedFailures: failureClassification.resolved, passed };
}

function printReport(report: CodexVerifyReport) {
  console.log("CODEX VERIFY");
  if (report.baselineFailures.length) console.log("Baseline failures ..... BASELINE_FAILURE (" + report.baselineFailures.length + ")");
  for (const failure of report.blockingFailures) console.log("Blocking guard ........ " + failure.reason + " (" + failure.guardId + ":" + failure.key + ")");
  if (report.resolvedFailures.length) console.log("Resolved baseline ..... " + report.resolvedFailures.length);
  console.log(`Baseline ............... ${report.baseline.slice(0, 12)}`);
  console.log(`Current HEAD ........... ${report.currentHead.slice(0, 12)}`);
  console.log(`Changed areas .......... ${report.areas.length ? report.areas.join(", ") : "none"}`);
  console.log(`Historical regressions . ${report.regressions.length ? report.regressions.join(", ") : "none"}`);
  for (const check of report.checks) console.log(`${check.label.padEnd(24, ".")} ${check.passed ? check.code : `FAIL (${check.code})`}`);
  for (const pathEntry of report.productionPaths) console.log(`Production path: ${pathEntry.label.padEnd(16, ".")} ${pathEntry.present ? "PASS" : `MISSING (${pathEntry.code})`}`);
  console.log(`git diff --check ....... ${report.diffCheckPassed ? "PASS" : "FAIL"}`);
  if (report.protectedReadFailed) console.log("Protected projects ..... FAIL (STATUS_READ_FAILED)");
  else if (report.protectedDifferences.length) {
    console.log("Protected projects ..... FAIL");
    for (const difference of report.protectedDifferences) console.log(`  ${difference.projectId} ${difference.field}: ${String(difference.before)} -> ${String(difference.after)}`);
  } else console.log("Protected projects ..... PASS");
  if (report.forbiddenTrackedFiles.length) console.log(`Forbidden tracked files  FAIL (${report.forbiddenTrackedFiles.join(", ")})`);
  if (!report.baselineRelated) console.log("Baseline relationship .. FAIL (CURRENT_HEAD_NOT_DESCENDANT)");
  const known = unique(report.checks.flatMap((check) => check.knownProductDefects ?? []));
  if (known.length) console.log(`CURRENT PRODUCT DEFECT DETECTED BY NEW GUARD: ${known.join(", ")}`);
  console.log(`CODEX VERIFY: ${report.passed ? "PASS" : "FAIL"}`);
}

async function main() {
  const json = process.argv.slice(2).includes("--json");
  const report = await verifySession(CODEX_ROOT);
  if (json) console.log(JSON.stringify(report));
  else printReport(report);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "CODEX_VERIFY_FAILED"); process.exitCode = 1; });

export { printReport };
