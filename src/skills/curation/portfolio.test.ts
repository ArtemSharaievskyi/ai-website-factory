import { describe, expect, it } from "vitest";
import { agentCatalog } from "@/agents/catalog";
import { agentResponsibilityProfiles, coverageCounts, discoveryTargets } from "./portfolio";
import { CURATION_LIMITS } from "./session";

describe("agent skill portfolio coverage model", () => {
  it("covers all nine catalog agents and derives capabilities from definitions", () => {
    expect(agentResponsibilityProfiles).toHaveLength(9);
    for (const agent of agentCatalog.filter((item) => item.allowedSkillIds.length > 0)) {
      const profile = agentResponsibilityProfiles.find((item) => item.agentId === agent.agentId);
      expect(profile).toBeDefined();
      expect(profile?.capabilities).toEqual(agent.capabilities);
      expect(profile?.tools).toEqual(agent.allowedTools);
      expect(profile?.readOnly).toBe(agent.readOnly);
    }
  });

  it("credits the three approved skills only for their narrow coverage", () => {
    const architecture = agentResponsibilityProfiles.find((item) => item.agentId === "architecture-reviewer")!;
    const contracts = agentResponsibilityProfiles.find((item) => item.agentId === "contract-auditor")!;
    const security = agentResponsibilityProfiles.find((item) => item.agentId === "security-reviewer")!;
    expect(architecture.coverage.find((item) => item.key === "module-boundaries")?.state).toBe("APPROVED_SKILL_COVERED");
    expect(architecture.coverage.find((item) => item.key === "architecture-tradeoffs")?.state).not.toBe("APPROVED_SKILL_COVERED");
    expect(contracts.coverage.find((item) => item.key === "acceptance-criteria")?.state).toBe("APPROVED_SKILL_COVERED");
    expect(contracts.coverage.find((item) => item.key === "cross-stage-consistency")?.state).not.toBe("APPROVED_SKILL_COVERED");
    expect(security.coverage.find((item) => item.key === "rls-security")?.state).toBe("APPROVED_SKILL_COVERED");
    expect(security.coverage.find((item) => item.key === "web-security")?.state).not.toBe("APPROVED_SKILL_COVERED");
  });

  it("creates discovery targets only from missing or partial coverage", () => {
    expect(discoveryTargets.length).toBeGreaterThan(0);
    for (const target of discoveryTargets) {
      const profile = agentResponsibilityProfiles.find((item) => item.agentId === target.agentId)!;
      const coverage = profile.coverage.find((item) => item.key === target.coverageKey)!;
      expect(["MISSING", "PARTIALLY_COVERED"]).toContain(coverage.state);
      expect(coverage.discoveryQuery).toBe(target.query);
    }
    expect(discoveryTargets.some((item) => item.coverageKey === "deterministic-change-safety")).toBe(false);
  });

  it("does not impose a skill-count quota", () => {
    const counts = coverageCounts();
    expect(counts.total).toBeGreaterThan(0);
    expect(agentResponsibilityProfiles.some((profile) => profile.approvedSkills.length === 0)).toBe(true);
    expect(agentResponsibilityProfiles.some((profile) => profile.approvedSkills.length === 1)).toBe(true);
    expect(agentResponsibilityProfiles.every((profile) => profile.coverage.length > 0)).toBe(true);
  });

  it("keeps discovery administrative ceilings separate from portfolio size", () => {
    expect(CURATION_LIMITS.maxSearchRequests).toBe(50);
    expect(CURATION_LIMITS.maxDetailFetches).toBe(80);
    expect(CURATION_LIMITS.maxEvaluations).toBe(80);
    expect(discoveryTargets.length).toBeLessThanOrEqual(CURATION_LIMITS.maxSearchRequests);
    expect(CURATION_LIMITS.maxCandidatesPerSearch).toBeLessThanOrEqual(CURATION_LIMITS.maxDetailFetches);
  });
});
