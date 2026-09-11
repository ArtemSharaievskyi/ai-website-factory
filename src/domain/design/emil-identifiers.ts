/**
 * Stable, revision-qualified identifiers used by domain contracts. The
 * upstream audit and registry import remain integration concerns.
 */
export const EMIL_UPSTREAM_REVISION = "d23d7f88a2e21c9e4b1418c7abe420f5c1052ba7" as const;
const revision = EMIL_UPSTREAM_REVISION.slice(0, 12);

export const EMIL_DESIGN_ENGINEERING_SKILL_ID = `emil-design-eng-${revision}` as const;
export const EMIL_ANIMATE_SKILL_ID = `animate-${revision}` as const;
export const EMIL_ANIMATION_REVIEW_SKILL_ID = `review-animations-${revision}` as const;
export const EMIL_ANIMATION_IMPROVEMENT_SKILL_ID = `improve-animations-${revision}-r1` as const;
export const EMIL_ANIMATION_OPPORTUNITY_SKILL_ID = `find-animation-opportunities-${revision}-r1` as const;
