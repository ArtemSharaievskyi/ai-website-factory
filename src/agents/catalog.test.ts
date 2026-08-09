import { describe, expect, it } from "vitest";
import { AgentDefinitionSchema } from "@/domain/agents/schema";
import { agentCatalog, AGENT_CAPABILITY_IDS, AGENT_TOOL_IDS, assertAgentSupportsCapability, findAgentById, findAgentsByCapability, implementationAgentDefinition, architectureReviewerAgentDefinition, contractAuditorAgentDefinition, codeIntegrationReviewerAgentDefinition, securityReviewerAgentDefinition, leadAgentDefinition, plannerAgentDefinition, designAgentDefinition, resolveApprovedSkillIds, validateAgentCatalog, AgentCatalogError } from "./catalog";
import { LeadAgentService } from "./lead/service";
import { PlannerArchitectService } from "./planner/service";
import { DesignAgentService } from "./design/service";
import { ImplementationAgentService } from "./implementation/service";
import { ArchitectureReviewService } from "./reviewers/architecture/service";
import { ContractAuditService } from "./reviewers/contracts/service";
import { CodeIntegrationReviewService } from "./reviewers/code-integration/service";
import { SecurityReviewService } from "./reviewers/security/service";

describe("typed agent catalog", () => {
  it("contains exactly the eight current agents", () => expect(agentCatalog.map((agent) => agent.agentId)).toEqual(["lead", "planner", "design", "implementation", "architecture-reviewer", "contract-auditor", "code-integration-reviewer", "security-reviewer"]));
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
    expect(AGENT_TOOL_IDS).toEqual(["openai-generation", "context7-read", "shadcn-registry-read", "codebase-memory-read"]);
    expect(agentCatalog.every((agent) => agent.allowedSkillIds.length === 0)).toBe(true);
    expect(agentCatalog.every((agent) => agent.inputContract.schemaId.endsWith(".input") && agent.outputContract.schemaId.endsWith(".output"))).toBe(true);
    expect(agentCatalog.every((agent) => agent.contextPolicy.maxBytes > 0 && agent.executionPolicy.retryClass)).toBe(true);
    expect(leadAgentDefinition.promptVersion).not.toBe(leadAgentDefinition.policyVersions.context);
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
  });
});
