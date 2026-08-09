import { FunctionalQaError } from "./errors";
import type { FunctionalQaReport } from "./contracts";

export type FunctionalQaReconciliationInput = { report: FunctionalQaReport; activeBrowser: boolean; activeServer: boolean; qualityCheckPresent: boolean; currentProjectId: string; currentProjectVersion: number; currentRuntimeValidationPackageChecksum: string; currentRuntimeValidationLockfileChecksum: string; currentBriefChecksum: string; currentPlanningChecksum: string; currentDesignChecksum: string; expectedRuntimeValidationRunId: string };
export function reconcileFunctionalQa(input: FunctionalQaReconciliationInput) {
  const issues: Array<{ code: string; description: string; automaticRepairAllowed: boolean }> = [];
  if (input.report.status === "failed" || input.report.status === "cancelled") { /* terminal reports are valid evidence */ }
  if (!input.activeBrowser && input.report.status === "failed" && input.report.scenarios.length === 0) issues.push({ code: "QA_ORPHAN_PROCESS", description: "QA report has no scenario evidence and no active browser.", automaticRepairAllowed: false });
  if (!input.activeServer && input.report.status === "failed" && input.report.scenarios.some((scenario) => scenario.safeFailureCode === "QA_SERVER_STOP_FAILED")) issues.push({ code: "QA_ORPHAN_PROCESS", description: "The QA server remained after interruption.", automaticRepairAllowed: false });
  if (!input.qualityCheckPresent) issues.push({ code: "QA_RECONCILIATION_FAILED", description: "QA report has no persisted QualityCheck.", automaticRepairAllowed: false });
  if (input.report.qualityCheck.status === "passed" && input.report.failedCount > 0) issues.push({ code: "QA_RECONCILIATION_FAILED", description: "Passed QualityCheck conflicts with failed mandatory scenarios.", automaticRepairAllowed: false });
  if (input.report.projectId !== input.currentProjectId || input.report.projectVersion !== input.currentProjectVersion || input.report.runtimeValidationRunId !== input.expectedRuntimeValidationRunId) issues.push({ code: "QA_PROJECT_STATE_STALE", description: "QA report belongs to a different project, version, or runtime validation run.", automaticRepairAllowed: false });
  if (input.report.runtimeValidationPackageChecksum !== input.currentRuntimeValidationPackageChecksum || input.report.runtimeValidationLockfileChecksum !== input.currentRuntimeValidationLockfileChecksum) issues.push({ code: "QA_PROJECT_STATE_STALE", description: "Runtime validation inputs changed after QA.", automaticRepairAllowed: false });
  if (input.report.selectedBriefChecksum !== input.currentBriefChecksum || input.report.selectedPlanningChecksum !== input.currentPlanningChecksum || input.report.selectedDesignChecksum !== input.currentDesignChecksum) issues.push({ code: "QA_PROJECT_STATE_STALE", description: "Approved requirements, planning, or design changed after QA.", automaticRepairAllowed: false });
  return issues;
}

export function assertReconciledFunctionalQa(input: FunctionalQaReconciliationInput) { const issues = reconcileFunctionalQa(input); if (issues.length) throw new FunctionalQaError("QA_RECONCILIATION_FAILED", "Functional QA reconciliation failed.", issues); return true; }
