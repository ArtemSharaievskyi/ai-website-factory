import { ReviewActivationPlanSchema, ReviewAgentIdSchema, type ReviewActivationPlan, type ReviewAgentId, type ReviewCapability } from "@/domain/review/lightweight";

export const LIGHTWEIGHT_REVIEW_AGENT_IDS = [
  "browser-qa",
  "security-reviewer",
  "accessibility-review",
  "performance-review",
  "visual-regression",
  "code-integration-reviewer",
  "release-readiness",
  "seo-review",
  "content-quality",
  "dependency-guardian",
  "documentation",
] as const satisfies readonly ReviewAgentId[];

export type ReviewActivationInput = {
  implementationComplete: boolean;
  capabilities: readonly ReviewCapability[];
};

const unique = <T>(values: readonly T[]) => [...new Set(values)];
const has = (capabilities: ReadonlySet<ReviewCapability>, ...values: ReviewCapability[]) => values.some((value) => capabilities.has(value));

export function buildReviewActivationPlan(input: ReviewActivationInput): ReviewActivationPlan {
  const capabilities = new Set(input.capabilities);
  const required: ReviewAgentId[] = [];
  const skipped: ReviewActivationPlan["skipped"] = [];
  const activate = (agent: ReviewAgentId, condition: boolean, reason: string) => {
    if (input.implementationComplete && condition) required.push(agent);
    else skipped.push({ agent, reason: input.implementationComplete ? reason : "Implementation is not complete." });
  };

  activate("browser-qa", has(capabilities, "INTERACTIVE_UI", "PUBLIC_SITE"), "No approved route, public page, or interactive user flow requires browser QA.");
  activate("security-reviewer", has(capabilities, "AUTH", "DATABASE", "STORAGE", "UPLOAD", "EXTERNAL_API"), "No approved authentication, data, storage, upload, or external-API security surface is present; generic review must not invent one.");
  activate("accessibility-review", has(capabilities, "INTERACTIVE_UI", "PUBLIC_SITE", "APPROVED_DESIGN"), "No approved user-interface surface requires accessibility review.");
  activate("performance-review", true, "Performance review is normally required for an implemented project.");
  activate("visual-regression", capabilities.has("APPROVED_DESIGN"), "No approved Design artifact is bound to this implementation snapshot.");
  activate("code-integration-reviewer", input.implementationComplete, "Code review requires a completed implementation snapshot.");
  activate("release-readiness", input.implementationComplete, "Release readiness requires a completed implementation snapshot.");
  activate("seo-review", has(capabilities, "PUBLIC_SITE", "INDEXABLE_PUBLIC_PAGES"), "The project is not approved as public or indexable; SEO review is not applicable.");
  activate("content-quality", capabilities.has("PUBLIC_FACTUAL_CONTENT"), "No public factual content capability is approved; content review is not applicable.");
  activate("dependency-guardian", capabilities.has("DEPENDENCY_DELTA"), "No implementation dependency delta is present.");
  activate("documentation", capabilities.has("DOCUMENTATION_REQUEST"), "Documentation was not requested for this cycle.");

  const active = new Set(required);
  const normalized = ReviewActivationPlanSchema.parse({
    required: unique(required),
    optional: [],
    skipped: skipped.filter((item) => !active.has(item.agent)).map((item) => ({ ...item, agent: ReviewAgentIdSchema.parse(item.agent) })),
  });
  return normalized;
}
