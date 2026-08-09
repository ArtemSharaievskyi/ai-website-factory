import { AgentTaskSchema, type AgentTask } from "@/domain/tasks/schema";
import type { FunctionalQaReport } from "./contracts";
import { FunctionalQaError } from "./errors";

export function startFunctionalQaTask(task: AgentTask, startedAt: string): AgentTask {
  if (task.taskType !== "validate-functional-flow" || task.status !== "ready") throw new FunctionalQaError("QA_NOT_READY", "Only a READY validate-functional-flow task may start QA.");
  if (!task.allowedTools.includes("Playwright-functional")) throw new FunctionalQaError("QA_TOOL_NOT_ALLOWED", "The functional QA task lacks Playwright-functional permission.");
  return AgentTaskSchema.parse({ ...task, status: "running", startedAt });
}

export function completeFunctionalQaTask(task: AgentTask, report: FunctionalQaReport, completedAt: string): AgentTask {
  if (task.taskType !== "validate-functional-flow" || task.status !== "running") throw new FunctionalQaError("QA_NOT_READY", "Only a RUNNING functional QA task may complete.");
  const status = report.status === "passed" ? "passed" : report.status === "cancelled" ? "cancelled" : "failed";
  return AgentTaskSchema.parse({ ...task, status, completedAt, ...(report.qualityCheck.safeFailureCode ? { safeFailureCode: report.qualityCheck.safeFailureCode } : {}), blockingFailure: status !== "passed" });
}
