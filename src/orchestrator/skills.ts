import type { AgentTask } from "../domain/tasks/schema";
import type { ApprovedSkillSnapshot } from "./contracts";
import { OrchestratorError } from "./errors";

export function selectApprovedSkills(task: AgentTask, snapshot: ApprovedSkillSnapshot) {
  const selected = snapshot.skills.filter((skill) => skill.status === "approved" && skill.allowedRoles.includes(task.role) && skill.allowedTaskTypes.some((type) => type === task.taskType || (task.taskType.startsWith("implement-") && type === "implement-frontend") || (task.taskType.startsWith("validate-") && type === "validate-code")) && skill.requiredTools.every((tool) => task.allowedTools.includes(tool)) && !skill.forbiddenTools.some((tool) => task.allowedTools.includes(tool)) && skill.maxContextBytes >= (task.estimatedContextBytes ?? 0));
  for (const assigned of task.allowedSkills) {
    const skill = selected.find((candidate) => candidate.id === assigned);
    if (!skill) { const known = snapshot.skills.find((candidate) => candidate.id === assigned); if (!known || known.status !== "approved") throw new OrchestratorError("TASK_SKILL_NOT_APPROVED", "A task references a skill that is not currently approved."); throw new OrchestratorError("TASK_SKILL_PERMISSION_DENIED", "An approved skill is outside the task role, type, tool or context boundary."); }
  }
  return selected.filter((skill) => task.allowedSkills.includes(skill.id)).map((skill) => skill.id);
}
