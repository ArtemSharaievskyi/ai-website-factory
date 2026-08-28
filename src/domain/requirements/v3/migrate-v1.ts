import { RequirementSpecificationSchema, type RequirementSpecification } from "../schema";
import { BriefV3Error, BriefV3MigrationAmbiguityError } from "./errors";
import { validateCanonicalBriefV3 } from "./invariants";
import { legacyEntryRequirement, legacyRequirement, legacySourceRef, valueText } from "./legacy";
import { emptyFormBehaviorState, type CanonicalBriefV3, unresolvedFormBehaviorState } from "./schema";
import { normalizeCanonicalBrief } from "./normalize";
import { pageTargetForSlug } from "./targets";
import { canonicalizeLegacyBriefV3WithLineage, type CanonicalizedLegacyBriefV3 } from "./identity";

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

const behaviorTextFromV1 = (brief: RequirementSpecification): string[] => [
  ...brief.forms,
  ...brief.explicitExclusions,
  ...brief.technicalConstraints,
  ...brief.userAcceptanceCriteria,
];

const hasMarker = (values: readonly string[], pattern: RegExp) => values.some((value) => pattern.test(value));

const markerValues = (values: readonly string[], marker: string, field: string): string[] => {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp(`^\\s*${escaped}\\s*:\\s*(.*)\\s*$`, "iu");
  const matches = values.flatMap((value) => {
    const match = prefix.exec(value);
    if (!match) return [];
    const body = match[1]?.trim() ?? "";
    const quoted = /^(?:„|“|")(.+?)(?:“|”|")\.?\s*$/u.exec(body);
    if (!quoted?.[1]?.trim()) throw new BriefV3MigrationAmbiguityError(field, "recognized legacy marker has an unsupported value shape");
    return [quoted[1].trim()];
  });
  if (matches.length > 1) throw new BriefV3MigrationAmbiguityError(field, "duplicate legacy markers disagree or are ambiguous");
  return matches;
};

function seoFromV1(brief: RequirementSpecification): CanonicalBriefV3["seo"] {
  const exactTitle = markerValues(brief.seoRequirements, "SEO-Titel exakt", "seoRequirements.exactTitle")[0] ?? null;
  const exactMetaDescription = markerValues(brief.seoRequirements, "Meta Description exakt", "seoRequirements.exactMetaDescription")[0] ?? null;
  const keywordLines = brief.seoRequirements.flatMap((value) => {
    const match = /^\s*Keywords\s*:\s*(.*?)\s*$/iu.exec(value);
    return match ? [match[1]!.replace(/[.]\s*$/u, "").trim()] : [];
  });
  if (keywordLines.length > 1) throw new BriefV3MigrationAmbiguityError("seoRequirements.primaryKeywords", "duplicate legacy keyword markers are ambiguous");
  const primaryKeywords = keywordLines[0]
    ? keywordLines[0].split(";").map((keyword) => keyword.trim()).filter(Boolean)
    : [];
  return { primaryKeywords, exactTitle, exactMetaDescription, locationTargeting: [], pageMetadata: [] };
}

function legalFromV1(brief: RequirementSpecification): CanonicalBriefV3["legal"] {
  const values = [...brief.legalFacts, ...brief.explicitExclusions, ...brief.technicalConstraints, ...brief.unresolvedItems.map((item) => item.description)];
  const usePlaceholders = hasMarker(values, /(?:use|with|clear|explicit)\s+(?:explicit\s+)?(?:placeholders?|platzhalter)|(?:klare|explizite)\s+platzhalter/i);
  const forbidPlaceholders = hasMarker(values, /(?:no|without|keine?|ohne)\s+(?:any\s+)?(?:placeholders?|platzhalter)/i);
  if (usePlaceholders && forbidPlaceholders) throw new BriefV3MigrationAmbiguityError("legal.placeholderPolicy", "legacy placeholder policies conflict");
  const inventedFactsForbidden = hasMarker(values, /(?:do not|never|no|without|keine?|nicht|ohne)\s+(?:invent\w*|fabricat\w*|erfinden|erfund\w*)\s+(?:facts?|fakten|business facts?|Unternehmensdaten)/i);
  const inventedFactsAllowed = hasMarker(values, /(?:invent\w*|fabricat\w*|erfund\w*)\s+(?:facts?|fakten|business facts?|Unternehmensdaten)\s+(?:allowed|erlaubt)/i);
  if (inventedFactsForbidden && inventedFactsAllowed) throw new BriefV3MigrationAmbiguityError("legal.inventedFactsPolicy", "legacy invented-facts policies conflict");
  return {
    placeholderPolicy: usePlaceholders ? "USE_EXPLICIT_PLACEHOLDERS" : forbidPlaceholders ? "NO_PLACEHOLDERS" : "UNRESOLVED",
    inventedFactsPolicy: inventedFactsForbidden ? "FORBIDDEN" : inventedFactsAllowed ? "ALLOWED" : "UNRESOLVED",
  };
}

function serverProcessingModeFromV1(brief: RequirementSpecification): "NONE" | "SERVER" | "UNRESOLVED" {
  const hasServerRequirements = brief.backendRequirements.length > 0 || brief.supabaseRequirements.length > 0;
  const noServer = hasMarker(behaviorTextFromV1(brief), /(?:keine?|kein|no|without|ohne)\s+(?:\w+\s+){0,4}(?:api|backend|server(?:\s+action)?|datenbank|database)/i);
  if (hasServerRequirements && noServer) throw new BriefV3MigrationAmbiguityError("forms.serverProcessingMode", "legacy server-processing requirements conflict");
  return hasServerRequirements ? "SERVER" : noServer ? "NONE" : "UNRESOLVED";
}

