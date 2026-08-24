import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentDefinitionSchema } from "@/domain/agents/schema";
import { agentCatalog, AGENT_CAPABILITY_IDS, AGENT_TOOL_IDS, assertAgentSupportsCapability, findAgentById, findAgentsByCapability, implementationAgentDefinition, architectureReviewerAgentDefinition, contractAuditorAgentDefinition, codeIntegrationReviewerAgentDefinition, securityReviewerAgentDefinition, testQualityReviewerAgentDefinition, leadAgentDefinition, plannerAgentDefinition, designAgentDefinition, resolveApprovedSkillIds, validateAgentCatalog, AgentCatalogError } from "./catalog";
import { LeadAgentService } from "./lead/service";
import { PlannerArchitectService } from "./planner/service";
import { DesignAgentService } from "./design/service";
import { ImplementationAgentService } from "./implementation/service";
import { ArchitectureReviewService } from "./reviewers/architecture/service";
import { ContractAuditService } from "./reviewers/contracts/service";
import { CodeIntegrationReviewService } from "./reviewers/code-integration/service";
import { SecurityReviewService } from "./reviewers/security/service";
import { TestQualityReviewService } from "./reviewers/test-quality/service";
import { OpenAiStructuredClient } from "@/integrations/openai/client";
import { OpenAiTestQualityReviewProvider } from "@/integrations/openai/adapters";
import { TestQualityReviewProviderOutputSchema } from "@/domain/review/schema";

const reviewerClientConfig = { apiKey: "test-key", model: "test-model", modelLabel: "test", maxRetries: 0, maxConcurrentRequests: 1 };
const validTestQualityOutput = {
  verdict: "APPROVED" as const,
  findings: [],
  reviewedArtifactRefs: [`E${"1".repeat(16)}-001`],
  blockedReason: null,
};

function reviewerClient(output: unknown) {
  return new OpenAiStructuredClient(reviewerClientConfig, {
    client: {
      chat: {
        completions: {
          parse: async () => ({
            id: "req_catalog_reviewer",
            choices: [{ message: { parsed: output }, finish_reason: "stop" }],
            usage: {},
          }),
        },
      },
    } as never,
  });
}

