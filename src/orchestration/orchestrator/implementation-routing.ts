import type { TechnicalArchitecture } from "@/domain/architecture/schema";
import type { Phase7CContractPackage } from "@/domain/contracts/phase7c";
import { implementationDomainForTaskType, implementationProfileRegistry, specialistProfileIdForDomain, type ImplementationDomain, type ImplementationSpecialistId } from "@/domain/implementation/profiles";
import type { AgentTask, TaskGraph } from "@/domain/tasks/schema";

export type ImplementationRouteStatus = "ACTIVE" | "NOT_REQUIRED" | "CONTRADICTS_ARCHITECTURE" | "UNROUTABLE";

export type ImplementationTaskRoute = {
  taskId: string;
  domain?: ImplementationDomain;
  specialistProfileId?: ImplementationSpecialistId;
  owner: "specialist" | "orchestrator";
  status: ImplementationRouteStatus;
  reason: string;
};

export type SpecialistActivation = {
  frontend: "ACTIVE" | "NOT_REQUIRED";
  backend: "ACTIVE" | "NOT_REQUIRED";
  database: "ACTIVE" | "NOT_REQUIRED";
  contradictions: string[];
  missingTaskDomains: ImplementationDomain[];
};

const planIsEnabled = (value: string) => !/^(none|no\b|not required|disabled|n\/a|false|off\b|kein\w*\b)/i.test(value.trim());

export function architectureRequiresBackend(architecture: TechnicalArchitecture) {
  return architecture.serverActions.length > 0 || architecture.routeHandlers.length > 0 || planIsEnabled(architecture.authenticationPlan) || planIsEnabled(architecture.storagePlan) || planIsEnabled(architecture.emailPlan);
}

export function architectureRequiresDatabase(architecture: TechnicalArchitecture, phase7c?: Pick<Phase7CContractPackage, "databaseDecision">) {
  return phase7c?.databaseDecision.mode !== "NONE" && (Boolean(phase7c?.databaseDecision) || architecture.supabaseDatabaseRequirements.length > 0 || architecture.schemaPlan.length > 0 || architecture.rlsRequirements.length > 0);
}

function rootTaskType(task: AgentTask, taskById?: ReadonlyMap<string, AgentTask>) {
  let current = task;
  const visited = new Set<string>();
  while (current.taskType === "repair-targeted-failure" && current.repairOfTaskId && !visited.has(current.id)) {
    visited.add(current.id);
    const next = taskById?.get(current.repairOfTaskId);
    if (!next) break;
    current = next;
  }
  return current.taskType;
}

export class ImplementationOrchestrator {
  resolveTask(input: { task: AgentTask; architecture: TechnicalArchitecture; phase7c?: Pick<Phase7CContractPackage, "databaseDecision">; taskById?: ReadonlyMap<string, AgentTask> }): ImplementationTaskRoute {
    const { task, architecture, phase7c } = input;
    if (task.role !== "implementation") return { taskId: task.id, owner: "orchestrator", status: "NOT_REQUIRED", reason: "Quality and lifecycle tasks remain owned by the Factory orchestrator and QA boundary." };
    const inferredDomain = implementationDomainForTaskType(rootTaskType(task, input.taskById));
    if (!task.implementationDomain && !inferredDomain && task.taskType.startsWith("validate-")) {
      return { taskId: task.id, owner: "orchestrator", status: "NOT_REQUIRED", reason: "Deterministic validation remains owned by the Factory QA boundary." };
    }
    if (task.implementationDomain && inferredDomain && task.implementationDomain !== inferredDomain) {
      return { taskId: task.id, owner: "orchestrator", status: "UNROUTABLE", reason: "Task specialist metadata does not match its typed implementation domain." };
    }
    if (task.implementationDomain && !inferredDomain && task.taskType !== "repair-targeted-failure") {
      return { taskId: task.id, owner: "orchestrator", status: "UNROUTABLE", reason: "Explicit specialist metadata cannot authorize an unrecognized implementation task type." };
    }
    const domain = inferredDomain ?? task.implementationDomain;
    if (!domain) return { taskId: task.id, owner: "orchestrator", status: "UNROUTABLE", reason: "The typed implementation task has no approved specialist domain." };
    const architectureAllows = domain === "FRONTEND" || (domain === "BACKEND" ? architectureRequiresBackend(architecture) : architectureRequiresDatabase(architecture, phase7c));
    if (!architectureAllows) return { taskId: task.id, domain, specialistProfileId: specialistProfileIdForDomain(domain), owner: "orchestrator", status: "CONTRADICTS_ARCHITECTURE", reason: `${domain} implementation is present in the TaskGraph but the approved Architecture does not require that domain.` };
    const specialistProfileId = task.specialistProfileId ?? specialistProfileIdForDomain(domain);
    const profile = implementationProfileRegistry.get(specialistProfileId);
    if (profile.domain !== domain) return { taskId: task.id, domain, specialistProfileId, owner: "orchestrator", status: "UNROUTABLE", reason: "Task specialist metadata does not match its typed implementation domain." };
    return { taskId: task.id, domain, specialistProfileId, owner: "specialist", status: "ACTIVE", reason: `Routed by typed task intent and approved Architecture to ${profile.displayName}.` };
  }

  classifyGraph(input: { graph: TaskGraph; architecture: TechnicalArchitecture; phase7c?: Pick<Phase7CContractPackage, "databaseDecision"> }) {
    const taskById = new Map(input.graph.tasks.map((task) => [task.id, task]));
    const routes = input.graph.tasks.map((task) => this.resolveTask({ ...input, task, taskById }));
    const counts = { FRONTEND: 0, BACKEND: 0, DATABASE: 0, ORCHESTRATOR_QA_INTEGRATION: 0 };
    for (const route of routes) {
      if (route.domain) counts[route.domain] += 1;
      else counts.ORCHESTRATOR_QA_INTEGRATION += 1;
    }
    const activeDomains = new Set(routes.filter((route) => route.status === "ACTIVE" && route.domain).map((route) => route.domain!));
    const contradictions = routes.filter((route) => route.status === "CONTRADICTS_ARCHITECTURE" || route.status === "UNROUTABLE").map((route) => `${route.taskId}:${route.reason}`);
    const requiredByArchitecture: ImplementationDomain[] = ["FRONTEND", ...(architectureRequiresBackend(input.architecture) ? ["BACKEND" as const] : []), ...(architectureRequiresDatabase(input.architecture, input.phase7c) ? ["DATABASE" as const] : [])];
    const missingTaskDomains = requiredByArchitecture.filter((domain) => !activeDomains.has(domain));
    const activation: SpecialistActivation = {
      frontend: activeDomains.has("FRONTEND") ? "ACTIVE" : "NOT_REQUIRED",
      backend: activeDomains.has("BACKEND") ? "ACTIVE" : "NOT_REQUIRED",
      database: activeDomains.has("DATABASE") ? "ACTIVE" : "NOT_REQUIRED",
      contradictions,
      missingTaskDomains,
    };
    return { routes, counts, activation };
  }
}

export const implementationOrchestrator = new ImplementationOrchestrator();
