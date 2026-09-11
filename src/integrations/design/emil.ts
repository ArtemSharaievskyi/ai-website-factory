import { z } from "zod";
import {
  EMIL_ANIMATE_SKILL_ID,
  EMIL_ANIMATION_IMPROVEMENT_SKILL_ID,
  EMIL_ANIMATION_OPPORTUNITY_SKILL_ID,
  EMIL_ANIMATION_REVIEW_SKILL_ID,
  EMIL_DESIGN_ENGINEERING_SKILL_ID,
  EMIL_UPSTREAM_REVISION,
} from "@/domain/design/emil-identifiers";

export {
  EMIL_ANIMATE_SKILL_ID,
  EMIL_ANIMATION_IMPROVEMENT_SKILL_ID,
  EMIL_ANIMATION_OPPORTUNITY_SKILL_ID,
  EMIL_ANIMATION_REVIEW_SKILL_ID,
  EMIL_DESIGN_ENGINEERING_SKILL_ID,
  EMIL_UPSTREAM_REVISION,
} from "@/domain/design/emil-identifiers";

export const EMIL_UPSTREAM_REPOSITORY = "emilkowalski/skills" as const;
export const EMIL_UPSTREAM_URL = "https://github.com/emilkowalski/skills" as const;
export const EMIL_LICENSE = "MIT" as const;
export const EMIL_PROVENANCE_POLICY_VERSION = "emil-skills-provenance-v1" as const;

export const EmilSkillProvenanceSchema = z.object({
  skillId: z.enum(["emil-design-eng", "animate", "review-animations", "improve-animations", "find-animation-opportunities"]),
  registrySkillId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  upstreamPath: z.string().regex(/^skills\/[a-z0-9-]+$/),
  sourceRepository: z.literal(EMIL_UPSTREAM_REPOSITORY),
  sourceRef: z.string().url(),
  reviewedRevision: z.literal(EMIL_UPSTREAM_REVISION),
  license: z.literal(EMIL_LICENSE),
  approvedContentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type EmilSkillProvenance = z.infer<typeof EmilSkillProvenanceSchema>;

const approvedContentChecksums: Record<EmilSkillProvenance["skillId"], string> = {
  "emil-design-eng": "2f3d012f11fbdc9911ea89a70c240c3187faebab093f0039cc31d67d3fe020ff",
  animate: "ec374467bfc8bc92699d55bd7812fb937a67f741ae21ee34c615ae2e8fb9eefa",
  "review-animations": "30ba484b8e13597166f6977401bae2af814c96daf7b8c48f4d14a3ac492e3f2e",
  "improve-animations": "b72d7da813557db981be6c8335099225333aba583f6e1678c5074846c2634cb9",
  "find-animation-opportunities": "2d68360eb32f52f042816810935d43cfa13a60bd2c8d4582cb316ef8c6bb7de3",
};

const skill = (skillId: EmilSkillProvenance["skillId"]): EmilSkillProvenance => EmilSkillProvenanceSchema.parse({
  skillId,
  // The stable suffix keeps these current records distinct from older
  // unqualified registry imports while remaining deterministic on a clean
  // registry and across reruns.
  registrySkillId: `${skillId}-${EMIL_UPSTREAM_REVISION.slice(0, 12)}${["improve-animations", "find-animation-opportunities"].includes(skillId) ? "-r1" : ""}`,
  upstreamPath: `skills/${skillId}`,
  sourceRepository: EMIL_UPSTREAM_REPOSITORY,
  sourceRef: `${EMIL_UPSTREAM_URL}/tree/${EMIL_UPSTREAM_REVISION}/skills/${skillId}`,
  reviewedRevision: EMIL_UPSTREAM_REVISION,
  license: EMIL_LICENSE,
  approvedContentChecksum: approvedContentChecksums[skillId],
});

export const EMIL_SKILL_PROVENANCE = Object.freeze([
  skill("emil-design-eng"),
  skill("animate"),
  skill("review-animations"),
  skill("improve-animations"),
  skill("find-animation-opportunities"),
] as const);

export const EMIL_IMPLEMENTATION_SKILL_IDS = Object.freeze([
  EMIL_DESIGN_ENGINEERING_SKILL_ID,
  EMIL_ANIMATE_SKILL_ID,
] as const);

export const EMIL_REVIEW_SKILL_IDS = Object.freeze([
  EMIL_DESIGN_ENGINEERING_SKILL_ID,
  EMIL_ANIMATION_REVIEW_SKILL_ID,
] as const);

export const EMIL_ADVISORY_SKILL_IDS = Object.freeze([
  EMIL_ANIMATION_IMPROVEMENT_SKILL_ID,
  EMIL_ANIMATION_OPPORTUNITY_SKILL_ID,
] as const);

export const EMIL_ANIMATION_RULES = Object.freeze({
  easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
  easeInOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  easeDrawer: "cubic-bezier(0.32, 0.72, 0, 1)",
  buttonPressMinMs: 100,
  buttonPressMaxMs: 160,
  popoverMinMs: 125,
  popoverMaxMs: 200,
  dropdownMinMs: 150,
  dropdownMaxMs: 250,
  maxUiDurationMs: 300,
  minScale: 0.9,
  maxScale: 0.97,
  staggerMinMs: 30,
  staggerMaxMs: 80,
} as const);

export function emilProvenanceForRegistrySkill(registrySkillId: string) {
  return EMIL_SKILL_PROVENANCE.find((item) => item.registrySkillId === registrySkillId);
}
