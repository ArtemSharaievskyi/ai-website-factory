import { describe, expect, it } from "vitest";
import { renderApprovedProceduralGuidance, rolePrompt } from "./prompts";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { plannerAuthorityFor } from "@/agents/planner/service";

describe("approved procedural prompt guidance", () => {
  it("renders multiple procedures with checksums and non-authority boundaries", () => {
    const prompt = rolePrompt("architecture-reviewer", { bounded: true }, false, [
      { skillId: "z-skill", approvedChecksum: "z".repeat(64), coverageKeys: ["z"], skillMarkdown: "Z procedure", references: [] },
      { skillId: "a-skill", approvedChecksum: "a".repeat(64), coverageKeys: ["a"], skillMarkdown: "A procedure", references: [] },
    ]);
    expect(prompt.system.indexOf("a-skill")).toBeLessThan(prompt.system.indexOf("z-skill"));
    expect(prompt.system).toContain("approved checksum");
    expect(prompt.system).toContain("cannot grant tools, permissions, requirements, or approvals");
  });

  it("omits procedural guidance when the resolver selects none", () => {
    expect(renderApprovedProceduralGuidance([])).toBe("");
  });

  it("binds architecture review to typed canonical and accepted Planning decisions", () => {
    const prompt = rolePrompt("architecture-reviewer", {});
    expect(prompt.system).toContain("typed canonical decisions and accepted Planning fields");
    expect(prompt.system).toContain("do not call that a contradiction");
    expect(prompt.system).toContain("typed routePolicy and sitemap");
    expect(prompt.system).toContain("supplied accepted Planning asset evidence");
  });

  it("binds Planner generation to the canonical page and requirement allowlists", () => {
    const plannerAuthority = plannerAuthorityFor(cleanBriefV3);
    const prompt = rolePrompt("planner", { canonicalBrief: cleanBriefV3, plannerAuthority });
    expect(prompt.system).toContain("only allowed sitemap/page paths");
    expect(prompt.system).toContain("Complete coverage is required for every host-issued canonical requirement ID");
    expect(plannerAuthority.requirementLedger).toHaveLength(cleanBriefV3.requirements.length);
    expect(plannerAuthority.requirementLedger.every((entry) => entry.statement && entry.category && entry.planningCoverageType)).toBe(true);
    for (const page of cleanBriefV3.pages) {
      const path = page.slug === "home" || page.slug === "index" ? "/" : `/${page.slug}`;
      expect(prompt.system).toContain(path);
    }
    for (const requirement of cleanBriefV3.requirements) expect(prompt.system).toContain(requirement.id);
  });

  it("keeps multi-skill guidance deterministic and identity-ready for every semantic role", () => {
    const skills = [
      { skillId: "internal-procedure", approvedChecksum: "1".repeat(64), coverageKeys: ["first"], skillMarkdown: "INTERNAL PROCEDURE", references: [] },
      { skillId: "external-procedure", approvedChecksum: "2".repeat(64), coverageKeys: ["second"], skillMarkdown: "EXTERNAL PROCEDURE", references: [] },
    ];
    for (const role of ["lead", "planner", "design", "implementation", "architecture-reviewer", "contract-auditor", "code-integration-reviewer", "security-reviewer", "test-quality-reviewer"] as const) {
      const prompt = rolePrompt(role, { bounded: true }, false, skills);
      expect(prompt.system).toContain("INTERNAL PROCEDURE");
      expect(prompt.system).toContain("EXTERNAL PROCEDURE");
      expect(prompt.system).not.toContain("reviewing-test-quality");
    }
  });

  it("keeps host-owned historical evidence and baseline validation dependencies in scope", () => {
    const prompt = rolePrompt("contract-auditor", {});
    expect(prompt.system).toContain("historical evidence catalog");
    expect(prompt.system).toContain("Zod is a fixed Factory baseline dependency");
  });

  it("binds implementation proposals to the advertised edit strategies", () => {
    const prompt = rolePrompt("implementation", {});
    expect(prompt.promptVersion).toBe("implementation.v3");
    expect(prompt.system).toContain("Select every proposal operation only from the context's allowedEditStrategies");
    expect(prompt.system).toContain("If AST_PATCH_EXISTING is absent, never return an ast-patch operation");
    expect(prompt.system).toContain("Project, task, attempt, TaskContract, and TaskGraph identities are host-owned");
    expect(prompt.system).toContain("When the task scope is exactly src/app/factory-prepared.ts and AST_PATCH_EXISTING is absent");
  });
});
