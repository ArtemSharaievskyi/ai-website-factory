import { describe, expect, it } from "vitest";
import { renderApprovedProceduralGuidance, rolePrompt } from "./prompts";

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
});
