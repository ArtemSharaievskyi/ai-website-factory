import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SkillCandidateEvaluationSchema } from "./contracts";
import {
  buildPortfolioPlan,
  consolidationDecisions,
  proposedInternalSkills,
} from "./portfolio-plan";

async function localEvaluations() {
  const root = path.join(process.cwd(), "docs", "admin", "skill-curation", "evaluations");
  const names = await readdir(root);
  const records = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    try {
      records.push(SkillCandidateEvaluationSchema.parse(JSON.parse(await readFile(path.join(root, name), "utf8"))));
    } catch {
      // Ignore historical non-record admin files.
    }
  }
  return records;
}

describe("Phase 4D1 portfolio consolidation", () => {
  it("accounts for exactly the 21 current human-review candidates", async () => {
    const plan = buildPortfolioPlan(await localEvaluations(), "2026-08-09T18:00:00.000Z");
    expect(plan.agents).toHaveLength(9);
    expect(plan.humanReviewCandidatesConsidered).toHaveLength(21);
    expect(new Set(plan.humanReviewCandidatesConsidered.map((item) => item.externalSkillId)).size).toBe(21);
    expect(plan.humanReviewCandidatesConsidered.every((item) => item.recommendation)).toBe(true);
  });

  it("keeps the intended external set selective and evidence-gated", async () => {
    const plan = buildPortfolioPlan(await localEvaluations(), "2026-08-09T18:00:00.000Z");
    expect(plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation === "EXTERNAL_ADVANCE")).toHaveLength(4);
    expect(plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation === "EXTERNAL_OPTIONAL")).toHaveLength(2);
    expect(plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation.startsWith("REJECT_"))).toHaveLength(12);
    expect(plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation === "PREFER_INTERNAL_SKILL")).toHaveLength(3);
    expect(plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation === "EXTERNAL_ADVANCE").every((item) => item.licenseStatus !== "PRESENT" && item.metadataReadiness !== "COMPLETE")).toBe(true);
  });

  it("defines focused, versioned internal procedures without tool authority", () => {
    expect(proposedInternalSkills.length).toBeGreaterThan(8);
    expect(new Set(proposedInternalSkills.map((item) => item.skillId)).size).toBe(proposedInternalSkills.length);
    expect(proposedInternalSkills.every((item) => /^\d+\.\d+\.\d+$/.test(item.version))).toBe(true);
    expect(proposedInternalSkills.every((item) => item.nonGoals.length > 0 && item.forbiddenAuthorityTools.length > 0 && item.targetContextSize)).toBe(true);
    expect(proposedInternalSkills.some((item) => item.targetAgents.length > 1)).toBe(true);
    expect(proposedInternalSkills.some((item) => item.skillId === "factory-development")).toBe(false);
  });

  it("preserves approval, assignment, completeness, and resolver invariants", async () => {
    const plan = buildPortfolioPlan(await localEvaluations(), "2026-08-09T18:00:00.000Z");
    expect(plan.currentApprovedExternalSkillCount).toBe(3);
    expect(plan.currentAssignedExternalSkillCount).toBe(3);
    expect(plan.currentApprovedInternalSkillCount).toBe(0);
    expect(plan.currentAssignedInternalSkillCount).toBe(0);
    expect(plan.discoverySearches).toBe(0);
    expect(plan.runtimeResolverRedesigned).toBe(false);
    expect(plan.agents.every((item) => item.completeness === "PORTFOLIO_PLANNED_COMPLETE")).toBe(true);
    expect(consolidationDecisions.every((item) => item.externalSkillId.length > 0)).toBe(true);
  });
});
