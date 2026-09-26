import { describe, expect, it } from "vitest";
import { renderApprovedProceduralGuidance, rolePrompt } from "./prompts";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { createPlannerReferenceTable, plannerProviderReferenceProtocol } from "@/agents/planner/reference-table";

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

  it("binds Planner generation to opaque host-issued requirement, page, and route tokens", () => {
    const table = createPlannerReferenceTable({ projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(cleanBriefV3), idempotencyKey: "synthetic-token-prompt", expectedRowVersion: 1, canonicalBrief: cleanBriefV3 });
    const prompt = rolePrompt("planner", { approvedBrief: { operatorLanguage: "en", localization: { defaultLocale: "en" } }, plannerReferenceProtocol: plannerProviderReferenceProtocol(table) });
    expect(prompt.promptVersion).toBe("planner.v5");
    expect(prompt.system).toContain("host-issued and opaque");
    expect(prompt.system).toContain("REQ_001");
    expect(prompt.system).toContain("PAGE_001");
    expect(prompt.system).toContain("ROUTE_001");
    expect(prompt.system).toContain("elementKinds=");
    expect(prompt.system).toContain("domains=");
    expect(prompt.system).toContain("negativeEvidenceRequired=");
    expect(prompt.system).toContain("generic catch-all");
    for (const requirement of cleanBriefV3.requirements) expect(prompt.system).not.toContain(requirement.id);
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

  it("uses the measured role-specific envelope for a lossless Contract Audit context", () => {
    const prompt = rolePrompt("contract-auditor", { approvedBrief: "x".repeat(400_000) });
    expect(prompt.contextBundle.budget.profileId).toBe("contract-audit-v1");
    expect(prompt.contextBundle.metrics.canonicalRequirementTruncated).toBe(false);
    expect(prompt.contextBundle.totalBytes).toBeGreaterThan(400_000);
    expect(prompt.contextBundle.budget.hardCeiling.bytes).toBe(640_000);
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
