import { z } from "zod";

export const TOOLING_POLICY_VERSION = "developer-tooling-policy-v1" as const;
export const TOOL_RESULT_MAX_BYTES = 16_000 as const;

export const CapabilityIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/, "Capability IDs must use dot-separated machine identifiers.");
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

export const ToolIdSchema = z.enum([
  "openai-generation",
  "context7-read",
  "shadcn-registry-read",
  "codebase-memory-read",
  "generated-runtime-validation",
  "playwright-functional-qa",
  "controlled-edit",
]);
export type ToolId = z.infer<typeof ToolIdSchema>;

export const ToolOperationIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Tool operations must be stable machine identifiers.");
export type ToolOperationId = z.infer<typeof ToolOperationIdSchema>;

export const ToolMutationModeSchema = z.enum([
  "READ_ONLY",
  "VALIDATION_EXECUTION",
  "CONTROLLED_TRANSFORM",
  "MUTATION_VIA_CHANGE_PROPOSAL",
]);
export type ToolMutationMode = z.infer<typeof ToolMutationModeSchema>;

export const ToolNetworkModeSchema = z.enum([
  "NO_NETWORK",
  "APPROVED_EXTERNAL_READ_ONLY",
  "CURRENT_EXISTING_INTEGRATION",
]);
export type ToolNetworkMode = z.infer<typeof ToolNetworkModeSchema>;

export const ToolWorkspaceScopeSchema = z.enum([
  "NONE",
  "CURRENT_PROJECT",
  "CURRENT_TASK_WORKSPACE",
]);
export type ToolWorkspaceScope = z.infer<typeof ToolWorkspaceScopeSchema>;

export const ToolAvailabilitySchema = z.enum([
  "AVAILABLE",
  "OPTIONAL_UNAVAILABLE",
  "DEFERRED",
]);

export const ToolResultPolicySchema = z
  .object({
    maxBytes: z.number().int().positive().max(100_000),
    maxLineBytes: z.number().int().positive().max(20_000),
    redactionPolicy: z.string().min(1),
  })
  .strict();
export type ToolResultPolicy = z.infer<typeof ToolResultPolicySchema>;

export const ToolOperationDefinitionSchema = z
  .object({
    operationId: ToolOperationIdSchema,
    requiredCapabilities: z.array(CapabilityIdSchema),
    mutationMode: ToolMutationModeSchema,
    networkMode: ToolNetworkModeSchema,
    workspaceScope: ToolWorkspaceScopeSchema,
    executorId: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    inputSchemaRef: z.string().min(1),
    outputSchemaRef: z.string().min(1),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    resultPolicy: ToolResultPolicySchema,
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.mutationMode === "MUTATION_VIA_CHANGE_PROPOSAL" && operation.workspaceScope === "NONE") {
      context.addIssue({ code: "custom", path: ["workspaceScope"], message: "Mutation proposals must be project-scoped." });
    }
    if (operation.networkMode === "APPROVED_EXTERNAL_READ_ONLY" && operation.mutationMode !== "READ_ONLY") {
      context.addIssue({ code: "custom", path: ["mutationMode"], message: "External network operations must be read-only." });
    }
  });
export type ToolOperationDefinition = z.infer<typeof ToolOperationDefinitionSchema>;

export const ToolDefinitionSchema = z
  .object({
    id: ToolIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    kind: z.enum(["agent-transport", "developer-tool"]),
    operations: z.array(ToolOperationDefinitionSchema).min(1),
    availability: ToolAvailabilitySchema,
  })
  .strict()
  .superRefine((definition, context) => {
    const operationIds = definition.operations.map((operation) => operation.operationId);
    if (new Set(operationIds).size !== operationIds.length) {
      context.addIssue({ code: "custom", path: ["operations"], message: "Tool operation IDs must be unique within a tool." });
    }
  });
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const CapabilityOperationReferenceSchema = z
  .object({ toolId: ToolIdSchema, operationId: ToolOperationIdSchema })
  .strict();

