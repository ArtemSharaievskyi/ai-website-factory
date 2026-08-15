import type { RequirementSpecification } from "./schema";

export type BriefContradiction = {
  code:
    | "FORM_SUCCESS_SIMULATION_CONFLICT"
    | "FORM_TRANSMISSION_CONFLICT"
    | "ANALYTICS_POLICY_CONFLICT"
    | "ASSET_REPLACEMENT_CONFLICT"
    | "ROUTE_POLICY_CONFLICT"
    | "DUPLICATE_CONTRADICTORY_REQUIREMENT";
  fieldPath: string;
  summary: string;
};

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\s._-]+/g, " ").trim();
const statements = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(statements);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(statements);
};
const hasAny = (values: readonly string[], predicate: (value: string) => boolean) => values.some(predicate);
const isSimulationProhibition = (value: string) => /(?:keine|nicht|no|do not|don't|forbid|prohibit).*(?:erfolg|success|submission|übermittlung|uebermittlung|übertragung|uebertragung|vortäuschen|vortaeuschen|simulate)|(?:success|submission).*(?:prohibit|forbid|not allowed)/i.test(value);
const isAnalyticsRequirement = (value: string) => /(?:analytics|tracking|telemetry|conversion tracking|analyse)/i.test(value) && !/(?:keine|nicht|no|do not|don't|prohibit|forbid|ohne)/i.test(value);
const isLogoReplacementRequirement = (value: string) => /(?:replace|replacement|generate|create|redraw|ersetz|generier|neu erstellen).*(?:logo|marke|wordmark)|(?:logo|marke|wordmark).*(?:replace|replacement|generate|create|redraw|ersetz|generier|neu erstellen)/i.test(value);

export function validateBriefContradictions(brief: RequirementSpecification): BriefContradiction[] {
  const contradictions: BriefContradiction[] = [];
  const form = brief.formBehaviorRequirements;
  const prohibited = statements(brief.prohibitedRequirements ?? []).concat(brief.explicitExclusions);
  const allPositive = statements({
    features: brief.features,
    forms: brief.forms,
    content: brief.contentRequirements,
    typedContent: brief.content ?? [],
    constraints: brief.technicalConstraints,
    typedTechnical: brief.technical ?? [],
    decisions: brief.decisions ?? [],
    approvedIntegrations: (brief.deferredIntegrations ?? []).filter((item) => item.status === "APPROVED"),
  });

  if (form?.successUx === "SIMULATED" && hasAny(prohibited, isSimulationProhibition)) {
    contradictions.push({ code: "FORM_SUCCESS_SIMULATION_CONFLICT", fieldPath: "formBehaviorRequirements.successUx", summary: "Frontend success simulation is both required and prohibited." });
  }
  if (form?.successUx === "REAL" && form.dataTransmission === "NONE") {
    contradictions.push({ code: "FORM_TRANSMISSION_CONFLICT", fieldPath: "formBehaviorRequirements.dataTransmission", summary: "A real form success requires a transmission path, but transmission is NONE." });
  }
  if (hasAny(prohibited, (value) => /(?:analytics|tracking|telemetry|conversion tracking|analyse)/i.test(value)) && hasAny(allPositive, isAnalyticsRequirement)) {
    contradictions.push({ code: "ANALYTICS_POLICY_CONFLICT", fieldPath: "prohibitedRequirements", summary: "Analytics/tracking is both required and prohibited." });
  }
  if (brief.assetRequirements?.requiredAssets.some((asset) => asset.role === "logo" && asset.replacementForbidden) && hasAny(allPositive, isLogoReplacementRequirement)) {
    contradictions.push({ code: "ASSET_REPLACEMENT_CONFLICT", fieldPath: "assetRequirements.requiredAssets", summary: "Logo replacement is both forbidden and required." });
  }
  if (hasAny([...brief.technicalConstraints, ...statements(brief.technical ?? [])], (value) => /single[- ]page only|one[- ]page only|nur eine seite|nur eine route/i.test(value)) && brief.pages.some((page) => /impressum|datenschutz|privacy|legal/i.test(page.slug))) {
    contradictions.push({ code: "ROUTE_POLICY_CONFLICT", fieldPath: "pages", summary: "A single-page-only constraint conflicts with explicit legal routes." });
  }

  const seen = new Map<string, string>();
  const effective = statements({
    businessGoals: brief.businessGoals,
    targetAudiences: brief.targetAudiences,
    features: brief.features,
    forms: brief.forms,
    contentRequirements: brief.contentRequirements,
    content: brief.content ?? [],
    technical: brief.technical ?? [],
    seoRequirements: brief.seoRequirements,
    technicalConstraints: brief.technicalConstraints,
    explicitExclusions: brief.explicitExclusions,
    prohibitedRequirements: brief.prohibitedRequirements ?? [],
  });
  for (const statement of effective) {
    const key = normalize(statement);
    const previous = seen.get(key);
    if (previous && previous !== statement) contradictions.push({ code: "DUPLICATE_CONTRADICTORY_REQUIREMENT", fieldPath: "requirements", summary: "Equivalent canonical requirements were duplicated with conflicting text." });
    seen.set(key, statement);
  }
  return contradictions;
}

export function briefApprovalBlockers(brief: RequirementSpecification): string[] {
  return validateBriefContradictions(brief).map((item) => `BRIEF_CONTRADICTION_DETECTED:${item.code}`);
}

export function briefIsContradictionFree(brief: RequirementSpecification) {
  return validateBriefContradictions(brief).length === 0;
}
