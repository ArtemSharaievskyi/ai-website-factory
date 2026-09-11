import { AgentCapabilityIdSchema, AgentDefinitionSchema, AgentToolIdSchema, type AgentDefinition } from "@/domain/agents/schema";
import { ImplementationTaskTypeSchema } from "@/domain/tasks/schema";
import { z } from "zod";
import { EMIL_ANIMATE_SKILL_ID, EMIL_ANIMATION_IMPROVEMENT_SKILL_ID, EMIL_ANIMATION_OPPORTUNITY_SKILL_ID, EMIL_ANIMATION_REVIEW_SKILL_ID, EMIL_DESIGN_ENGINEERING_SKILL_ID } from "@/integrations/design/emil";

export const AGENT_TOOL_IDS = ["openai-generation", "context7-read", "shadcn-registry-read", "codebase-memory-read", "generated-runtime-validation", "playwright-functional-qa", "controlled-edit", "fontpair-read", "design-quality-validation", "design-source-discovery"] as const satisfies readonly z.infer<typeof AgentToolIdSchema>[];
export type AgentToolId = (typeof AGENT_TOOL_IDS)[number];
export const AGENT_CAPABILITY_IDS = ["requirements.clarify", "requirements.brief", "planning.architecture", "planning.content", "planning.assets", "design.directions", "design.selection", "implementation.code", "implementation.backend", "implementation.seo", "review.architecture", "review.contracts", "review.integration", "review.security", "review.security-threat-model", "review.security-test", "review.german-web-compliance", "review.exploratory-qa", "review.ux-critic", "review.product-critic", "review.architecture-critic", "review.test-quality", "review.browser-qa", "review.accessibility", "review.performance", "review.visual-regression", "review.release-readiness", "review.seo", "review.content-quality", "review.dependencies", "review.documentation", "review.design", "review.animation"] as const satisfies readonly z.infer<typeof AgentCapabilityIdSchema>[];
export type AgentCapabilityId = (typeof AGENT_CAPABILITY_IDS)[number];

const CONTRACT_REFERENCES = new Set(["lead.input", "lead.output", "planner.input", "planner.output", "design.input", "design.output", "implementation.input", "implementation.output", "architecture-reviewer.input", "contract-auditor.input", "code-integration-reviewer.input", "security-reviewer.input", "security-threat-model.input", "security-threat-model.output", "test-quality-reviewer.input", "browser-qa.input", "accessibility-review.input", "performance-review.input", "visual-regression.input", "release-readiness.input", "seo-review.input", "content-quality.input", "dependency-guardian.input", "documentation.input", "security-test.input", "german-web-compliance.input", "exploratory-qa.input", "ux-critic.input", "product-critic.input", "architecture-critic.input", "design-review.input", "animation-review.input", "review.output", "agent-review.output"]);
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
  "review-code",
  "review-security",
  "review-security-threat-model",
  "review-security-test",
  "review-german-web-compliance",
  "review-exploratory-qa",
  "review-ux-critic",
  "review-product-critic",
  "review-architecture-critic",
  "review-test-quality",
  "review-browser-qa",
  "review-accessibility",
  "review-performance",
  "review-visual-regression",
  "review-release-readiness",
  "review-seo",
  "review-content-quality",
  "review-dependencies",
  "review-documentation",
  "review-design",
  "review-animation",
  "audit-animation",
  "find-animation-opportunities",
]);
const IMPLEMENTATION_TASK_TYPES = ["prepare-workspace", "implement-project-foundation", "implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form", "implement-server-action", "implement-route-handler", "implement-database-schema", "implement-rls-policy", "implement-authentication", "implement-storage", "implement-email", "integrate-assets", "integrate-content", "implement-seo", "implement-motion", "write-unit-tests", "write-integration-tests", "write-e2e-tests", "repair-targeted-failure"];

