import { OrchestratorError } from "./errors";
import type { AgentTask } from "../domain/tasks/schema";

const read = ["filesystem-read"] as const;
const write = ["filesystem-read", "filesystem-write"] as const;
export function resolveTools(taskType: string, assetSources: string[] = []): { allowed: string[]; denied: string[] } {
  if (taskType === "prepare-workspace") return { allowed: [...write], denied: ["git-write", "Magic-Patterns-design", "npm"] };
  if (taskType.startsWith("validate-") || taskType === "prepare-release" || taskType === "write-e2e-tests") return { allowed: [...read, ...(taskType === "write-e2e-tests" ? ["filesystem-write"] : []), ...(taskType === "validate-functional-flow" ? ["Playwright-functional"] : [])], denied: ["Magic-Patterns-design", "git-write", "shell-restricted"] };
  if (taskType === "implement-database-schema" || taskType === "implement-rls-policy" || taskType === "implement-storage") return { allowed: [...write, "database-read", "database-write"], denied: ["Magic-Patterns-design", "Playwright-functional", "git-write"] };
  if (taskType === "implement-motion") return { allowed: [...write], denied: ["Magic-Patterns-design", "Playwright-functional", "git-write"] };
  const allowed: string[] = [...write];
  if (taskType.startsWith("implement-") || taskType.startsWith("write-") || taskType === "repair-targeted-failure") allowed.push("Context7-read");
  if (["implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form"].includes(taskType)) allowed.push("shadcn-registry-read");
  if (assetSources.some((source) => source === "ai-generated" || source === "ai-plus-user-supplied")) allowed.push("image-generation");
  return { allowed, denied: ["Magic-Patterns-design", "Playwright-functional", "git-write", "npm"] };
}

export function validateToolPolicy(task: AgentTask) {
  if (task.allowedTools.includes("Magic-Patterns-design") || task.allowedTools.includes("git-write")) throw new OrchestratorError("TASK_TOOL_POLICY_VIOLATION", "The task requests a tool reserved for another workflow boundary.");
  if (task.taskType.startsWith("validate-") && task.allowedTools.includes("Playwright-functional") && task.taskType !== "validate-functional-flow") throw new OrchestratorError("TASK_TOOL_POLICY_VIOLATION", "Playwright is limited to functional-flow validation.");
  if (task.taskType === "validate-functional-flow" && !task.allowedTools.includes("Playwright-functional")) throw new OrchestratorError("TASK_TOOL_POLICY_VIOLATION", "Functional-flow validation requires its controlled browser tool.");
  if (task.allowedTools.includes("Context7-read") && (!task.taskType.startsWith("implement-") && !task.taskType.startsWith("write-") && task.taskType !== "repair-targeted-failure")) throw new OrchestratorError("CONTEXT7_TOOL_NOT_ALLOWED", "Context7-read is limited to relevant implementation tasks.");
  if (task.allowedTools.includes("shadcn-registry-read") && !["implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form"].includes(task.taskType)) throw new OrchestratorError("SHADCN_TOOL_NOT_ALLOWED", "shadcn-registry-read is limited to relevant implementation tasks.");
}
