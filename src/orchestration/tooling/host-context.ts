import type { AgentDefinition } from "@/domain/agents/schema";
import { CapabilityIdSchema, ToolIdSchema, ToolProjectScopeSchema, type CapabilityId, type ToolId, type ToolProjectScope } from "@/domain/tooling/schema";
import type { AgentTask } from "@/domain/tasks/schema";
import { REGISTERED_TOOL_EXECUTOR_IDS, type RegisteredToolExecutorId } from "./executor-ids";

type HostTaskSeed = Pick<AgentTask, "id" | "projectId" | "projectVersion" | "taskType" | "fileScopes" | "allowedTools"> & {
  taskCapabilities: readonly string[];
};

type HostAgentSeed = Pick<AgentDefinition, "agentId" | "allowedTools" | "supportedTaskTypes">;

export type ToolHostContextSeed = {
  currentScope: ToolProjectScope;
  task: HostTaskSeed;
  agentDefinition?: HostAgentSeed;
  trustedExecutorIds: readonly RegisteredToolExecutorId[];
};

type ImmutableToolProjectScope = Omit<ToolProjectScope, "allowedFileScopes"> & { readonly allowedFileScopes: readonly string[] };

const hostContextBrand: unique symbol = Symbol("factory-host-context");
const trustedHostContexts = new WeakSet<object>();

export type ToolHostContext = Readonly<{
  identity: string;
  currentScope: ImmutableToolProjectScope;
  projectId: string;
  projectVersion: number;
  taskId: string;
  taskType: string;
  taskCapabilities: readonly CapabilityId[];
  taskFileScopes: readonly string[];
  taskAllowedToolIds: readonly string[];
  agentId?: string;
  agentAllowedToolIds: readonly ToolId[];
  agentSupportedTaskTypes: readonly string[];
  trustedExecutorIds: readonly RegisteredToolExecutorId[];
  [hostContextBrand]: true;
}>;

const sameValues = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * This constructor is intentionally not exported from the tooling barrel.
 * Only a host adapter with canonical task/agent state should call it. Runtime
 * authorization additionally checks the private WeakSet, so structural copies
 * and caller-created lookalikes cannot authorize a request.
 */
export function createHostToolContext(seed: ToolHostContextSeed): ToolHostContext {
  const scope = ToolProjectScopeSchema.parse(seed.currentScope);
  const taskCapabilities = CapabilityIdSchema.array().parse([...seed.task.taskCapabilities]);
  const taskFileScopes = [...seed.task.fileScopes];
  const taskAllowedToolIds = [...seed.task.allowedTools];
  const trustedExecutorIds = [...seed.trustedExecutorIds];

  if (scope.projectId !== seed.task.projectId || scope.projectVersion !== seed.task.projectVersion || scope.taskId !== seed.task.id) {
    throw new Error("Host task identity does not match the current project scope.");
  }
  if (trustedExecutorIds.some((executorId) => !REGISTERED_TOOL_EXECUTOR_IDS.includes(executorId))) {
    throw new Error("Host context contains an unregistered executor identity.");
  }

  const agentAllowedToolIds = seed.agentDefinition ? ToolIdSchema.array().parse([...seed.agentDefinition.allowedTools]) : [];
  const agentSupportedTaskTypes = seed.agentDefinition ? [...seed.agentDefinition.supportedTaskTypes] : [];
  if (seed.agentDefinition && !agentSupportedTaskTypes.includes(seed.task.taskType)) {
    throw new Error("Host agent does not support the current TaskGraph task type.");
  }

  const context = Object.freeze({
    identity: `host:${seed.agentDefinition?.agentId ?? "executor"}:${scope.projectId}:${scope.projectVersion}:${scope.taskId}`,
    currentScope: Object.freeze({ ...scope, allowedFileScopes: Object.freeze([...scope.allowedFileScopes]) }),
    projectId: scope.projectId,
    projectVersion: scope.projectVersion,
    taskId: scope.taskId,
    taskType: seed.task.taskType,
    taskCapabilities: Object.freeze([...taskCapabilities]),
    taskFileScopes: Object.freeze(taskFileScopes),
    taskAllowedToolIds: Object.freeze(taskAllowedToolIds),
    ...(seed.agentDefinition ? { agentId: seed.agentDefinition.agentId } : {}),
    agentAllowedToolIds: Object.freeze(agentAllowedToolIds),
    agentSupportedTaskTypes: Object.freeze(agentSupportedTaskTypes),
    trustedExecutorIds: Object.freeze(trustedExecutorIds),
    [hostContextBrand]: true as const,
  });
  trustedHostContexts.add(context);
  return context;
}

export function isTrustedToolHostContext(value: unknown): value is ToolHostContext {
  return typeof value === "object" && value !== null && trustedHostContexts.has(value);
}

export function hostTaskIdentityMatches(context: ToolHostContext, task: Pick<AgentTask, "id" | "projectId" | "projectVersion" | "taskType" | "fileScopes" | "allowedTools">, taskCapabilities: readonly string[]) {
  return context.projectId === task.projectId
    && context.projectVersion === task.projectVersion
    && context.taskId === task.id
    && context.taskType === task.taskType
    && sameValues(context.taskFileScopes, task.fileScopes)
    && sameValues(context.taskAllowedToolIds, task.allowedTools)
    && sameValues(context.taskCapabilities, taskCapabilities);
}

export function hostAgentIdentityMatches(context: ToolHostContext, agentDefinition: Pick<AgentDefinition, "agentId" | "allowedTools" | "supportedTaskTypes">) {
  return context.agentId === agentDefinition.agentId
    && sameValues(context.agentAllowedToolIds, agentDefinition.allowedTools)
    && sameValues(context.agentSupportedTaskTypes, agentDefinition.supportedTaskTypes);
}
