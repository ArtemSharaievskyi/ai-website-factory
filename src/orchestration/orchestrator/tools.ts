import { OrchestratorError } from "./errors";
import type { AgentTask } from "@/domain/tasks/schema";

const read = ["filesystem-read"] as const;
const write = ["filesystem-read", "filesystem-write"] as const;
const professionalDesign = ["fontpair-read", "design-quality-validation"] as const;
const frontendDesignResourceTasks = ["implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form"] as const;
export function resolveTools(taskType: string, assetSources: string[] = []): { allowed: string[]; denied: string[] } {
  if (taskType === "create-design-directions") return { allowed: [...professionalDesign, "design-source-discovery"], denied: ["git-write", "shell-restricted", "npm"] };
  if (taskType === "prepare-workspace") return { allowed: [...write], denied: ["git-write", "npm"] };
  if (taskType.startsWith("validate-") || taskType === "prepare-release" || taskType === "write-e2e-tests") return { allowed: [...read, ...(taskType.startsWith("validate-") ? ["generated-runtime-validation"] : []), ...(taskType === "write-e2e-tests" ? ["filesystem-write"] : []), ...(taskType === "validate-functional-flow" ? ["Playwright-functional", "playwright-functional-qa"] : [])], denied: ["git-write", "shell-restricted"] };
  if (taskType === "implement-database-schema" || taskType === "implement-rls-policy" || taskType === "implement-storage") return { allowed: [...write, "database-read", "database-write"], denied: ["Playwright-functional", "git-write"] };
  if (taskType === "implement-motion") return { allowed: [...write], denied: ["Playwright-functional", "git-write"] };
  const allowed: string[] = [...write];
  if (taskType.startsWith("implement-") || taskType.startsWith("write-") || taskType === "repair-targeted-failure") { allowed.push("Context7-read", "codebase-memory-read"); }
  if (["implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form"].includes(taskType)) allowed.push("shadcn-registry-read");
  if ((frontendDesignResourceTasks as readonly string[]).includes(taskType)) allowed.push("design-source-discovery");
  if (assetSources.some((source) => source === "ai-generated" || source === "ai-plus-user-supplied")) allowed.push("image-generation");
  return { allowed, denied: ["Playwright-functional", "git-write", "npm"] };
}

export function validateToolPolicy(task: AgentTask) {
  const professionalDesignRequested = task.allowedTools.some((tool) => professionalDesign.includes(tool as (typeof professionalDesign)[number]));
  if (professionalDesignRequested && task.taskType !== "create-design-directions") throw new OrchestratorError("TASK_TOOL_POLICY_VIOLATION", "Professional design integrations are limited to direction generation.");
  if (task.allowedTools.includes("design-source-discovery") && task.taskType !== "create-design-directions" && !(frontendDesignResourceTasks as readonly string[]).includes(task.taskType)) throw new OrchestratorError("TASK_TOOL_POLICY_VIOLATION", "Frontend design resource discovery is limited to direction generation and frontend implementation slices.");
  if (task.allowedTools.includes("git-write")) throw new OrchestratorError("TASK_TOOL_POLICY_VIOLATION", "The task requests a tool reserved for another workflow boundary.");
  if (task.taskType.startsWith("validate-") && task.allowedTools.includes("Playwright-functional") && task.taskType !== "validate-functional-flow") throw new OrchestratorError("TASK_TOOL_POLICY_VIOLATION", "Playwright is limited to functional-flow validation.");
  if (task.taskType === "validate-functional-flow" && !task.allowedTools.includes("Playwright-functional")) throw new OrchestratorError("TASK_TOOL_POLICY_VIOLATION", "Functional-flow validation requires its controlled browser tool.");
  if (task.allowedTools.includes("Context7-read") && (!task.taskType.startsWith("implement-") && !task.taskType.startsWith("write-") && task.taskType !== "repair-targeted-failure")) throw new OrchestratorError("CONTEXT7_TOOL_NOT_ALLOWED", "Context7-read is limited to relevant implementation tasks.");
  if (task.allowedTools.includes("shadcn-registry-read") && !["implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form"].includes(task.taskType)) throw new OrchestratorError("SHADCN_TOOL_NOT_ALLOWED", "shadcn-registry-read is limited to relevant implementation tasks.");
  if (task.allowedTools.includes("codebase-memory-read") && !(task.role === "implementation" || task.taskType.startsWith("implement-") || task.taskType.startsWith("write-") || task.taskType === "repair-targeted-failure")) throw new OrchestratorError("CODEBASE_MEMORY_TOOL_NOT_ALLOWED", "Codebase Memory is limited to implementation, repair, and reconciliation workflows.");
  if (task.allowedTools.includes("controlled-edit") && (task.role !== "implementation" || (!task.taskType.startsWith("implement-") && !task.taskType.startsWith("write-") && task.taskType !== "repair-targeted-failure"))) throw new OrchestratorError("TASK_TOOL_POLICY_VIOLATION", "controlled-edit is limited to implementation and repair task slices.");
}
