import { describe, expect, it } from "vitest";
import { selectSkillCandidates, type SkillResolutionCandidate } from "@/skills/runtime/resolver";

const candidate = (skillId: string, input: { capability: string; capabilities?: string[]; taskType: string; taskTypes?: string[]; coverageKeys: string[]; projectSurfaces: string[]; priority: number }): SkillResolutionCandidate => {
  const applicability = {
    ...input,
    conflictsWithSkillIds: [],
    overlapsWithSkillIds: [],
  } as SkillResolutionCandidate["applicability"];
  return {
    skillId,
    definition: { id: skillId, status: "approved", sourceChecksum: "a".repeat(64), applicability },
    applicability,
    approvedChecksum: "b".repeat(64),
  };
};

describe("frontend capability integration", () => {
  it("selects the UI UX Pro Max and Taste procedures only on Design direction work", () => {
    const result = selectSkillCandidates([
      candidate("ui-ux-pro-max-frontend", { capability: "design.directions", taskType: "create-design-directions", coverageKeys: ["ui-ux-pro-max"], projectSurfaces: ["design"], priority: 120 }),
      candidate("taste-frontend-direction", { capability: "design.directions", taskType: "create-design-directions", coverageKeys: ["design-taste"], projectSurfaces: ["design"], priority: 115 }),
      candidate("daisyui-tailwind-v4", { capability: "implementation.code", taskType: "implement-frontend", coverageKeys: ["daisyui-tailwind-v4"], projectSurfaces: ["daisyui"], priority: 30 }),
    ], {
      capability: "design.directions",
      taskType: "create-design-directions",
      projectSurfaces: ["design", "typography", "palette", "ux"],
      requiredCoverage: ["ui-ux-pro-max", "design-taste"],
    });
    expect(result.selected.map((skill) => skill.skillId)).toEqual(expect.arrayContaining(["ui-ux-pro-max-frontend", "taste-frontend-direction"]));
    expect(result.selected.map((skill) => skill.skillId)).not.toContain("daisyui-tailwind-v4");
  });

  it("selects optional Frontend procedures only when host-owned surfaces are present", () => {
    const candidates = [
      candidate("daisyui-tailwind-v4", { capability: "implementation.code", taskType: "implement-frontend", coverageKeys: ["daisyui-tailwind-v4"], projectSurfaces: ["daisyui"], priority: 30 }),
      candidate("magic-ui-adaptation", { capability: "implementation.code", taskType: "implement-frontend", coverageKeys: ["magic-ui-adaptation"], projectSurfaces: ["magic-ui"], priority: 30 }),
    ];
    const baseline = selectSkillCandidates(candidates, { capability: "implementation.code", taskType: "implement-frontend", projectSurfaces: ["nextjs"], requiredCoverage: [] });
    expect(baseline.selected).toHaveLength(0);
    const daisy = selectSkillCandidates(candidates, { capability: "implementation.code", taskType: "implement-frontend", projectSurfaces: ["daisyui"], requiredCoverage: ["daisyui-tailwind-v4"] });
    expect(daisy.selected.map((skill) => skill.skillId)).toContain("daisyui-tailwind-v4");
    const magic = selectSkillCandidates(candidates, { capability: "implementation.code", taskType: "implement-frontend", projectSurfaces: ["magic-ui"], requiredCoverage: ["magic-ui-adaptation"] });
    expect(magic.selected.map((skill) => skill.skillId)).toContain("magic-ui-adaptation");
  });

  it("composes Design Motion Principles with the existing motion procedures", () => {
    const result = selectSkillCandidates([
      candidate("design-motion-principles", { capability: "implementation.code", capabilities: ["implementation.code", "review.animation"], taskType: "implement-frontend", taskTypes: ["implement-frontend", "review-animation"], coverageKeys: ["motion-frequency-gate"], projectSurfaces: ["motion"], priority: 25 }),
      candidate("emil-animate-d23d7f88a2e2", { capability: "implementation.code", capabilities: ["implementation.code"], taskType: "implement-frontend", taskTypes: ["implement-frontend"], coverageKeys: ["emil-animation-construction"], projectSurfaces: ["motion"], priority: 10 }),
    ], {
      capability: "implementation.code",
      taskType: "implement-frontend",
      projectSurfaces: ["motion"],
      requiredCoverage: ["motion-frequency-gate", "emil-animation-construction"],
    });
    expect(result.selected.map((skill) => skill.skillId)).toEqual(expect.arrayContaining(["design-motion-principles", "emil-animate-d23d7f88a2e2"]));
  });
});
