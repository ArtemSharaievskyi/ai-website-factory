import { AgentDefinitionSchema, AgentToolIdSchema, CapabilityIdSchema, type AgentDefinition } from "@/domain/agents/schema";
import { ImplementationTaskTypeSchema } from "@/domain/tasks/schema";
import { z } from "zod";

export const AGENT_TOOL_IDS = ["openai-generation", "context7-read", "shadcn-registry-read", "codebase-memory-read"] as const satisfies readonly z.infer<typeof AgentToolIdSchema>[];
export type AgentToolId = (typeof AGENT_TOOL_IDS)[number];
export const AGENT_CAPABILITY_IDS = ["requirements.clarify", "requirements.brief", "planning.architecture", "planning.content", "planning.assets", "design.directions", "design.selection", "implementation.code", "implementation.backend", "review.architecture", "review.contracts", "review.integration"] as const satisfies readonly z.infer<typeof CapabilityIdSchema>[];
export type AgentCapabilityId = (typeof AGENT_CAPABILITY_IDS)[number];

const CONTRACT_REFERENCES = new Set(["lead.input", "lead.output", "planner.input", "planner.output", "design.input", "design.output", "implementation.input", "implementation.output", "architecture-reviewer.input", "contract-auditor.input", "code-integration-reviewer.input", "review.output"]);
const CURRENT_TASK_TYPES = new Set<string>([
  ...ImplementationTaskTypeSchema.options,
  "clarify-requirements",
  "create-requirements-spec",
  "create-technical-architecture",
  "plan-content",
  "plan-assets",
  "create-design-directions",
  "review-architecture",
  "review-contracts",
  "review-code-integration",
]);
const IMPLEMENTATION_TASK_TYPES = ["prepare-workspace", "implement-project-foundation", "implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form", "implement-server-action", "implement-route-handler", "implement-database-schema", "implement-rls-policy", "implement-authentication", "implement-storage", "implement-email", "integrate-assets", "integrate-content", "implement-seo", "implement-motion", "write-unit-tests", "write-integration-tests", "write-e2e-tests", "repair-targeted-failure"];

