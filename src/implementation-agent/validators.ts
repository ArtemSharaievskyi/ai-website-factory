import type { AgentTask } from "../domain/tasks/schema";
import type { ImplementationChangeProposal } from "./contracts";
import { ImplementationError } from "./errors";
export const SUPPORTED_IMPLEMENTATION_TASK_TYPES = new Set(["prepare-workspace", "implement-project-foundation", "implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "integrate-content", "implement-seo", "write-unit-tests"]);
export function validateSupportedTask(task: AgentTask) { if (!SUPPORTED_IMPLEMENTATION_TASK_TYPES.has(task.taskType)) throw new ImplementationError("IMPLEMENTATION_TASK_TYPE_UNSUPPORTED", "This Implementation Agent foundation does not support the requested task type."); }
export function validateTaskResult(task: AgentTask, proposal: ImplementationChangeProposal) {
  if (task.taskType === "implement-navigation" && proposal.operations.some((operation) => operation.relativePath.includes("/unplanned/"))) throw new ImplementationError("IMPLEMENTATION_REQUIREMENT_VIOLATION", "Navigation proposal references an unplanned route.");
  if (task.taskType === "integrate-content" && proposal.operations.some((operation) => /TODO|TBD|unknown fact/i.test("content" in operation ? operation.content : "newText" in operation ? operation.newText : ""))) throw new ImplementationError("IMPLEMENTATION_UNSUPPORTED_BUSINESS_FACT", "Content proposal contains unresolved factual markers.");
  if (task.taskType === "implement-page" && proposal.operations.some((operation) => /admin|dashboard/i.test(operation.relativePath) && !task.requirementReferences?.some((reference) => /admin|dashboard/i.test(reference)))) throw new ImplementationError("IMPLEMENTATION_UNAPPROVED_FEATURE", "Page proposal targets an unapproved protected feature.");
  return [{ name: task.taskType, status: "passed" as const, summary: "Deterministic task-specific validation passed." }];
}
