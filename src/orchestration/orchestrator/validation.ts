import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { TaskGraphSchema, type AgentTask, type TaskGraph } from "@/domain/tasks/schema";
import { OrchestratorError } from "./errors";
import { validateToolPolicy } from "./tools";
import type { OrchestratorInput, OrchestrationPolicy } from "./contracts";
import { validateExecutionCapabilities } from "@/orchestration/execution/capabilities";
import { validateTaskCapabilityBinding } from "@/orchestration/tooling/authority";

const infrastructure = new Set(["prepare-workspace", "implement-project-foundation", "validate-lint", "validate-typecheck", "validate-unit-tests", "validate-build", "validate-database", "validate-security", "validate-functional-flow", "prepare-release", "write-unit-tests", "write-integration-tests", "write-e2e-tests"]);
const scope = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");
const matches = (pattern: string, path: string) => { const p = scope(pattern).replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("§§", ".*"); return new RegExp(`^${p}$`, "i").test(scope(path)); };
const overlaps = (left: string, right: string) => left === right || matches(left, right) || matches(right, left) || (left.endsWith("/**") && right.startsWith(left.slice(0, -3))) || (right.endsWith("/**") && left.startsWith(right.slice(0, -3)));
export function validateFileScopes(tasks: AgentTask[]) {
  for (const task of tasks) {
    if (task.fileScopes.some((value) => value === "**/*" || value === "**" || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("..") || /(^|\/)\.env(?:\.|$)/i.test(value) || value === ".git" || value.startsWith(".git/"))) throw new OrchestratorError("TASK_FILE_SCOPE_INVALID", "A task file scope is unrestricted or outside the generated workspace.");
    if (task.executionMode !== "validation-only" && task.fileScopes.some((value) => value.startsWith(".factory/") && value !== ".factory/task-graph.json")) throw new OrchestratorError("TASK_FILE_SCOPE_INVALID", "Factory metadata may only be written through Factory services.");
  }
  const parallel = tasks.filter((task) => task.parallelGroup && task.executionMode === "parallel-safe");
  for (let i = 0; i < parallel.length; i++) for (let j = i + 1; j < parallel.length; j++) if (parallel[i]!.fileScopes.some((left) => parallel[j]!.fileScopes.some((right) => overlaps(left, right)))) throw new OrchestratorError("TASK_FILE_SCOPE_CONFLICT", "Parallel tasks have overlapping write scopes.");
}

export function validateImplementationTaskGraph(graph: TaskGraph, input?: OrchestratorInput, policy?: OrchestrationPolicy) {
  const errors: string[] = []; const warnings: string[] = [];
  const graphWithoutChecksum = { ...graph }; delete graphWithoutChecksum.graphChecksum;
  if (graph.graphChecksum && graph.graphChecksum !== checksumPersistedDocument(graphWithoutChecksum)) errors.push("ORCHESTRATOR_GRAPH_CHECKSUM_MISMATCH");
  try { TaskGraphSchema.parse(graph); } catch { errors.push("ORCHESTRATOR_GRAPH_INVALID"); }
  try { validateFileScopes(graph.tasks); } catch (error) { if (error instanceof OrchestratorError) errors.push(error.code); else errors.push("TASK_FILE_SCOPE_INVALID"); }
  const ids = new Set(graph.tasks.map((task) => task.id));
  for (const task of graph.tasks) {
    if (!infrastructure.has(task.taskType) && (!task.requirementReferences?.length || !task.planningReferences?.length)) errors.push("TASK_TRACEABILITY_MISSING");
    if (!task.role || !["lead", "planner-architect", "design", "implementation", "qa-release"].includes(task.role)) errors.push("ORCHESTRATOR_GRAPH_INVALID");
    if (task.dependencies.some((dependency) => !ids.has(dependency))) errors.push("ORCHESTRATOR_GRAPH_INVALID");
    try { validateToolPolicy(task); } catch (error) { if (error instanceof OrchestratorError) errors.push(error.code); }
    if (!validateTaskCapabilityBinding(task).valid) errors.push("TASK_CAPABILITY_BINDING_INVALID");
    if (task.allowedTools.some((tool) => task.deniedTools?.includes(tool))) errors.push("TASK_TOOL_POLICY_VIOLATION");
    if (task.estimatedContextBytes && policy && task.estimatedContextBytes > policy.maxContextBytes) errors.push("TASK_SKILL_CONTEXT_EXCEEDED");
    if (task.repairOfTaskId && (!ids.has(task.repairOfTaskId) || task.taskType !== "repair-targeted-failure")) errors.push("TASK_REPAIR_INVALID");
    if (task.taskType.startsWith("validate-") && task.dependencies.length === 0) errors.push("ORCHESTRATOR_GRAPH_INVALID");
  }
  const release = graph.tasks.find((task) => task.taskType === "prepare-release"); if (!release || !release.dependencies.every((dependency) => graph.tasks.find((task) => task.id === dependency)?.taskType.startsWith("validate-") || graph.tasks.find((task) => task.id === dependency)?.taskType === "validate-security")) errors.push("ORCHESTRATOR_GRAPH_INVALID");
  for (const missing of validateExecutionCapabilities(graph.tasks.map((task) => task.taskType))) errors.push(`ORCHESTRATOR_EXECUTOR_MISSING:${missing}`);
  if (input) {
    const skillIds = new Set(input.approvedSkillRegistrySnapshot.skills.filter((skill) => skill.status === "approved").map((skill) => skill.id));
    for (const task of graph.tasks) for (const skill of task.allowedSkills) if (!skillIds.has(skill)) errors.push("TASK_SKILL_NOT_APPROVED");
    if (input.currentWorkflowState !== "READY_FOR_IMPLEMENTATION") errors.push("ORCHESTRATOR_WORKFLOW_STATE_INVALID");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], graphChecksum: checksumPersistedDocument({ ...graph, graphChecksum: undefined }) };
}

export function taskGraphReady(graph: TaskGraph, input: OrchestratorInput) {
  const result = validateImplementationTaskGraph(graph, input);
  const blockingReasons = [...result.errors];
  if (!input.workspaceReserved) blockingReasons.push("WORKSPACE_NOT_RESERVED");
  if (input.projectImmutable) blockingReasons.push("ORCHESTRATOR_PROJECT_IMMUTABLE");
  if (input.requiredExternalDecisionPending) blockingReasons.push("EXTERNAL_DECISION_PENDING");
  return { readyForExecution: result.valid && blockingReasons.length === 0, blockingReasons: [...new Set(blockingReasons)], warnings: result.warnings };
}