const definition = (value: AgentDefinition) => AgentDefinitionSchema.parse(value);
export const leadAgentDefinition = definition({
  agentId: "lead", displayName: "Lead Agent", role: "generation", version: "1.0.0",
  capabilities: ["requirements.clarify", "requirements.brief"], supportedTaskTypes: ["clarify-requirements", "create-requirements-spec"],
  allowedTools: ["openai-generation"], allowedSkillIds: [],
  contextPolicy: { version: "lead-context-v1", allowedCategories: ["ORIGINAL_PROMPT", "SUPPLIED_FILES_METADATA", "CLARIFICATION_SESSION", "PROJECT_BRIEF"], maxBytes: 60000, maxItems: 40 },
  inputContract: { schemaId: "lead.input", version: "1" }, outputContract: { schemaId: "lead.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "lead.v1", policyVersions: { context: "lead-context-v1", execution: "lead-execution-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: false, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: true }, readOnly: false,
});
export const plannerAgentDefinition = definition({
  agentId: "planner", displayName: "Planner / Architect Agent", role: "generation", version: "1.0.0",
  capabilities: ["planning.architecture", "planning.content", "planning.assets"], supportedTaskTypes: ["create-technical-architecture", "plan-content", "plan-assets"],
  allowedTools: ["openai-generation", "context7-read"], allowedSkillIds: [],
  contextPolicy: { version: "planner-context-v1", allowedCategories: ["PROJECT_BRIEF", "CLARIFICATION_SESSION", "PLANNING_PACKAGE", "PREVIOUS_FINDINGS"], maxBytes: 120000, maxItems: 80 },
  inputContract: { schemaId: "planner.input", version: "1" }, outputContract: { schemaId: "planner.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "planner.v1", policyVersions: { context: "planner-context-v1", execution: "planner-execution-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: false, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: true }, readOnly: false,
});
export const designAgentDefinition = definition({
  agentId: "design", displayName: "Design Agent", role: "generation", version: "1.0.0",
  capabilities: ["design.directions", "design.selection"], supportedTaskTypes: ["create-design-directions"],
  allowedTools: ["openai-generation"], allowedSkillIds: [],
  contextPolicy: { version: "design-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "SUPPLIED_FILES_METADATA", "PREVIOUS_FINDINGS"], maxBytes: 120000, maxItems: 80 },
  inputContract: { schemaId: "design.input", version: "1" }, outputContract: { schemaId: "design.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "design.v1", policyVersions: { context: "design-context-v1", execution: "design-execution-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: false, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: true }, readOnly: false,
});
export const implementationAgentDefinition = definition({
  agentId: "implementation", displayName: "Implementation Agent", role: "implementation", version: "1.0.0",
  capabilities: ["implementation.code", "implementation.backend"], supportedTaskTypes: IMPLEMENTATION_TASK_TYPES,
  allowedTools: ["openai-generation", "context7-read", "shadcn-registry-read", "codebase-memory-read"], allowedSkillIds: [],
  contextPolicy: { version: "implementation-context-v1", allowedCategories: ["TASK_SLICE", "PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"], maxBytes: 120000, maxItems: 80 },
  inputContract: { schemaId: "implementation.input", version: "1" }, outputContract: { schemaId: "implementation.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "implementation.v1", policyVersions: { context: "implementation-context-v1", execution: "implementation-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-task", cancellationSupported: true, concurrencyClass: "exclusive-write", requiresExplicitApprovalBeforeTransition: false }, readOnly: false,
});
export const architectureReviewerAgentDefinition = definition({
  agentId: "architecture-reviewer", displayName: "Architecture Reviewer", role: "review", version: "1.0.0",
  capabilities: ["review.architecture"], supportedTaskTypes: ["review-architecture"],
  allowedTools: ["openai-generation"], allowedSkillIds: [],
  contextPolicy: { version: "architecture-review-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "PREVIOUS_FINDINGS"], maxBytes: 140000, maxItems: 60 },
  inputContract: { schemaId: "architecture-reviewer.input", version: "1" }, outputContract: { schemaId: "review.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "architecture-reviewer.v1", policyVersions: { context: "architecture-review-context-v1", execution: "architecture-review-execution-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: true, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: false }, readOnly: true,
});
export const contractAuditorAgentDefinition = definition({
  agentId: "contract-auditor", displayName: "Contract Auditor", role: "review", version: "1.0.0",
  capabilities: ["review.contracts"], supportedTaskTypes: ["review-contracts"],
  allowedTools: ["openai-generation"], allowedSkillIds: [],
  contextPolicy: { version: "contract-audit-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "PREVIOUS_FINDINGS"], maxBytes: 160000, maxItems: 80 },
  inputContract: { schemaId: "contract-auditor.input", version: "1" }, outputContract: { schemaId: "review.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "contract-auditor.v1", policyVersions: { context: "contract-audit-context-v1", execution: "contract-audit-execution-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: true, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: false }, readOnly: true,
});
export const codeIntegrationReviewerAgentDefinition = definition({
  agentId: "code-integration-reviewer", displayName: "Code / Integration Reviewer", role: "review", version: "1.0.0",
  capabilities: ["review.integration"], supportedTaskTypes: ["review-code-integration"], allowedTools: ["openai-generation"], allowedSkillIds: [],
  contextPolicy: { version: "code-integration-review-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "CODEBASE_CONTEXT", "PREVIOUS_FINDINGS"], maxBytes: 180000, maxItems: 120 },
  inputContract: { schemaId: "code-integration-reviewer.input", version: "1" }, outputContract: { schemaId: "review.output", version: "1" }, promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "code-integration-reviewer.v1", policyVersions: { context: "code-integration-review-context-v1", execution: "code-integration-review-execution-v1" }, executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: true, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: false }, readOnly: true,
});

export const agentCatalog = [leadAgentDefinition, plannerAgentDefinition, designAgentDefinition, implementationAgentDefinition, architectureReviewerAgentDefinition, contractAuditorAgentDefinition, codeIntegrationReviewerAgentDefinition] as const satisfies readonly AgentDefinition[];

export class AgentCatalogError extends Error { constructor(readonly code: "DUPLICATE_AGENT_ID" | "DUPLICATE_CAPABILITY" | "UNKNOWN_CONTRACT" | "UNKNOWN_TASK_TYPE" | "UNKNOWN_SKILL" | "AGENT_NOT_FOUND" | "CAPABILITY_NOT_SUPPORTED", message: string) { super(message); this.name = "AgentCatalogError"; } }

export function validateAgentCatalog(definitions: readonly AgentDefinition[] = agentCatalog, options: { knownSkillIds?: ReadonlySet<string> } = {}) {
  const ids = new Set<string>();
  const capabilities = new Map<string, string>();
  for (const raw of definitions) {
    const current = AgentDefinitionSchema.parse(raw);
    if (ids.has(current.agentId)) throw new AgentCatalogError("DUPLICATE_AGENT_ID", `Agent ID is duplicated: ${current.agentId}.`);
    ids.add(current.agentId);
    for (const capability of current.capabilities) {
      const owner = capabilities.get(capability);
      if (owner) throw new AgentCatalogError("DUPLICATE_CAPABILITY", `Capability ${capability} has incompatible owners ${owner} and ${current.agentId}.`);
      capabilities.set(capability, current.agentId);
    }
    for (const taskType of current.supportedTaskTypes) if (!CURRENT_TASK_TYPES.has(taskType)) throw new AgentCatalogError("UNKNOWN_TASK_TYPE", `Agent ${current.agentId} maps an unsupported task type: ${taskType}.`);
    for (const contract of [current.inputContract, current.outputContract]) if (!CONTRACT_REFERENCES.has(contract.schemaId)) throw new AgentCatalogError("UNKNOWN_CONTRACT", `Agent ${current.agentId} references an unknown contract: ${contract.schemaId}.`);
    if (options.knownSkillIds) for (const skillId of current.allowedSkillIds) if (!options.knownSkillIds.has(skillId)) throw new AgentCatalogError("UNKNOWN_SKILL", `Agent ${current.agentId} references an unknown approved skill: ${skillId}.`);
  }
  return definitions;
}

validateAgentCatalog();
export function findAgentById(agentId: string, definitions: readonly AgentDefinition[] = agentCatalog) { return definitions.find((agent) => agent.agentId === agentId); }
export function findAgentsByCapability(capability: string, definitions: readonly AgentDefinition[] = agentCatalog) { return definitions.filter((agent) => agent.capabilities.includes(capability as AgentCapabilityId)); }
export function assertAgentSupportsCapability(agentId: string, capability: string, definitions: readonly AgentDefinition[] = agentCatalog) { const agent = findAgentById(agentId, definitions); if (!agent) throw new AgentCatalogError("AGENT_NOT_FOUND", `Agent was not found: ${agentId}.`); if (!agent.capabilities.includes(capability as AgentCapabilityId)) throw new AgentCatalogError("CAPABILITY_NOT_SUPPORTED", `Agent ${agentId} does not support ${capability}.`); return agent; }
export function resolveApprovedSkillIds(agentId: string, requestedSkillIds: readonly string[], knownSkillIds: ReadonlySet<string>, definitions: readonly AgentDefinition[] = agentCatalog) { const agent = findAgentById(agentId, definitions); if (!agent) throw new AgentCatalogError("AGENT_NOT_FOUND", `Agent was not found: ${agentId}.`); for (const skillId of requestedSkillIds) { if (!knownSkillIds.has(skillId)) throw new AgentCatalogError("UNKNOWN_SKILL", `Approved skill was not found: ${skillId}.`); if (!agent.allowedSkillIds.includes(skillId)) throw new AgentCatalogError("UNKNOWN_SKILL", `Skill ${skillId} is not allowed for agent ${agentId}.`); } return [...requestedSkillIds]; }
