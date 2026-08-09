import { z } from "zod";

export const AgentIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Agent IDs must be lowercase machine identifiers.");
export const AgentRoleSchema = z.enum(["generation", "implementation", "review"]);
export const CapabilityIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/, "Capability IDs must use dot-separated machine identifiers.");
export const AgentToolIdSchema = z.enum(["openai-generation", "context7-read", "shadcn-registry-read", "codebase-memory-read"]);
export const SkillIdSchema = z.string().regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/, "Skill IDs must be stable machine identifiers.");
export const AgentTaskTypeSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Task type references must be machine identifiers.");
export const AgentVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "Agent versions must use semantic versioning.");
export const ContractReferenceSchema = z.string().regex(/^[a-z][a-z0-9-]*\.(?:input|output)$/, "Contract references must identify an agent input or output contract.");

export const AgentContextCategorySchema = z.enum([
  "ORIGINAL_PROMPT",
  "SUPPLIED_FILES_METADATA",
  "CLARIFICATION_SESSION",
  "PROJECT_BRIEF",
  "PLANNING_PACKAGE",
  "SELECTED_DESIGN",
  "TASK_SLICE",
  "CODEBASE_CONTEXT",
  "VALIDATION_DIAGNOSTIC",
  "PREVIOUS_FINDINGS",
  "PROJECT_MEMORY_SNAPSHOT",
]);
export type AgentContextCategory = z.infer<typeof AgentContextCategorySchema>;

export const AgentContextPolicySchema = z.object({
  version: z.string().min(1),
  allowedCategories: z.array(AgentContextCategorySchema).min(1),
  maxBytes: z.number().int().positive(),
  maxItems: z.number().int().positive(),
}).strict().superRefine((policy, context) => {
  if (new Set(policy.allowedCategories).size !== policy.allowedCategories.length) context.addIssue({ code: "custom", path: ["allowedCategories"], message: "Context categories must be unique." });
});
export type AgentContextPolicy = z.infer<typeof AgentContextPolicySchema>;

export const AgentExecutionPolicySchema = z.object({
  aiGenerationAllowed: z.boolean(),
  retryClass: z.enum(["none", "bounded-provider", "bounded-task"]),
  cancellationSupported: z.boolean(),
  concurrencyClass: z.enum(["single-flight", "bounded", "exclusive-write"]),
  requiresExplicitApprovalBeforeTransition: z.boolean(),
}).strict();
export type AgentExecutionPolicy = z.infer<typeof AgentExecutionPolicySchema>;

export const AgentContractReferenceSchema = z.object({ schemaId: ContractReferenceSchema, version: z.string().min(1) }).strict();
export type AgentContractReference = z.infer<typeof AgentContractReferenceSchema>;

export const AgentDefinitionSchema = z.object({
  agentId: AgentIdSchema,
  displayName: z.string().min(1),
  role: AgentRoleSchema,
  version: AgentVersionSchema,
  capabilities: z.array(CapabilityIdSchema).min(1),
  supportedTaskTypes: z.array(AgentTaskTypeSchema).min(1),
  allowedTools: z.array(AgentToolIdSchema),
  allowedSkillIds: z.array(SkillIdSchema),
  contextPolicy: AgentContextPolicySchema,
  inputContract: AgentContractReferenceSchema,
  outputContract: AgentContractReferenceSchema,
  promptOwner: z.string().min(1),
  promptVersion: z.string().min(1),
  policyVersions: z.object({ context: z.string().min(1), execution: z.string().min(1) }).strict(),
  executionPolicy: AgentExecutionPolicySchema,
  readOnly: z.boolean(),
}).strict().superRefine((definition, context) => {
  if (new Set(definition.capabilities).size !== definition.capabilities.length) context.addIssue({ code: "custom", path: ["capabilities"], message: "Capabilities must be unique." });
  if (new Set(definition.supportedTaskTypes).size !== definition.supportedTaskTypes.length) context.addIssue({ code: "custom", path: ["supportedTaskTypes"], message: "Supported task types must be unique." });
  if (definition.role === "review" && definition.executionPolicy.concurrencyClass === "exclusive-write") context.addIssue({ code: "custom", path: ["executionPolicy", "concurrencyClass"], message: "Reviewer agents cannot use exclusive-write execution." });
  if (definition.role === "review" && !definition.readOnly) context.addIssue({ code: "custom", path: ["readOnly"], message: "Reviewer agents must be read-only." });
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
