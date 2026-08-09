import { describe, expect, it } from "vitest";
import { selectSkillCandidates } from "./resolver";

const candidate = (skillId: string, coverageKeys: string[], priority = 0, extra: Record<string, unknown> = {}) => ({
  skillId,
  definition: { id: skillId, status: "approved" as const, sourceChecksum: `${skillId.replace(/[^a-z0-9]/gi, "").slice(0, 1) || "a"}`.repeat(64) },
  applicability: { capability: "review.example", taskType: "review-contracts" as const, coverageKeys, projectSurfaces: [], conflictsWithSkillIds: [], overlapsWithSkillIds: [], priority, ...extra },
});

describe("skill applicability resolver", () => {
  it("selects multiple complementary procedures in deterministic order", () => {
    const result = selectSkillCandidates([
      candidate("b-skill", ["contracts"], 1),
      candidate("a-skill", ["requirements"], 1),
    ], { capability: "review.example", taskType: "review-contracts", projectSurfaces: [], requiredCoverage: ["requirements", "contracts"] });
    expect(result.selected.map((item) => item.skillId)).toEqual(["a-skill", "b-skill"]);
    expect(result.decisions.every((item) => item.reason === "SELECTED")).toBe(true);
  });

  it("does not select a security procedure without a matching project surface", () => {
    const result = selectSkillCandidates([{
      ...candidate("supabase-rls", ["rls"], 1),
      applicability: { ...candidate("supabase-rls", ["rls"]).applicability, capability: "review.security", taskType: "review-security", projectSurfaces: ["supabase", "rls"] },
    }], { capability: "review.security", taskType: "review-security", projectSurfaces: ["NONE"], requiredCoverage: ["rls"] });
    expect(result.selected).toHaveLength(0);
    expect(result.decisions[0]).toMatchObject({ reason: "NOT_RELEVANT" });
  });

  it("reports explicit conflicts and duplicate coverage", () => {
    const result = selectSkillCandidates([
      candidate("primary", ["contracts"], 2),
      candidate("conflict", ["contracts"], 1, { conflictsWithSkillIds: ["primary"] }),
      candidate("overlap", ["contracts"], 0),
    ], { capability: "review.example", taskType: "review-contracts", projectSurfaces: [], requiredCoverage: ["contracts"] });
    expect(result.selected.map((item) => item.skillId)).toEqual(["primary"]);
    expect(result.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillId: "conflict", reason: "CONFLICTING" }),
      expect.objectContaining({ skillId: "overlap", reason: "OVERLAPPING" }),
    ]));
  });
});