function externalProviderModeFromV1(brief: RequirementSpecification): "NONE" | "UNRESOLVED" {
  const noExternalProvider = hasMarker(behaviorTextFromV1(brief), /(?:keine?|kein|no|without|ohne)[^.!?]{0,48}(?:external services?|extern\w*\s+(?:dienste|services?)|third[- ]party|external provider|drittanbieter)/i);
  return noExternalProvider ? "NONE" : "UNRESOLVED";
}

function privacyConsentModeFromV1(brief: RequirementSpecification): "REQUIRED" | "OPTIONAL" | "UNRESOLVED" {
  const values = behaviorTextFromV1(brief);
  const required = hasMarker(values, /(?:required|mandatory|verpflicht\w*|pflicht\w*)\s+(?:\w+\s+){0,4}(?:privacy|consent|datenschutz|einwilligung|checkbox)/i);
  const optional = hasMarker(values, /(?:optional|freiwillig)\s+(?:\w+\s+){0,4}(?:privacy|consent|datenschutz|einwilligung|checkbox)/i);
  if (required && optional) throw new BriefV3MigrationAmbiguityError("forms.privacyConsentMode", "legacy privacy consent requirements conflict");
  return required ? "REQUIRED" : optional ? "OPTIONAL" : "UNRESOLVED";
}

function analyticsModeFromV1(brief: RequirementSpecification): "NONE" | "APPROVED_PROVIDER" | "OTHER" | "UNRESOLVED" {
  const values = [...brief.features, ...brief.technicalConstraints, ...brief.explicitExclusions, ...brief.recommendations];
  const prohibited = hasMarker(values, /(?:keine?|kein|no|without|ohne)[^.!?]{0,48}(?:analytics|tracking|telemetrie|analyse)/i);
  const required = hasMarker(values, /(?:require|needed|erforderlich|einrichten|aktivieren|enable|add)[^.!?]{0,48}(?:analytics|tracking|telemetrie|analyse)/i);
  if (prohibited && required) throw new BriefV3MigrationAmbiguityError("analytics", "legacy analytics requirements conflict");
  return prohibited ? "NONE" : "UNRESOLVED";
}

function formFromV1(brief: RequirementSpecification): CanonicalBriefV3["decisions"]["form"] {
  const formPresent = brief.forms.length > 0;
  if (!formPresent) {
    if (brief.emailDecision === "needed") throw new BriefV3MigrationAmbiguityError("forms/emailDecision", "email is required while no legacy form is present");
    return emptyFormBehaviorState();
  }
  const transmissionMode = brief.emailDecision === "needed" ? "EMAIL" : brief.emailDecision === "not-needed" ? "NONE" : "UNRESOLVED";
  const persistenceMode = brief.storageDecision === "needed" ? "DATABASE" : brief.storageDecision === "not-needed" ? "NONE" : "UNRESOLVED";
  const serverProcessingMode = serverProcessingModeFromV1(brief);
  if (brief.storageDecision === "not-needed" && brief.supabaseRequirements.length) throw new BriefV3MigrationAmbiguityError("storageDecision/supabaseRequirements", "storage is marked not-needed while legacy database requirements are present");
  return {
    ...unresolvedFormBehaviorState({
      transmissionMode,
      persistenceMode,
      serverProcessingMode,
      externalProviderMode: externalProviderModeFromV1(brief),
      privacyConsentMode: privacyConsentModeFromV1(brief),
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
  // Revision prompts and analysis assumptions are historical/diagnostic fields, not current
  // effective requirements. They remain on the legacy document but must not enter V3 current
  // state, where doing so would resurrect history and can violate V3 bounds.
  return [...result, administration, ...prohibited];
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

function finalizeV1Migration(canonical: CanonicalBriefV3, scope: { projectId: string; projectVersion: number }): CanonicalizedLegacyBriefV3 {
  try {
    return canonicalizeLegacyBriefV3WithLineage(validateCanonicalBriefV3(normalizeCanonicalBrief(canonical)), scope);
  } catch (error) {
    if (error instanceof BriefV3MigrationAmbiguityError) throw error;
    if (error instanceof BriefV3Error) throw new BriefV3MigrationAmbiguityError("canonical-state", error.code);
    throw error;
  }
}

export function migrateV1RecordToCanonicalBriefV3WithLineage(brief: RequirementSpecification): CanonicalizedLegacyBriefV3 {
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
      analytics: { mode: analyticsModeFromV1(brief) },
      routePolicy: { mode: routePolicy },
    },
    assets: [],
    brand: {
      referenceStrategy: sourceBrand ? "USER_SUPPLIED" : "UNRESOLVED",
      suppliedInformation: sourceBrand,
      suppliedLogoDescription: logoDescription,
    },
    seo: seoFromV1(brief),
    legal: legalFromV1(brief),
    localization: brief.localization,
    evidence: brief.evidence.map((item, index) => ({ ...item, sourceRefs: [legacySourceRef(1, "evidence", index, `${item.field}:${item.source}:${item.excerpt}`)] })),
    unresolved: unresolvedFromV1(brief),
  };
  return finalizeV1Migration(canonical, { projectId: brief.projectId, projectVersion: brief.projectVersion });
}

export function migrateV1RecordToCanonicalBriefV3(brief: RequirementSpecification): CanonicalBriefV3 {
  return migrateV1RecordToCanonicalBriefV3WithLineage(brief).brief;
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
