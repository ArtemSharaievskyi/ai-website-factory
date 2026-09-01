export type ExecutionCapability = "implementation" | "runtime-lint" | "runtime-typecheck" | "runtime-tests" | "runtime-build" | "functional-qa" | "static-security";

const TASK_CAPABILITIES: Readonly<Record<string, ExecutionCapability>> = { "validate-lint": "runtime-lint", "validate-typecheck": "runtime-typecheck", "validate-unit-tests": "runtime-tests", "validate-build": "runtime-build", "validate-functional-flow": "functional-qa", "validate-security": "static-security" };
export const PRODUCTION_EXECUTION_CAPABILITIES: readonly ExecutionCapability[] = ["implementation", "runtime-lint", "runtime-typecheck", "runtime-tests", "runtime-build", "functional-qa", "static-security"];
export function taskExecutionCapability(taskType: string): ExecutionCapability | undefined { return TASK_CAPABILITIES[taskType] ?? (taskType.startsWith("implement-") || taskType.startsWith("write-") || taskType === "prepare-workspace" || taskType === "integrate-assets" || taskType === "integrate-content" || taskType === "repair-targeted-failure" ? "implementation" : undefined); }
export function executorCapabilitiesForTasks(tasks: readonly { taskType: string; requiredCapabilities?: readonly string[] }[]) {
  return [...new Set([
    ...PRODUCTION_EXECUTION_CAPABILITIES,
    ...tasks.flatMap((task) => task.requiredCapabilities ?? []),
  ])];
}
export function validateExecutionCapabilities(taskTypes: readonly string[], registered: readonly ExecutionCapability[] = PRODUCTION_EXECUTION_CAPABILITIES) { const available = new Set(registered); return [...new Set(taskTypes.flatMap((taskType) => { const capability = taskExecutionCapability(taskType); return !capability && taskType.startsWith("validate-") ? [`${taskType}:unknown`] : capability && !available.has(capability) ? [`${taskType}:${capability}`] : []; }))]; }
