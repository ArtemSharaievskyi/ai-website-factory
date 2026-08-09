import type { AgentTask } from "@/domain/tasks/schema";

export type TargetedValidationSelection = { taskId: string; validationTaskTypes: Array<"validate-unit-tests" | "validate-functional-flow" | "validate-lint" | "validate-typecheck">; reason: string };
const byScope = (task: AgentTask, pattern: RegExp) => task.fileScopes.some((scope) => pattern.test(scope));

export function selectTargetedValidation(task: AgentTask, graph: { tasks: AgentTask[] }): TargetedValidationSelection {
  const selected = new Set<TargetedValidationSelection["validationTaskTypes"][number]>(["validate-lint", "validate-typecheck"]);
  if (["implement-form", "implement-server-action", "implement-route-handler", "implement-database-schema", "implement-rls-policy", "implement-authentication", "implement-storage", "write-unit-tests", "write-integration-tests"].includes(task.taskType) || byScope(task, /test|schema|action|route|supabase|auth|storage/i)) selected.add("validate-unit-tests");
  if (["implement-form", "implement-navigation", "implement-page", "implement-authentication", "implement-storage", "implement-server-action", "implement-route-handler"].includes(task.taskType) || byScope(task, /app|component|page|route|form/i)) selected.add("validate-functional-flow");
  const available = new Set(graph.tasks.map((candidate) => candidate.taskType));
  return { taskId: task.id, validationTaskTypes: [...selected].filter((type) => available.has(type)), reason: "Deterministic ownership and file-scope mapping selected only validations relevant to the changed bounded task." };
}
