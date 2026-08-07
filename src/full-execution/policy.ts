import { checksumPersistedDocument } from "../persistence/serialization";
import { validateImplementationTaskGraph } from "../orchestrator/validation";
import { FullExecutionError } from "./errors";
import { DEFAULT_FULL_EXECUTION_POLICY, type FullExecutionPolicy, type FullExecutionStartInput } from "./contracts";

export function graphChecksum(graph: FullExecutionStartInput["graph"]) { const value = { ...graph }; delete value.graphChecksum; return checksumPersistedDocument(value); }
export function validateFullExecutionReadiness(input: FullExecutionStartInput, policy: FullExecutionPolicy = DEFAULT_FULL_EXECUTION_POLICY) {
  if (input.workflowState !== "IMPLEMENTING") throw new FullExecutionError("FULL_EXECUTION_NOT_READY", "Full execution requires the IMPLEMENTING workflow state.");
  if (input.projectImmutable) throw new FullExecutionError("FULL_EXECUTION_WORKSPACE_INVALID", "Immutable project versions cannot execute.");
  if (!input.workspaceValid) throw new FullExecutionError("FULL_EXECUTION_WORKSPACE_INVALID", "The generated staging workspace is unavailable or invalid.");
  if (input.expectedGraphChecksum !== graphChecksum(input.graph)) throw new FullExecutionError("FULL_EXECUTION_GRAPH_STALE", "The TaskGraph checksum is stale.");
  if (Object.keys(input.sourceDocumentChecksums).some((name) => input.sourceDocumentChecksums[name] !== input.currentDocumentChecksums[name])) throw new FullExecutionError("FULL_EXECUTION_DOCUMENT_STALE", "An approved source document checksum is stale.");
  if (input.requirementChangePending) throw new FullExecutionError("FULL_EXECUTION_DOCUMENT_STALE", "An unapproved requirement change is pending.");
  if ((input.activeRunIds ?? []).length) throw new FullExecutionError("FULL_EXECUTION_CONFLICT", "Another execution run is active for this project version.");
  const validation = validateImplementationTaskGraph(input.graph); if (!validation.valid) throw new FullExecutionError("FULL_EXECUTION_NOT_READY", "The TaskGraph failed deterministic validation.", validation.errors);
  if (!input.graph.tasks.some((task) => task.status === "ready") && !input.graph.tasks.every((task) => task.status === "passed" || policy.releaseBoundaryTaskTypes.includes(task.taskType))) throw new FullExecutionError("FULL_EXECUTION_NOT_READY", "The graph has no READY task to execute.");
  return true;
}

export function classifyTaskFailure(task: { taskType: string }, outcome: { status: string; classification?: string; repairable?: boolean }) {
  if (outcome.status === "cancelled") return "cancelled" as const;
  if (outcome.classification) return outcome.classification as "retryable-task" | "repairable" | "blocking-nonrepairable" | "cancelled" | "stale-state" | "infrastructure-failure";
  if (outcome.repairable) return "repairable" as const;
  if (task.taskType.startsWith("validate-")) return "repairable" as const;
  return "blocking-nonrepairable" as const;
}

export function taskCategory(taskType: string): "implementation" | "runtime-validation" | "functional-qa" | "static-validation" | "unsupported" {
  if (["validate-lint", "validate-typecheck", "validate-unit-tests", "validate-build"].includes(taskType)) return "runtime-validation";
  if (taskType === "validate-functional-flow") return "functional-qa";
  if (["validate-security", "validate-database"].includes(taskType)) return "static-validation";
  if (taskType.startsWith("implement-") || taskType.startsWith("write-") || taskType === "prepare-workspace" || taskType === "integrate-assets" || taskType === "integrate-content" || taskType === "repair-targeted-failure") return "implementation";
  return "unsupported";
}