const definition = (value: z.input<typeof AgentDefinitionSchema>): AgentDefinition => AgentDefinitionSchema.parse(value);
export const leadAgentDefinition = definition({
  agentId: "lead", displayName: "Lead Agent", role: "generation", version: "1.0.0",
  capabilities: ["requirements.clarify", "requirements.brief"], supportedTaskTypes: ["clarify-requirements", "create-requirements-spec"],
  allowedTools: ["openai-generation"], allowedSkillIds: ["lead-requirements-completeness"],
  contextPolicy: { version: "lead-context-v1", allowedCategories: ["ORIGINAL_PROMPT", "SUPPLIED_FILES_METADATA", "CLARIFICATION_SESSION", "PROJECT_BRIEF"], maxBytes: 60000, maxItems: 40 },
  inputContract: { schemaId: "lead.input", version: "1" }, outputContract: { schemaId: "lead.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "lead.v1", policyVersions: { context: "lead-context-v1", execution: "lead-execution-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: false, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: true }, readOnly: false,
});
export const plannerAgentDefinition = definition({
  agentId: "planner", displayName: "Planner / Architect Agent", role: "generation", version: "1.0.0",
  capabilities: ["planning.architecture", "planning.content", "planning.assets"], supportedTaskTypes: ["create-technical-architecture", "plan-content", "plan-assets"],
  allowedTools: ["openai-generation", "context7-read"], allowedSkillIds: ["project-data-model-planning", "technical-risk-planning"],
  contextPolicy: { version: "planner-context-v1", allowedCategories: ["PROJECT_BRIEF", "CLARIFICATION_SESSION", "PLANNING_PACKAGE", "PREVIOUS_FINDINGS"], maxBytes: 120000, maxItems: 80 },
  inputContract: { schemaId: "planner.input", version: "1" }, outputContract: { schemaId: "planner.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "planner.v2", policyVersions: { context: "planner-context-v1", execution: "planner-execution-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: false, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: true }, readOnly: false,
});
export const designAgentDefinition = definition({
  agentId: "design", displayName: "Design Agent", role: "generation", version: "1.0.0",
  capabilities: ["design.directions", "design.selection"], supportedTaskTypes: ["create-design-directions"],
  allowedTools: ["openai-generation", "fontpair-read", "design-quality-validation", "design-source-discovery"], allowedSkillIds: ["responsive-form-ux-design", "impeccable", EMIL_DESIGN_ENGINEERING_SKILL_ID, "animation-vocabulary", "transitions-dev"],
  contextPolicy: { version: "design-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "SUPPLIED_FILES_METADATA", "PREVIOUS_FINDINGS"], maxBytes: 120000, maxItems: 80 },
  inputContract: { schemaId: "design.input", version: "1" }, outputContract: { schemaId: "design.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "design.v1", policyVersions: { context: "design-context-v1", execution: "design-execution-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: false, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: true }, readOnly: false,
});
export const implementationAgentDefinition = definition({
  agentId: "implementation", displayName: "Implementation Agent", role: "implementation", version: "1.0.0",
  capabilities: ["implementation.code", "implementation.backend", "implementation.seo"], supportedTaskTypes: IMPLEMENTATION_TASK_TYPES,
  allowedTools: ["openai-generation", "context7-read", "shadcn-registry-read", "codebase-memory-read", "controlled-edit", "design-source-discovery"], allowedSkillIds: ["nextjs-server-client-implementation", "typed-form-implementation", "supabase-application-integration", "maintainable-performance-implementation", EMIL_DESIGN_ENGINEERING_SKILL_ID, EMIL_ANIMATE_SKILL_ID],
  contextPolicy: { version: "implementation-context-v1", allowedCategories: ["TASK_SLICE", "PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"], maxBytes: 120000, maxItems: 80 },
  inputContract: { schemaId: "implementation.input", version: "1" }, outputContract: { schemaId: "implementation.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "implementation.v3", policyVersions: { context: "implementation-context-v1", execution: "implementation-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-task", cancellationSupported: true, concurrencyClass: "exclusive-write", requiresExplicitApprovalBeforeTransition: false }, readOnly: false,
});
export const architectureReviewerAgentDefinition = definition({
  agentId: "architecture-reviewer", displayName: "Architecture Reviewer", role: "review", version: "1.0.0",
  capabilities: ["review.architecture"], supportedTaskTypes: ["review-architecture"],
  allowedTools: ["openai-generation"], allowedSkillIds: ["module-boundaries-fb20497b5c35", "review-maintainability-d9faf7cb9775", "architecture-tradeoff-review"],
  contextPolicy: { version: "architecture-review-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "PREVIOUS_FINDINGS"], maxBytes: 140000, maxItems: 60 },
  inputContract: { schemaId: "architecture-reviewer.input", version: "1" }, outputContract: { schemaId: "review.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "architecture-reviewer.v2", policyVersions: { context: "architecture-review-context-v1", execution: "architecture-review-execution-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: true, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: false }, readOnly: true,
});
export const contractAuditorAgentDefinition = definition({
  agentId: "contract-auditor", displayName: "Contract Auditor", role: "review", version: "1.0.0",
  capabilities: ["review.contracts"], supportedTaskTypes: ["review-contracts"],
  allowedTools: ["openai-generation"], allowedSkillIds: ["acceptance-criteria-80493e317476", "requirements-evidence-traceability"],
  contextPolicy: { version: "contract-audit-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "PREVIOUS_FINDINGS"], maxBytes: 160000, maxItems: 80 },
  inputContract: { schemaId: "contract-auditor.input", version: "1" }, outputContract: { schemaId: "review.output", version: "1" },
  promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "contract-auditor.v3", policyVersions: { context: "contract-audit-context-v1", execution: "contract-audit-execution-v1" },
  executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: true, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: false }, readOnly: true,
});
export const codeIntegrationReviewerAgentDefinition = definition({
  agentId: "code-integration-reviewer", displayName: "Code / Integration Reviewer", role: "review", version: "1.0.0",
  capabilities: ["review.integration"], supportedTaskTypes: ["review-code-integration"], allowedTools: ["openai-generation"], allowedSkillIds: ["react-nextjs-integration-review"],
  contextPolicy: { version: "code-integration-review-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "CODEBASE_CONTEXT", "PREVIOUS_FINDINGS"], maxBytes: 180000, maxItems: 120 },
  inputContract: { schemaId: "code-integration-reviewer.input", version: "1" }, outputContract: { schemaId: "review.output", version: "1" }, promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "code-integration-reviewer.v1", policyVersions: { context: "code-integration-review-context-v1", execution: "code-integration-review-execution-v1" }, executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: true, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: false }, readOnly: true,
});
export const securityReviewerAgentDefinition = definition({
  agentId: "security-reviewer", displayName: "Security Reviewer", role: "review", version: "1.0.0",
  capabilities: ["review.security"], supportedTaskTypes: ["review-security"], allowedTools: ["openai-generation"], allowedSkillIds: ["supabase-rls-1e36b217c969", "auth-storage-security-review"],
  contextPolicy: { version: "security-review-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "CODEBASE_CONTEXT", "PREVIOUS_FINDINGS"], maxBytes: 180000, maxItems: 120 },
  inputContract: { schemaId: "security-reviewer.input", version: "1" }, outputContract: { schemaId: "review.output", version: "1" }, promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "security-reviewer.v1", policyVersions: { context: "security-review-context-v1", execution: "security-review-execution-v1" }, executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: true, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: false }, readOnly: true,
});
export const securityThreatModelAgentDefinition = definition({
  agentId: "security-threat-model", displayName: "Security Threat Model Agent", role: "review", version: "1.0.0",
  capabilities: ["review.security-threat-model"], supportedTaskTypes: ["review-security-threat-model"], allowedTools: [], allowedSkillIds: [],
  contextPolicy: { version: "security-threat-model-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "PREVIOUS_FINDINGS"], maxBytes: 180000, maxItems: 120 },
  inputContract: { schemaId: "security-threat-model.input", version: "1" }, outputContract: { schemaId: "security-threat-model.output", version: "1" }, promptOwner: "src/agents/reviewers/security/threat-model.ts", promptVersion: "security-threat-model.deterministic.v1", policyVersions: { context: "security-threat-model-context-v1", execution: "security-threat-model-execution-v1" }, executionPolicy: { aiGenerationAllowed: false, retryClass: "none", cancellationSupported: true, concurrencyClass: "bounded", requiresExplicitApprovalBeforeTransition: false }, readOnly: true,
});
export const testQualityReviewerAgentDefinition = definition({
  agentId: "test-quality-reviewer", displayName: "Test / Quality Reviewer", role: "review", version: "1.0.0",
  capabilities: ["review.test-quality"], supportedTaskTypes: ["review-test-quality"], allowedTools: ["openai-generation"], allowedSkillIds: ["requirements-evidence-traceability", "behavioral-test-quality-review"],
  contextPolicy: { version: "test-quality-review-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"], maxBytes: 180000, maxItems: 140 },
  inputContract: { schemaId: "test-quality-reviewer.input", version: "1" }, outputContract: { schemaId: "review.output", version: "1" }, promptOwner: "src/integrations/openai/prompts.ts", promptVersion: "test-quality-reviewer.v1", policyVersions: { context: "test-quality-review-context-v1", execution: "test-quality-review-execution-v1" }, executionPolicy: { aiGenerationAllowed: true, retryClass: "bounded-provider", cancellationSupported: true, concurrencyClass: "single-flight", requiresExplicitApprovalBeforeTransition: false }, readOnly: true,
});

const lightweightReviewer = (value: Pick<AgentDefinition, "agentId" | "displayName" | "capabilities" | "supportedTaskTypes" | "allowedTools" | "contextPolicy" | "inputContract"> & { writeScopes?: string[]; allowedSkillIds?: string[] }) => definition({
  ...value,
  role: "review",
  version: "1.0.0",
  allowedSkillIds: value.allowedSkillIds ?? [],
  outputContract: { schemaId: "agent-review.output", version: "1" },
  promptOwner: "src/agents/reviewers/lightweight/agents.ts",
  promptVersion: "lightweight-reviewer.deterministic.v1",
  policyVersions: { context: "lightweight-review-context-v1", execution: "lightweight-review-execution-v1" },
  executionPolicy: { aiGenerationAllowed: false, retryClass: "none", cancellationSupported: true, concurrencyClass: "bounded", requiresExplicitApprovalBeforeTransition: false },
  readOnly: true,
  canonicalWriteAuthority: false,
  writeScopes: value.writeScopes ?? [],
});

export const browserQaAgentDefinition = lightweightReviewer({ agentId: "browser-qa", displayName: "Browser QA Agent", capabilities: ["review.browser-qa"], supportedTaskTypes: ["review-browser-qa"], allowedTools: ["playwright-functional-qa"], contextPolicy: { version: "browser-qa-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "VALIDATION_DIAGNOSTIC"], maxBytes: 120000, maxItems: 120 }, inputContract: { schemaId: "browser-qa.input", version: "1" } });
export const accessibilityReviewAgentDefinition = lightweightReviewer({ agentId: "accessibility-review", displayName: "Accessibility Review Agent", capabilities: ["review.accessibility"], supportedTaskTypes: ["review-accessibility"], allowedTools: ["playwright-functional-qa"], contextPolicy: { version: "accessibility-review-context-v1", allowedCategories: ["SELECTED_DESIGN", "TASK_SLICE", "VALIDATION_DIAGNOSTIC"], maxBytes: 100000, maxItems: 100 }, inputContract: { schemaId: "accessibility-review.input", version: "1" } });
export const performanceReviewAgentDefinition = lightweightReviewer({ agentId: "performance-review", displayName: "Performance Review Agent", capabilities: ["review.performance"], supportedTaskTypes: ["review-performance"], allowedTools: ["generated-runtime-validation"], contextPolicy: { version: "performance-review-context-v1", allowedCategories: ["PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC"], maxBytes: 120000, maxItems: 120 }, inputContract: { schemaId: "performance-review.input", version: "1" } });
export const visualRegressionAgentDefinition = lightweightReviewer({ agentId: "visual-regression", displayName: "Visual Regression Agent", capabilities: ["review.visual-regression"], supportedTaskTypes: ["review-visual-regression"], allowedTools: ["playwright-functional-qa"], contextPolicy: { version: "visual-regression-context-v1", allowedCategories: ["SELECTED_DESIGN", "TASK_SLICE", "VALIDATION_DIAGNOSTIC"], maxBytes: 120000, maxItems: 100 }, inputContract: { schemaId: "visual-regression.input", version: "1" } });
export const releaseReadinessAgentDefinition = lightweightReviewer({ agentId: "release-readiness", displayName: "Release Readiness Agent", capabilities: ["review.release-readiness"], supportedTaskTypes: ["review-release-readiness"], allowedTools: [], contextPolicy: { version: "release-readiness-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"], maxBytes: 100000, maxItems: 160 }, inputContract: { schemaId: "release-readiness.input", version: "1" } });
export const seoReviewAgentDefinition = lightweightReviewer({ agentId: "seo-review", displayName: "SEO Review Agent", capabilities: ["review.seo"], supportedTaskTypes: ["review-seo"], allowedTools: ["generated-runtime-validation"], contextPolicy: { version: "seo-review-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC"], maxBytes: 100000, maxItems: 100 }, inputContract: { schemaId: "seo-review.input", version: "1" } });
export const contentQualityAgentDefinition = lightweightReviewer({ agentId: "content-quality", displayName: "Content Quality Agent", capabilities: ["review.content-quality"], supportedTaskTypes: ["review-content-quality"], allowedTools: [], contextPolicy: { version: "content-quality-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "CODEBASE_CONTEXT"], maxBytes: 100000, maxItems: 100 }, inputContract: { schemaId: "content-quality.input", version: "1" } });
export const dependencyGuardianAgentDefinition = lightweightReviewer({ agentId: "dependency-guardian", displayName: "Dependency Guardian Agent", capabilities: ["review.dependencies"], supportedTaskTypes: ["review-dependencies"], allowedTools: ["generated-runtime-validation"], contextPolicy: { version: "dependency-guardian-context-v1", allowedCategories: ["PLANNING_PACKAGE", "TASK_SLICE", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC"], maxBytes: 100000, maxItems: 100 }, inputContract: { schemaId: "dependency-guardian.input", version: "1" } });
export const documentationAgentDefinition = lightweightReviewer({ agentId: "documentation", displayName: "Documentation Agent", capabilities: ["review.documentation"], supportedTaskTypes: ["review-documentation"], allowedTools: [], contextPolicy: { version: "documentation-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC"], maxBytes: 100000, maxItems: 100 }, inputContract: { schemaId: "documentation.input", version: "1" }, writeScopes: ["README.md", "docs/**", ".env.example"] });
export const securityTestAgentDefinition = lightweightReviewer({ agentId: "security-test", displayName: "Security Test Agent", capabilities: ["review.security-test"], supportedTaskTypes: ["review-security-test"], allowedTools: ["playwright-functional-qa", "generated-runtime-validation"], contextPolicy: { version: "security-test-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "VALIDATION_DIAGNOSTIC"], maxBytes: 140000, maxItems: 120 }, inputContract: { schemaId: "security-test.input", version: "1" } });
export const germanWebComplianceAgentDefinition = lightweightReviewer({ agentId: "german-web-compliance", displayName: "German Web Compliance Agent", capabilities: ["review.german-web-compliance"], supportedTaskTypes: ["review-german-web-compliance"], allowedTools: ["generated-runtime-validation"], contextPolicy: { version: "german-web-compliance-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "VALIDATION_DIAGNOSTIC"], maxBytes: 140000, maxItems: 120 }, inputContract: { schemaId: "german-web-compliance.input", version: "1" } });
export const exploratoryQaAgentDefinition = lightweightReviewer({ agentId: "exploratory-qa", displayName: "Exploratory QA Agent", capabilities: ["review.exploratory-qa"], supportedTaskTypes: ["review-exploratory-qa"], allowedTools: ["playwright-functional-qa"], contextPolicy: { version: "exploratory-qa-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "VALIDATION_DIAGNOSTIC"], maxBytes: 140000, maxItems: 120 }, inputContract: { schemaId: "exploratory-qa.input", version: "1" } });
export const uxCriticAgentDefinition = lightweightReviewer({ agentId: "ux-critic", displayName: "UX Critic Agent", capabilities: ["review.ux-critic"], supportedTaskTypes: ["review-ux-critic"], allowedTools: ["playwright-functional-qa"], contextPolicy: { version: "ux-critic-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "SELECTED_DESIGN", "VALIDATION_DIAGNOSTIC"], maxBytes: 140000, maxItems: 120 }, inputContract: { schemaId: "ux-critic.input", version: "1" } });
export const productCriticAgentDefinition = lightweightReviewer({ agentId: "product-critic", displayName: "Product Critic Agent", capabilities: ["review.product-critic"], supportedTaskTypes: ["review-product-critic"], allowedTools: [], contextPolicy: { version: "product-critic-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "VALIDATION_DIAGNOSTIC"], maxBytes: 140000, maxItems: 120 }, inputContract: { schemaId: "product-critic.input", version: "1" } });
export const architectureCriticAgentDefinition = lightweightReviewer({ agentId: "architecture-critic", displayName: "Architecture Critic Agent", capabilities: ["review.architecture-critic"], supportedTaskTypes: ["review-architecture-critic"], allowedTools: [], contextPolicy: { version: "architecture-critic-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "VALIDATION_DIAGNOSTIC"], maxBytes: 140000, maxItems: 120 }, inputContract: { schemaId: "architecture-critic.input", version: "1" } });
export const designReviewAgentDefinition = lightweightReviewer({ agentId: "design-review", displayName: "Design Review Agent", capabilities: ["review.design"], supportedTaskTypes: ["review-design"], allowedTools: [], allowedSkillIds: [EMIL_DESIGN_ENGINEERING_SKILL_ID], contextPolicy: { version: "design-review-context-v1", allowedCategories: ["SELECTED_DESIGN", "TASK_SLICE", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"], maxBytes: 140000, maxItems: 120 }, inputContract: { schemaId: "design-review.input", version: "1" } });
export const animationReviewAgentDefinition = lightweightReviewer({ agentId: "animation-review", displayName: "Animation Review Agent", capabilities: ["review.animation"], supportedTaskTypes: ["review-animation", "audit-animation", "find-animation-opportunities"], allowedTools: [], allowedSkillIds: [EMIL_ANIMATION_REVIEW_SKILL_ID, EMIL_ANIMATION_IMPROVEMENT_SKILL_ID, EMIL_ANIMATION_OPPORTUNITY_SKILL_ID], contextPolicy: { version: "animation-review-context-v1", allowedCategories: ["SELECTED_DESIGN", "TASK_SLICE", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"], maxBytes: 140000, maxItems: 120 }, inputContract: { schemaId: "animation-review.input", version: "1" } });

export const lightweightReviewerAgentDefinitions = [browserQaAgentDefinition, accessibilityReviewAgentDefinition, performanceReviewAgentDefinition, visualRegressionAgentDefinition, releaseReadinessAgentDefinition, seoReviewAgentDefinition, contentQualityAgentDefinition, dependencyGuardianAgentDefinition, documentationAgentDefinition, securityTestAgentDefinition, germanWebComplianceAgentDefinition, exploratoryQaAgentDefinition, uxCriticAgentDefinition, productCriticAgentDefinition, architectureCriticAgentDefinition, designReviewAgentDefinition, animationReviewAgentDefinition] as const;

export const agentCatalog = [leadAgentDefinition, plannerAgentDefinition, designAgentDefinition, implementationAgentDefinition, architectureReviewerAgentDefinition, contractAuditorAgentDefinition, codeIntegrationReviewerAgentDefinition, securityReviewerAgentDefinition, securityThreatModelAgentDefinition, testQualityReviewerAgentDefinition, ...lightweightReviewerAgentDefinitions] as const satisfies readonly AgentDefinition[];

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
