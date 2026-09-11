import { describe, expect, it } from "vitest";
import { ApprovedDesignSkillEvidenceSchema } from "./contracts";
import { CURRENT_OFFICIAL_DESIGN_SKILLS, validateDesignSkillCoverage } from "./skill-evidence";
import {
  EMIL_ANIMATE_SKILL_ID,
  EMIL_ANIMATION_IMPROVEMENT_SKILL_ID,
  EMIL_ANIMATION_OPPORTUNITY_SKILL_ID,
  EMIL_ANIMATION_REVIEW_SKILL_ID,
  EMIL_DESIGN_ENGINEERING_SKILL_ID,
  EMIL_LICENSE,
  EMIL_SKILL_PROVENANCE,
  EMIL_UPSTREAM_REPOSITORY,
  EMIL_UPSTREAM_REVISION,
} from "./emil";

describe("current Emil motion and design provenance", () => {
  it("pins all requested skills to the audited upstream revision and MIT license", () => {
    expect(EMIL_UPSTREAM_REPOSITORY).toBe("emilkowalski/skills");
    expect(EMIL_UPSTREAM_REVISION).toBe("d23d7f88a2e21c9e4b1418c7abe420f5c1052ba7");
    expect(EMIL_LICENSE).toBe("MIT");
    expect(EMIL_SKILL_PROVENANCE.map((item) => item.skillId)).toEqual(["emil-design-eng", "animate", "review-animations", "improve-animations", "find-animation-opportunities"]);
    expect([EMIL_DESIGN_ENGINEERING_SKILL_ID, EMIL_ANIMATE_SKILL_ID, EMIL_ANIMATION_REVIEW_SKILL_ID, EMIL_ANIMATION_IMPROVEMENT_SKILL_ID, EMIL_ANIMATION_OPPORTUNITY_SKILL_ID]).toEqual(expect.arrayContaining(["emil-design-eng-d23d7f88a2e2", "animate-d23d7f88a2e2", "review-animations-d23d7f88a2e2", "improve-animations-d23d7f88a2e2-r1", "find-animation-opportunities-d23d7f88a2e2-r1"]));
    expect(EMIL_SKILL_PROVENANCE.every((item) => item.reviewedRevision === EMIL_UPSTREAM_REVISION && item.license === EMIL_LICENSE && /^[a-f0-9]{64}$/.test(item.approvedContentChecksum))).toBe(true);
  });

  it("binds current external skill evidence to immutable registry identities and coverage", () => {
    const emilEvidence = EMIL_SKILL_PROVENANCE.map((item) => ApprovedDesignSkillEvidenceSchema.parse({
      skillId: item.registrySkillId,
      officialRepository: EMIL_UPSTREAM_REPOSITORY,
      externalSkillId: EMIL_UPSTREAM_REPOSITORY + "/" + item.skillId,
      status: "APPROVED_IMMUTABLE",
      sourceChecksum: "a".repeat(64),
      normalizedContentChecksum: item.approvedContentChecksum,
      sourceCommit: EMIL_UPSTREAM_REVISION,
      license: EMIL_LICENSE,
      reviewedAt: "2026-09-11T00:00:00.000Z",
      approvedDirectory: "skills/approved/" + item.skillId,
    }));
    const otherEvidence = [
      ApprovedDesignSkillEvidenceSchema.parse({ skillId: "impeccable", officialRepository: "pbakaus/impeccable", status: "APPROVED_IMMUTABLE", sourceChecksum: "b".repeat(64) }),
      ApprovedDesignSkillEvidenceSchema.parse({ skillId: "transitions-dev", officialRepository: "Jakubantalik/transitions.dev", status: "APPROVED_IMMUTABLE", sourceChecksum: "c".repeat(64) }),
    ];
    expect(validateDesignSkillCoverage([...emilEvidence, ...otherEvidence])).toMatchObject({ valid: true, missing: [] });
    expect(CURRENT_OFFICIAL_DESIGN_SKILLS.filter((item) => item.officialRepository === EMIL_UPSTREAM_REPOSITORY).map((item) => item.skillId)).toEqual(expect.arrayContaining(["emil-design-eng", "animate", "review-animations", "improve-animations", "find-animation-opportunities"]));
  });
});
