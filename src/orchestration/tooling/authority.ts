import type { AgentDefinition } from "@/domain/agents/schema";
import type { AgentTask } from "@/domain/tasks/schema";
import { ToolAuthorityDecisionSchema, ToolProjectScopeSchema, type CapabilityId, type ToolAuthorityDecision, type ToolOperationDefinition, type ToolProjectScope, type ToolRequest } from "@/domain/tooling/schema";
import { isPathWithinToolScopes } from "@/domain/tooling/path-policy";
import { canonicalToolId, CAPABILITY_REGISTRY, getOperationDefinition, getToolDefinition, registeredToolInputIsValid, TOOL_REGISTRY } from "./registry";
import { REGISTERED_TOOL_EXECUTOR_IDS } from "./executor-ids";

const unique = (values: readonly string[]) => [...new Set(values)];

export function deriveTaskCapabilities(task: Pick<AgentTask, "taskType" | "allowedTools">) {
  void task.allowedTools;
  const capabilities = CAPABILITY_REGISTRY.filter((capability) => capability.taskTypes.some((pattern) => pattern.endsWith("*") ? task.taskType.startsWith(pattern.slice(0, -1)) : pattern === task.taskType)).map((capability) => capability.id);
  return unique(capabilities) as CapabilityId[];
}

export function taskCapabilitiesFor(task: Pick<AgentTask, "taskType" | "allowedTools"> & { requiredCapabilities?: readonly string[] }) {
  const derived = deriveTaskCapabilities(task);
  if (task.requiredCapabilities?.length) return unique(task.requiredCapabilities.filter((capability) => derived.includes(capability as CapabilityId))) as CapabilityId[];
  return derived;
}

const forbiddenInputKeys = new Set([
  "agentId",
  "capability",
  "command",
  "cwd",
  "executor",
  "networkUrl",
  "permissionOverride",
  "registryUrl",
  "shell",
  "toolId",
  "workspacePath",
  "workspaceRoot",
]);

function hasForbiddenInput(value: unknown, depth = 0): boolean {
  if (depth > 4 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenInput(item, depth + 1));
  return Object.entries(value).some(([key, nested]) => forbiddenInputKeys.has(key) || hasForbiddenInput(nested, depth + 1));
}