describe("typed agent catalog", () => {
  it("contains exactly the nine current agents", () => expect(agentCatalog.map((agent) => agent.agentId)).toEqual(["lead", "planner", "design", "implementation", "architecture-reviewer", "contract-auditor", "code-integration-reviewer", "security-reviewer", "test-quality-reviewer"]));
  it("has unique identities and exclusive current capabilities", () => {
    expect(new Set(agentCatalog.map((agent) => agent.agentId)).size).toBe(agentCatalog.length);
    expect(new Set(agentCatalog.flatMap((agent) => agent.capabilities)).size).toBe(AGENT_CAPABILITY_IDS.length);
  });
  it("validates every definition and rejects malformed identifiers", () => {
    expect(() => validateAgentCatalog()).not.toThrow();
    expect(() => AgentDefinitionSchema.parse({ ...leadAgentDefinition, agentId: "Lead" })).toThrow();
    expect(() => AgentDefinitionSchema.parse({ ...leadAgentDefinition, capabilities: ["*"] })).toThrow();
    expect(() => AgentDefinitionSchema.parse({ ...leadAgentDefinition, allowedTools: ["*"] })).toThrow();
    expect(() => AgentDefinitionSchema.parse({ ...leadAgentDefinition, contextPolicy: { ...leadAgentDefinition.contextPolicy, allowedCategories: ["ALL"] } })).toThrow();
  });
  it("rejects duplicate IDs, capabilities, unknown tools, and unknown skills", () => {
    expect(() => validateAgentCatalog([...agentCatalog, { ...leadAgentDefinition, agentId: "planner" }])).toThrowError(/duplicated/i);
    expect(() => validateAgentCatalog([{ ...leadAgentDefinition, capabilities: ["requirements.clarify"] }, { ...plannerAgentDefinition, capabilities: ["requirements.clarify"] }])).toThrowError(AgentCatalogError);
    expect(() => AgentDefinitionSchema.parse({ ...leadAgentDefinition, allowedTools: ["unknown"] })).toThrow();
    expect(() => validateAgentCatalog([{ ...leadAgentDefinition, allowedSkillIds: ["unknown-skill"] }], { knownSkillIds: new Set(["known-skill"]) })).toThrowError(/unknown approved/i);
  });
  it("resolves capabilities and rejects unsupported routing", () => {
    expect(findAgentById("lead")).toBe(leadAgentDefinition);
    expect(findAgentById("missing")).toBeUndefined();
    expect(findAgentsByCapability("implementation.backend").map((agent) => agent.agentId)).toEqual(["implementation"]);
    expect(() => assertAgentSupportsCapability("lead", "implementation.code")).toThrowError(/does not support/i);
  });
  it("keeps tool, skill, contract, and policy permissions explicit", () => {
    expect(AGENT_TOOL_IDS).toEqual(["openai-generation", "context7-read", "shadcn-registry-read", "codebase-memory-read", "controlled-edit", "fontpair-read", "design-quality-validation", "design-source-discovery"]);
    expect(agentCatalog.filter((agent) => agent.allowedSkillIds.length > 0).map((agent) => agent.agentId)).toEqual(["lead", "planner", "design", "implementation", "architecture-reviewer", "contract-auditor", "code-integration-reviewer", "security-reviewer", "test-quality-reviewer"]);
    expect(Object.fromEntries(agentCatalog.map((agent) => [agent.agentId, agent.allowedSkillIds]))).toEqual({
      lead: ["lead-requirements-completeness"],
      planner: ["project-data-model-planning", "technical-risk-planning"],
      design: ["responsive-form-ux-design", "impeccable", "emil-design-eng", "find-animation-opportunities", "review-animations", "improve-animations", "animation-vocabulary", "transitions-dev"],
      implementation: ["nextjs-server-client-implementation", "typed-form-implementation", "supabase-application-integration", "maintainable-performance-implementation"],
      "architecture-reviewer": ["module-boundaries-fb20497b5c35", "review-maintainability-d9faf7cb9775", "architecture-tradeoff-review"],
      "contract-auditor": ["acceptance-criteria-80493e317476", "requirements-evidence-traceability"],
      "code-integration-reviewer": ["react-nextjs-integration-review"],
      "security-reviewer": ["supabase-rls-1e36b217c969", "auth-storage-security-review"],
      "test-quality-reviewer": ["requirements-evidence-traceability", "behavioral-test-quality-review"],
    });
    expect(agentCatalog.every((agent) => agent.inputContract.schemaId.endsWith(".input") && agent.outputContract.schemaId.endsWith(".output"))).toBe(true);
    expect(agentCatalog.every((agent) => agent.contextPolicy.maxBytes > 0 && agent.executionPolicy.retryClass)).toBe(true);
    expect(leadAgentDefinition.promptVersion).not.toBe(leadAgentDefinition.policyVersions.context);
  });
  it("keeps Architecture Reviewer documentation derived from the catalog allowlist", async () => {
    const documentation = await readFile(path.join(process.cwd(), "docs/architecture/architecture-reviewer.md"), "utf8");
    const documentedAllowlist = architectureReviewerAgentDefinition.allowedSkillIds.map((skillId) => `- \`${skillId}\``).join("\n");
    expect(documentation).toContain("src/agents/catalog.ts");
    expect(documentation).toContain(documentedAllowlist);
    expect(documentation).not.toContain("no skills");
  });
  it("keeps current architecture document state explicit and aligned with the reviewer tree", async () => {
    const root = process.cwd();
    const [product, roadmap, structure, architecture] = await Promise.all([
      readFile(path.join(root, "docs/architecture/product-specification.md"), "utf8"),
      readFile(path.join(root, "docs/architecture/implementation-roadmap.md"), "utf8"),
      readFile(path.join(root, "docs/architecture/repository-structure.md"), "utf8"),
      readFile(path.join(root, "docs/architecture/agent-architecture.md"), "utf8"),
    ]);
    expect(product).toContain("Status: CURRENT_ARCHITECTURE");
    expect(product).toContain("State: PLANNED_FUTURE");
    expect(product).not.toContain("currently contains only the foundation application and documentation");
    expect(roadmap).toContain("Status: ROADMAP");
    expect(roadmap).toContain("State: CURRENT");
    expect(roadmap).toContain("State: PLANNED_FUTURE / DEFERRED_WORK");
    expect(roadmap).toContain("`Dependency Authority`: **CURRENT_IMPLEMENTATION**");
    expect(roadmap).toContain("Paid design-generator integration: **EXCLUDED**");
    expect(roadmap).toContain("`Preview` and `Deployment`: **DEFERRED_WORK**");
    expect(structure).toContain("Status: CURRENT_ARCHITECTURE");
    expect(structure).toContain("src/agents/reviewers/<role>/");
    expect(structure).not.toContain("Future Reviewer agents");
    expect(architecture).toContain("Status: CURRENT_ARCHITECTURE");
    expect(architecture).toContain("src/agents/catalog.ts");
    for (const directory of ["architecture", "contracts", "code-integration", "security", "test-quality"]) {
      await expect(readFile(path.join(root, "src/agents/reviewers", directory, "service.ts"), "utf8")).resolves.toBeTruthy();
    }
    expect(agentCatalog.filter((agent) => agent.role === "review")).toHaveLength(5);
  });
  it("resolves only approved skills", () => {
    const custom = { ...implementationAgentDefinition, allowedSkillIds: ["approved-skill"] } as typeof implementationAgentDefinition;
    expect(resolveApprovedSkillIds("implementation", ["approved-skill"], new Set(["approved-skill"]), [custom])).toEqual(["approved-skill"]);
    expect(() => resolveApprovedSkillIds("implementation", ["unapproved-skill"], new Set(), [custom])).toThrowError(/not found/i);
  });
  it("associates the existing services with their definitions", () => {
    expect(Object.create(LeadAgentService.prototype).getAgentDefinition()).toBe(leadAgentDefinition);
    expect(Object.create(PlannerArchitectService.prototype).getAgentDefinition()).toBe(plannerAgentDefinition);
    expect(Object.create(DesignAgentService.prototype).getAgentDefinition()).toBe(designAgentDefinition);
    expect(Object.create(ImplementationAgentService.prototype).getAgentDefinition()).toBe(implementationAgentDefinition);
    expect(Object.create(ArchitectureReviewService.prototype).getAgentDefinition()).toBe(architectureReviewerAgentDefinition);
    expect(Object.create(ContractAuditService.prototype).getAgentDefinition()).toBe(contractAuditorAgentDefinition);
    expect(Object.create(CodeIntegrationReviewService.prototype).getAgentDefinition()).toBe(codeIntegrationReviewerAgentDefinition);
    expect(Object.create(SecurityReviewService.prototype).getAgentDefinition()).toBe(securityReviewerAgentDefinition);
    expect(Object.create(TestQualityReviewService.prototype).getAgentDefinition()).toBe(testQualityReviewerAgentDefinition);
  });
  it("executes the Test / Quality reviewer adapter and accepts only its strict output contract", async () => {
    const result = await new OpenAiTestQualityReviewProvider(reviewerClient(validTestQualityOutput)).review({ idempotencyKey: "catalog-reviewer-execution" } as never);
    expect(TestQualityReviewProviderOutputSchema.parse(result)).toEqual(validTestQualityOutput);
    expect(result.verdict).toBe("APPROVED");
  });
  it("rejects malformed Test / Quality reviewer output instead of promoting it", async () => {
    await expect(new OpenAiTestQualityReviewProvider(reviewerClient({ ...validTestQualityOutput, verdict: "APPROVED", unexpected: true })).review({ idempotencyKey: "catalog-reviewer-malformed-output" } as never)).rejects.toMatchObject({ code: "AI_OUTPUT_DOMAIN_INVALID" });
  });
});
