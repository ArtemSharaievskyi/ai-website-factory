import { RequirementSpecificationSchema, type RequirementSpecification } from "../schema";
import { BriefV3Error } from "./errors";
import { legacyEntryRequirement, legacyRequirement, legacySourceRef, valueText, isLegacySimulationProhibition } from "./legacy";
import { emptyFormBehaviorState, type CanonicalBriefV3, unresolvedFormBehaviorState } from "./schema";
import { normalizeCanonicalBrief } from "./normalize";
import { pageTargetForSlug } from "./targets";

const strings = (brief: RequirementSpecification, field: keyof RequirementSpecification): string[] => {
  const value = brief[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

const hasSinglePageConstraint = (values: readonly string[]) => values.some((value) => /single[- ]page|one[- ]page|nur eine seite|nur eine route/i.test(value));
const hasMultiPageConstraint = (values: readonly string[]) => values.some((value) => /multi[- ]page|multiple pages|mehrere seiten|mehreren routen/i.test(value));

function formFromV1(brief: RequirementSpecification): CanonicalBriefV3["decisions"]["form"] {
  const formPresent = brief.forms.length > 0;
  if (!formPresent) return emptyFormBehaviorState();
  const prohibition = [...brief.explicitExclusions, ...(brief.prohibitedRequirements ?? []).map((entry) => entry.statement)].find(isLegacySimulationProhibition);
  const transmissionMode = brief.emailDecision === "needed" ? "EMAIL" : brief.emailDecision === "not-needed" ? "NONE" : "UNRESOLVED";
  if (prohibition) return {
    mode: "REAL",
    formPresent: true,
    validation: "ACTIVE",
    transmissionMode: transmissionMode === "NONE" ? "UNRESOLVED" : transmissionMode,
    persistenceMode: brief.storageDecision === "needed" ? "DATABASE" : brief.storageDecision === "not-needed" ? "NONE" : "UNRESOLVED",
    serverProcessingMode: brief.backendRequirements.length || brief.supabaseRequirements.length ? "SERVER" : "UNRESOLVED",
    externalProviderMode: "UNRESOLVED",
    privacyConsentMode: "UNRESOLVED",
    interactionStates: [],
  };
  return {
    ...unresolvedFormBehaviorState({
      transmissionMode,
      persistenceMode: brief.storageDecision === "needed" ? "DATABASE" : brief.storageDecision === "not-needed" ? "NONE" : "UNRESOLVED",
      serverProcessingMode: brief.backendRequirements.length || brief.supabaseRequirements.length ? "SERVER" : "UNRESOLVED",
    }),
  };
}

function requirementsFromV1(brief: RequirementSpecification): CanonicalBriefV3["requirements"] {
  const fieldMap: Array<[keyof RequirementSpecification, string, Parameters<typeof legacyRequirement>[4]]> = [
    ["businessGoals", "business-goals", "BUSINESS_GOAL"],
    ["targetAudiences", "target-audiences", "AUDIENCE"],
    ["userRoles", "user-roles", "USER_ROLE"],
    ["features", "features", "FEATURE"],
    ["forms", "forms", "FORM"],
    ["contentRequirements", "content", "CONTENT"],
    ["backendRequirements", "backend", "BACKEND"],
    ["supabaseRequirements", "supabase", "DATABASE"],
    ["seoRequirements", "seo", "SEO"],
    ["technicalConstraints", "technical", "TECHNICAL"],
    ["explicitExclusions", "exclusions", "EXCLUSION"],
    ["userAcceptanceCriteria", "acceptance", "ACCEPTANCE"],
    ["contactFacts", "contact-facts", "CONTACT_FACT"],
    ["legalFacts", "legal-facts", "LEGAL_FACT"],
    ["brandFacts", "brand-facts", "BRAND_FACT"],
    ["logoMetadata", "logo-metadata", "LOGO_METADATA"],
    ["imageSourcingNotes", "image-notes", "IMAGE_NOTE"],
    ["recommendations", "recommendations", "RECOMMENDATION"],
  ];
  const result = fieldMap.flatMap(([field, identity, category]) => strings(brief, field).map((statement, index) => legacyRequirement(1, identity, index, statement, category)));
  const prohibited = (brief.prohibitedRequirements ?? []).map((entry, index) => legacyEntryRequirement(1, "prohibited", index, entry, "PROHIBITED"));
  const administration = legacyRequirement(1, "administration", 0, `administration: ${brief.administrationDecision}`, "ADMINISTRATION", ["legacy:v1:administration"]);
  return [...result, administration, ...prohibited];
}

export function migrateV1RecordToCanonicalBriefV3(brief: RequirementSpecification): CanonicalBriefV3 {
  const databaseMode = brief.storageDecision === "needed" ? (brief.supabaseRequirements.length ? "SUPABASE" : "OTHER") : brief.storageDecision === "not-needed" ? "NONE" : "UNRESOLVED";
  const authMode = brief.authenticationDecision === "no-authentication-guest-first" ? "NONE" : brief.authenticationDecision === "authentication-required" ? "REQUIRED" : "UNRESOLVED";
  const routePolicy = hasSinglePageConstraint(brief.technicalConstraints) ? "SINGLE_PAGE" : hasMultiPageConstraint(brief.technicalConstraints) || brief.pages.length > 1 ? "MULTI_PAGE" : "UNRESOLVED";
  const sourceBrand = valueText(brief.suppliedBrandInformation);
  const logoDescription = valueText(brief.suppliedLogoLocation);
  const canonical: CanonicalBriefV3 = {
    schemaVersion: 3,
    summary: brief.projectSummary,
    title: brief.projectTitle ?? null,
    scope: {
      protectedFunctionality: brief.protectedFunctionalityRequired,
      imagesRequired: brief.imagesRequired,
      imageSourceStrategy: brief.imageSourceDecision === "ai-generated" ? "AI_GENERATED" : brief.imageSourceDecision === "user-supplied" ? "USER_SUPPLIED" : brief.imageSourceDecision === "ai-plus-user-supplied" ? "USER_AND_AI" : brief.imageSourceDecision === "placeholders" ? "PLACEHOLDERS" : brief.imageSourceDecision === "custom" ? "CUSTOM" : "UNRESOLVED",
    },
    pages: brief.pages.map((page, index) => ({ id: pageTargetForSlug(page.slug), slug: page.slug, purpose: page.purpose, sourceRefs: [legacySourceRef(1, "pages", index)] })),
    requirements: requirementsFromV1(brief),
    decisions: {
      form: formFromV1(brief),
      database: { mode: databaseMode },
      auth: { mode: authMode },
      analytics: { mode: "UNRESOLVED" },
      routePolicy: { mode: routePolicy },
    },
    assets: [],
    brand: {
      referenceStrategy: sourceBrand ? "USER_SUPPLIED" : "UNRESOLVED",
      suppliedInformation: sourceBrand,
      suppliedLogoDescription: logoDescription,
    },
    seo: {
      primaryKeywords: [],
      exactTitle: null,
      exactMetaDescription: null,
      locationTargeting: [],
      pageMetadata: [],
    },
    legal: {
      placeholderPolicy: "UNRESOLVED",
      inventedFactsPolicy: [...brief.technicalConstraints, ...brief.explicitExclusions, ...brief.legalFacts].some((value) => /invent|erfind|fakt/i.test(value)) ? "FORBIDDEN" : "UNRESOLVED",
    },
    localization: brief.localization,
    unresolved: brief.unresolvedItems.map((item) => ({ target: `legacy-unresolved:${item.id}`, reason: item.description, sourceRefs: [`legacy:v1:unresolved:${item.id}`] })),
  };
  return normalizeCanonicalBrief(canonical);
}

export function migrateV1ToCanonicalBriefV3(input: unknown): CanonicalBriefV3 {
  try {
    const parsed = RequirementSpecificationSchema.parse(input);
    if (parsed.briefSchemaVersion === 2) throw new BriefV3Error("BRIEF_V3_MIGRATION_INVALID", { reason: "V2 input requires the V2 adapter" });
    return migrateV1RecordToCanonicalBriefV3(parsed);
  } catch (error) {
    if (error instanceof BriefV3Error) throw error;
    throw new BriefV3Error("BRIEF_V3_MIGRATION_INVALID", { reason: "V1 Brief could not be parsed" });
  }
}