function inputIsSafe(request: ToolRequest, operation: ToolOperationDefinition, projectScope: ImmutableToolProjectScope, taskFileScopes: readonly string[]) {
  if (!registeredToolInputIsValid(request.toolId, operation.operationId, request.input)) return false;
  if (hasForbiddenInput(request.input)) return false;
  if (Buffer.byteLength(JSON.stringify(request.input), "utf8") > 20_000) return false;
  if (JSON.stringify(request.input).match(/https?:\/\//i)) return false;
  if (operation.operationId === "get-relevant-source") {
    const selectors = [request.input.file, request.input.relativePath].filter((candidate): candidate is unknown => candidate !== undefined);
    if (selectors.length > 1) return false;
    if (selectors.some((candidate) => typeof candidate !== "string" || !isPathWithinToolScopes(candidate, projectScope.allowedFileScopes) || !isPathWithinToolScopes(candidate, taskFileScopes))) return false;
  } else if ("file" in request.input || "relativePath" in request.input) {
    return false;
  }
  if (["install-locked", "npm-ci", "lint", "typecheck", "unit-test", "build", "run-functional-flow"].includes(operation.operationId) && Object.keys(request.input).length > 0) return false;
  return true;
}

const deny = (code: ToolAuthorityDecision["code"], taskCapabilities: readonly string[], toolId?: string, operationId?: string, executorId?: string): ToolAuthorityDecision => ToolAuthorityDecisionSchema.parse({ allowed: false, code, ...(toolId ? { toolId } : {}), ...(operationId ? { operationId } : {}), requiredCapabilities: [], taskCapabilities, ...(executorId ? { executorId } : {}) });

function scopeAllows(operation: ToolOperationDefinition, scope: ImmutableToolProjectScope) {
  if (!scope.current) return false;
  if (operation.workspaceScope === "CURRENT_TASK_WORKSPACE" && (!scope.workspaceIdentity || !scope.workspaceReference)) return false;
  if (operation.mutationMode === "VALIDATION_EXECUTION" && !scope.mutable) return false;
  return true;
}

export type ToolAuthorityInput = {
  request: ToolRequest;
  task: AgentTask;
  hostContext: ToolHostContext;
  agentDefinition?: AgentDefinition;
};

type ImmutableToolProjectScope = Omit<ToolProjectScope, "allowedFileScopes"> & { readonly allowedFileScopes: readonly string[] };
const hostContextBrand: unique symbol = Symbol("factory-host-context");

export type ToolHostContext = Readonly<{
  currentScope: ImmutableToolProjectScope;
  trustedExecutorIds: readonly string[];
  [hostContextBrand]: true;
}>;

export function createToolHostContext(currentScope: ToolProjectScope, trustedExecutorIds: readonly string[] = []): ToolHostContext {
  const parsedScope = ToolProjectScopeSchema.parse(currentScope);
  if (trustedExecutorIds.some((executorId) => !REGISTERED_TOOL_EXECUTOR_IDS.includes(executorId as typeof REGISTERED_TOOL_EXECUTOR_IDS[number]))) throw new Error("Tool host context contains an unregistered executor identity.");
  return Object.freeze({ currentScope: Object.freeze({ ...parsedScope, allowedFileScopes: Object.freeze([...parsedScope.allowedFileScopes]) }), trustedExecutorIds: Object.freeze([...trustedExecutorIds]), [hostContextBrand]: true as const });
}

function authorizeToolRequestInternal(input: ToolAuthorityInput, validateInput: boolean): ToolAuthorityDecision {
  const request = input.request.toolId === canonicalToolId(input.request.toolId) ? input.request : { ...input.request, toolId: canonicalToolId(input.request.toolId) };
  const taskCapabilities = taskCapabilitiesFor(input.task);
  const projectScope = input.hostContext.currentScope;
  if (request.projectId !== input.task.projectId || request.projectVersion !== input.task.projectVersion || request.taskId !== input.task.id || projectScope.projectId !== input.task.projectId || projectScope.projectVersion !== input.task.projectVersion || projectScope.taskId !== input.task.id) return deny("PROJECT_SCOPE_INVALID", taskCapabilities, request.toolId, request.operationId);
  if (!["ready", "running"].includes(input.task.status)) return deny("TASK_NOT_CURRENT", taskCapabilities, request.toolId, request.operationId);
  const tool = getToolDefinition(request.toolId);
  if (!tool) return deny("UNKNOWN_TOOL", taskCapabilities, request.toolId, request.operationId);
  const operation = getOperationDefinition(request.toolId, request.operationId);
  if (!operation) return deny("UNKNOWN_OPERATION", taskCapabilities, request.toolId, request.operationId);
  if (tool.availability !== "AVAILABLE") return deny("TOOL_UNAVAILABLE", taskCapabilities, tool.id, operation.operationId, operation.executorId);
  if (!scopeAllows(operation, projectScope)) return deny("TASK_SCOPE_INVALID", taskCapabilities, tool.id, operation.operationId, operation.executorId);
  if (validateInput && !inputIsSafe(request, operation, projectScope, input.task.fileScopes)) return deny("INPUT_NOT_ALLOWED", taskCapabilities, tool.id, operation.operationId, operation.executorId);
  const isAgentAuthorized = input.agentDefinition?.allowedTools.includes(tool.id) && input.agentDefinition.supportedTaskTypes.includes(input.task.taskType);
  const isHostAuthorized = input.hostContext.trustedExecutorIds.includes(operation.executorId);
  if (!isAgentAuthorized && !isHostAuthorized) return deny(input.agentDefinition ? "AGENT_TOOL_NOT_ALLOWED" : "EXECUTOR_NOT_TRUSTED", taskCapabilities, tool.id, operation.operationId, operation.executorId);
  if (!operation.requiredCapabilities.every((capability) => taskCapabilities.includes(capability))) return ToolAuthorityDecisionSchema.parse({ allowed: false, code: "TASK_CAPABILITY_MISSING", toolId: tool.id, operationId: operation.operationId, requiredCapabilities: operation.requiredCapabilities, taskCapabilities, executorId: operation.executorId });
  return ToolAuthorityDecisionSchema.parse({ allowed: true, code: "ALLOWED", toolId: tool.id, operationId: operation.operationId, requiredCapabilities: operation.requiredCapabilities, taskCapabilities, executorId: operation.executorId });
}

export function authorizeToolRequest(input: ToolAuthorityInput): ToolAuthorityDecision {
  return authorizeToolRequestInternal(input, true);
}

export function resolveAuthorizedToolOperations(input: Omit<ToolAuthorityInput, "request"> & { toolIds?: readonly string[] }) {
  const taskToolIds = new Set(input.task.allowedTools.map(canonicalToolId));
  const candidateIds = input.toolIds ?? (input.agentDefinition ? input.agentDefinition.allowedTools.filter((toolId) => taskToolIds.has(toolId)) : input.task.allowedTools);
  const taskCapabilities = taskCapabilitiesFor(input.task);
  const result: Array<{ toolId: string; operationId: string }> = [];
  for (const candidateId of candidateIds) {
    const toolId = canonicalToolId(candidateId);
    const tool = getToolDefinition(toolId);
    if (!tool || tool.kind !== "developer-tool") continue;
    for (const operation of tool.operations) {
      const request: ToolRequest = { requestId: "00000000-0000-4000-8000-000000000000", projectId: input.task.projectId, projectVersion: input.task.projectVersion, taskId: input.task.id, toolId, operationId: operation.operationId, input: {} };
      const decision = authorizeToolRequestInternal({ ...input, request }, false);
      if (decision.allowed && taskCapabilities.length >= 0) result.push({ toolId, operationId: operation.operationId });
    }
  }
  return result;
}

export function assertToolRegistryCurrent() {
  return TOOL_REGISTRY;
}
