import { RequirementSpecificationSchema, type RequirementSpecification } from "../schema";
import { BriefV3Error, BriefV3MigrationAmbiguityError } from "./errors";
import { validateCanonicalBriefV3 } from "./invariants";
import { legacyEntryRequirement, legacyRequirement, legacySourceRef, valueText } from "./legacy";
import { emptyFormBehaviorState, type CanonicalBriefV3, unresolvedFormBehaviorState } from "./schema";
import { normalizeCanonicalBrief } from "./normalize";
import { pageTargetForSlug } from "./targets";

const strings = (brief: RequirementSpecification, field: keyof RequirementSpecification): string[] => {
  const value = brief[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

const imageStrategyFromV1 = (brief: RequirementSpecification): CanonicalBriefV3["scope"]["images"] => {
  if (!brief.imagesRequired) {
    if (brief.imageSourceDecision !== "pending") throw new BriefV3MigrationAmbiguityError("imagesRequired/imageSourceDecision", "imagesRequired=false conflicts with an explicit image source decision");
    return { required: false, sourceStrategy: "NONE" };
  }
  return {
    required: true,
    sourceStrategy: brief.imageSourceDecision === "ai-generated" ? "AI_GENERATED" : brief.imageSourceDecision === "user-supplied" ? "USER_SUPPLIED" : brief.imageSourceDecision === "ai-plus-user-supplied" ? "USER_AND_AI" : brief.imageSourceDecision === "placeholders" ? "PLACEHOLDERS" : brief.imageSourceDecision === "custom" ? "CUSTOM" : "UNRESOLVED",
  };
};

const hasSinglePageConstraint = (values: readonly string[]) => values.some((value) => /single[- ]page|one[- ]page|nur eine seite|nur eine route/i.test(value));
const hasMultiPageConstraint = (values: readonly string[]) => values.some((value) => /multi[- ]page|multiple pages|mehrere seiten|mehreren routen/i.test(value));

function formFromV1(brief: RequirementSpecification): CanonicalBriefV3["decisions"]["form"] {
  const formPresent = brief.forms.length > 0;
  if (!formPresent) {
    if (brief.emailDecision === "needed") throw new BriefV3MigrationAmbiguityError("forms/emailDecision", "email is required while no legacy form is present");
    return emptyFormBehaviorState();
  }
  const transmissionMode = brief.emailDecision === "needed" ? "EMAIL" : brief.emailDecision === "not-needed" ? "NONE" : "UNRESOLVED";
  const persistenceMode = brief.storageDecision === "needed" ? "DATABASE" : brief.storageDecision === "not-needed" ? "NONE" : "UNRESOLVED";
  const serverProcessingMode = brief.backendRequirements.length || brief.supabaseRequirements.length ? "SERVER" : "UNRESOLVED";
  if (brief.storageDecision === "not-needed" && brief.supabaseRequirements.length) throw new BriefV3MigrationAmbiguityError("storageDecision/supabaseRequirements", "storage is marked not-needed while legacy database requirements are present");
  return {
    ...unresolvedFormBehaviorState({
      transmissionMode,
      persistenceMode,
      serverProcessingMode,
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
  const legacyInstructions = (brief.briefRevisionInstructions ?? []).map((statement, index) => legacyRequirement(1, "revision-instruction", index, statement, "DEFERRED_INTEGRATION"));
  const unsupportedAssumptions = brief.analysisMetadata?.unsupportedAssumptions.map((statement, index) => legacyRequirement(1, "unsupported-assumption", index, statement, "RECOMMENDATION")) ?? [];
  return [...result, administration, ...prohibited, ...legacyInstructions, ...unsupportedAssumptions];
}

function unresolvedFromV1(brief: RequirementSpecification): CanonicalBriefV3["unresolved"] {
  return brief.unresolvedItems.map((item) => ({ target: `legacy-unresolved:${item.id}`, reason: item.description, sourceRefs: [`legacy:v1:unresolved:${item.id}`] }));
}

function rejectConflictingLegacyCollections(brief: RequirementSpecification): void {
  const pages = new Map<string, string>();
  for (const page of brief.pages) {
    const previous = pages.get(page.slug);
    if (previous !== undefined && previous !== page.purpose) throw new BriefV3MigrationAmbiguityError("pages", "duplicate legacy page slug has conflicting purposes");
    pages.set(page.slug, page.purpose);
  }
  const prohibited = new Map<string, string>();
  for (const entry of brief.prohibitedRequirements ?? []) {
    const previous = prohibited.get(entry.id);
    if (previous !== undefined && previous !== entry.statement) throw new BriefV3MigrationAmbiguityError("prohibitedRequirements", "duplicate legacy requirement ID has conflicting statements");
    prohibited.set(entry.id, entry.statement);
  }
}

function finalizeV1Migration(canonical: CanonicalBriefV3): CanonicalBriefV3 {
  try {
    return validateCanonicalBriefV3(normalizeCanonicalBrief(canonical));
  } catch (error) {
    if (error instanceof BriefV3MigrationAmbiguityError) throw error;
    if (error instanceof BriefV3Error) throw new BriefV3MigrationAmbiguityError("canonical-state", error.code);
    throw error;
  }
}

export function migrateV1RecordToCanonicalBriefV3(brief: RequirementSpecification): CanonicalBriefV3 {
  rejectConflictingLegacyCollections(brief);
  if (brief.storageDecision === "not-needed" && brief.supabaseRequirements.length) throw new BriefV3MigrationAmbiguityError("storageDecision/supabaseRequirements", "storage is marked not-needed while legacy database requirements are present");
  if ((brief.pages.length > 1 && hasSinglePageConstraint(brief.technicalConstraints)) || (brief.pages.length <= 1 && hasMultiPageConstraint(brief.technicalConstraints))) {
    throw new BriefV3MigrationAmbiguityError("pages/technicalConstraints", "legacy route representations disagree");
  }
  const databaseMode = brief.storageDecision === "needed" ? (brief.supabaseRequirements.length ? "SUPABASE" : "OTHER") : brief.storageDecision === "not-needed" ? "NONE" : "UNRESOLVED";
  const authMode = brief.authenticationDecision === "no-authentication-guest-first" ? "NONE" : brief.authenticationDecision === "authentication-required" ? "REQUIRED" : "UNRESOLVED";
  const routePolicy = brief.pages.length > 1 ? "MULTI_PAGE" : brief.pages.length === 1 ? "SINGLE_PAGE" : "UNRESOLVED";
  const sourceBrand = valueText(brief.suppliedBrandInformation);
  const logoDescription = valueText(brief.suppliedLogoLocation);
  const canonical: CanonicalBriefV3 = {
    schemaVersion: 3,
    summary: brief.projectSummary,
    title: brief.projectTitle ?? null,
    scope: {
      protectedFunctionality: brief.protectedFunctionalityRequired,
      images: imageStrategyFromV1(brief),
    },
    pages: brief.pages.map((page, index) => ({ id: pageTargetForSlug(page.slug), slug: page.slug, purpose: page.purpose, sourceRefs: [legacySourceRef(1, "pages", index, page.slug)] })),
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
      inventedFactsPolicy: "UNRESOLVED",
    },
    localization: brief.localization,
    evidence: brief.evidence.map((item, index) => ({ ...item, sourceRefs: [legacySourceRef(1, "evidence", index, `${item.field}:${item.source}:${item.excerpt}`)] })),
    unresolved: unresolvedFromV1(brief),
  };
  return finalizeV1Migration(canonical);
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