export const CapabilityDefinitionSchema = z
  .object({
    id: CapabilityIdSchema,
    description: z.string().min(1),
    eligibleOperations: z.array(CapabilityOperationReferenceSchema),
    taskTypes: z.array(z.string().min(1)),
    availability: ToolAvailabilitySchema,
  })
  .strict();
export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;

const ToolInputSchema = z.record(z.string(), z.unknown());
export type ToolInput = z.infer<typeof ToolInputSchema>;

export const ToolRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    projectId: z.string().uuid(),
    projectVersion: z.number().int().positive(),
    taskId: z.string().uuid(),
    toolId: z.string().min(1),
    operationId: ToolOperationIdSchema,
    input: ToolInputSchema,
  })
  .strict();
export type ToolRequest = z.infer<typeof ToolRequestSchema>;

export const ToolProjectScopeSchema = z
  .object({
    projectId: z.string().uuid(),
    projectVersion: z.number().int().positive(),
    taskId: z.string().uuid(),
    workspaceIdentity: z.string().min(1),
    workspaceReference: z.string().min(1),
    allowedFileScopes: z.array(z.string().min(1)),
    current: z.boolean(),
    mutable: z.boolean(),
  })
  .strict();
export type ToolProjectScope = z.infer<typeof ToolProjectScopeSchema>;

export const ToolExecutionContextSchema = z
  .object({
    projectId: z.string().uuid(),
    projectVersion: z.number().int().positive(),
    taskId: z.string().uuid(),
    workspaceIdentity: z.string().min(1),
    workspaceReference: z.string().min(1),
    policyVersion: z.literal(TOOLING_POLICY_VERSION),
  })
  .strict();
export type ToolExecutionContext = z.infer<typeof ToolExecutionContextSchema>;

export const ToolResultSchema = z
  .object({
    toolId: ToolIdSchema,
    operationId: ToolOperationIdSchema,
    status: z.enum(["passed", "failed", "denied", "cancelled"]),
    contentTrust: z.enum(["HOST_VALIDATED", "UNTRUSTED_EXTERNAL"]),
    data: z.record(z.string(), z.unknown()),
    summary: z.string().max(20_000),
    stdout: z.string().max(20_000).optional(),
    stderr: z.string().max(20_000).optional(),
    evidenceIdentity: z.array(z.string().min(1).max(300)).max(8),
    durationMs: z.number().int().nonnegative(),
    redactionApplied: z.boolean(),
    outputTruncated: z.boolean(),
    retryable: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    if (Buffer.byteLength(JSON.stringify(result.data), "utf8") > TOOL_RESULT_MAX_BYTES) context.addIssue({ code: "custom", path: ["data"], message: "Tool result data exceeds the context bound." });
    for (const field of ["summary", "stdout", "stderr"] as const) {
      const value = result[field];
      if (value !== undefined && Buffer.byteLength(value, "utf8") > TOOL_RESULT_MAX_BYTES) context.addIssue({ code: "custom", path: [field], message: "Tool result text exceeds the context bound." });
    }
  });
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const ToolAuthorityDecisionSchema = z
  .object({
    allowed: z.boolean(),
    code: z.enum([
      "ALLOWED",
      "UNKNOWN_TOOL",
      "UNKNOWN_OPERATION",
      "TOOL_UNAVAILABLE",
      "AGENT_TOOL_NOT_ALLOWED",
      "TASK_CAPABILITY_MISSING",
      "TASK_SCOPE_INVALID",
      "PROJECT_SCOPE_INVALID",
      "TASK_NOT_CURRENT",
      "INPUT_NOT_ALLOWED",
      "EXECUTOR_NOT_TRUSTED",
      "HOST_CONTEXT_UNTRUSTED",
    ]),
    toolId: z.string().optional(),
    operationId: z.string().optional(),
    requiredCapabilities: z.array(CapabilityIdSchema),
    taskCapabilities: z.array(CapabilityIdSchema),
    executorId: z.string().optional(),
    hostContextIdentity: z.string().min(1).max(300).optional(),
  })
  .strict();
export type ToolAuthorityDecision = z.infer<typeof ToolAuthorityDecisionSchema>;
