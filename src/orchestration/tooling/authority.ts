import type { AgentDefinition } from "@/domain/agents/schema";
import type { AgentTask } from "@/domain/tasks/schema";
import { ToolAuthorityDecisionSchema, type CapabilityId, type ToolAuthorityDecision, type ToolOperationDefinition, type ToolRequest } from "@/domain/tooling/schema";
import { isPathWithinToolScopes } from "@/domain/tooling/path-policy";
import { canonicalToolId, CAPABILITY_REGISTRY, getOperationDefinition, getToolDefinition, registeredToolInputIsValid, TOOL_REGISTRY } from "./registry";
import { hostAgentIdentityMatches, hostTaskIdentityMatches, isTrustedToolHostContext, type ToolHostContext } from "./host-context";

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

function inputIsSafe(request: ToolRequest, operation: ToolOperationDefinition, projectScope: ToolHostContext["currentScope"], taskFileScopes: readonly string[]) {
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

const deny = (code: ToolAuthorityDecision["code"], taskCapabilities: readonly string[], toolId?: string, operationId?: string, executorId?: string, hostContextIdentity?: string): ToolAuthorityDecision => ToolAuthorityDecisionSchema.parse({ allowed: false, code, ...(toolId ? { toolId } : {}), ...(operationId ? { operationId } : {}), requiredCapabilities: [], taskCapabilities, ...(executorId ? { executorId } : {}), ...(hostContextIdentity ? { hostContextIdentity } : {}) });

function scopeAllows(operation: ToolOperationDefinition, scope: ToolHostContext["currentScope"]) {
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

function authorizeToolRequestInternal(input: ToolAuthorityInput, validateInput: boolean): ToolAuthorityDecision {
  const request = input.request.toolId === canonicalToolId(input.request.toolId) ? input.request : { ...input.request, toolId: canonicalToolId(input.request.toolId) };
  if (!isTrustedToolHostContext(input.hostContext)) return deny("HOST_CONTEXT_UNTRUSTED", [], request.toolId, request.operationId);
  const hostContext = input.hostContext;
  const taskCapabilities = hostContext.taskCapabilities;
  const projectScope = hostContext.currentScope;
  const inputTaskCapabilities = taskCapabilitiesFor(input.task);
  if (request.projectId !== hostContext.projectId || request.projectVersion !== hostContext.projectVersion || request.taskId !== hostContext.taskId || projectScope.projectId !== hostContext.projectId || projectScope.projectVersion !== hostContext.projectVersion || projectScope.taskId !== hostContext.taskId) return deny("PROJECT_SCOPE_INVALID", taskCapabilities, request.toolId, request.operationId, undefined, hostContext.identity);
  if (!hostTaskIdentityMatches(hostContext, input.task, inputTaskCapabilities)) return deny("TASK_SCOPE_INVALID", taskCapabilities, request.toolId, request.operationId, undefined, hostContext.identity);
  if (input.agentDefinition && !hostAgentIdentityMatches(hostContext, input.agentDefinition)) return deny("AGENT_TOOL_NOT_ALLOWED", taskCapabilities, request.toolId, request.operationId, undefined, hostContext.identity);
  if (!["ready", "running"].includes(input.task.status)) return deny("TASK_NOT_CURRENT", taskCapabilities, request.toolId, request.operationId, undefined, hostContext.identity);
  const tool = getToolDefinition(request.toolId);
  if (!tool) return deny("UNKNOWN_TOOL", taskCapabilities, request.toolId, request.operationId, undefined, hostContext.identity);
  const operation = getOperationDefinition(request.toolId, request.operationId);
  if (!operation) return deny("UNKNOWN_OPERATION", taskCapabilities, request.toolId, request.operationId, undefined, hostContext.identity);
  if (tool.availability !== "AVAILABLE") return deny("TOOL_UNAVAILABLE", taskCapabilities, tool.id, operation.operationId, operation.executorId, hostContext.identity);
  if (!scopeAllows(operation, projectScope)) return deny("TASK_SCOPE_INVALID", taskCapabilities, tool.id, operation.operationId, operation.executorId, hostContext.identity);
  if (validateInput && !inputIsSafe(request, operation, projectScope, hostContext.taskFileScopes)) return deny("INPUT_NOT_ALLOWED", taskCapabilities, tool.id, operation.operationId, operation.executorId, hostContext.identity);
  const isAgentAuthorized = Boolean(input.agentDefinition && hostContext.agentId && hostContext.agentAllowedToolIds.includes(tool.id) && hostContext.agentSupportedTaskTypes.includes(hostContext.taskType));
  const isHostAuthorized = hostContext.trustedExecutorIds.includes(operation.executorId as typeof hostContext.trustedExecutorIds[number]);
  if (!isAgentAuthorized && !isHostAuthorized) return deny(input.agentDefinition ? "AGENT_TOOL_NOT_ALLOWED" : "EXECUTOR_NOT_TRUSTED", taskCapabilities, tool.id, operation.operationId, operation.executorId, hostContext.identity);
  if (!operation.requiredCapabilities.every((capability) => taskCapabilities.includes(capability))) return ToolAuthorityDecisionSchema.parse({ allowed: false, code: "TASK_CAPABILITY_MISSING", toolId: tool.id, operationId: operation.operationId, requiredCapabilities: operation.requiredCapabilities, taskCapabilities, executorId: operation.executorId, hostContextIdentity: hostContext.identity });
  return ToolAuthorityDecisionSchema.parse({ allowed: true, code: "ALLOWED", toolId: tool.id, operationId: operation.operationId, requiredCapabilities: operation.requiredCapabilities, taskCapabilities, executorId: operation.executorId, hostContextIdentity: hostContext.identity });
}

export function authorizeToolRequest(input: ToolAuthorityInput): ToolAuthorityDecision {
  return authorizeToolRequestInternal(input, true);
}

export function resolveAuthorizedToolOperations(input: Omit<ToolAuthorityInput, "request"> & { toolIds?: readonly string[] }) {
  if (!isTrustedToolHostContext(input.hostContext)) return [];
  const taskToolIds = new Set(input.hostContext.taskAllowedToolIds.map(canonicalToolId));
  const candidateIds = input.toolIds ?? (input.agentDefinition ? input.hostContext.agentAllowedToolIds.filter((toolId) => taskToolIds.has(toolId)) : input.hostContext.taskAllowedToolIds);
  const result: Array<{ toolId: string; operationId: string }> = [];
  for (const candidateId of candidateIds) {
    const toolId = canonicalToolId(candidateId);
    const tool = getToolDefinition(toolId);
    if (!tool || tool.kind !== "developer-tool") continue;
    for (const operation of tool.operations) {
      const request: ToolRequest = { requestId: "00000000-0000-4000-8000-000000000000", projectId: input.task.projectId, projectVersion: input.task.projectVersion, taskId: input.task.id, toolId, operationId: operation.operationId, input: {} };
      const decision = authorizeToolRequestInternal({ ...input, request }, false);
      if (decision.allowed) result.push({ toolId, operationId: operation.operationId });
    }
  }
  return result;
}

export function assertToolRegistryCurrent() {
  return TOOL_REGISTRY;
}
