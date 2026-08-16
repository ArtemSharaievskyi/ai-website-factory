import { ProjectBriefV2Schema, RequirementSpecificationSchema, type ProjectBriefV2 } from "../schema";
import { BriefV3Error, BriefV3MigrationAmbiguityError } from "./errors";
import { legacyAsset, legacyAssetId, legacyDecisionRequirement, legacyDeferredRequirement, legacyEntryRequirement, legacyRequirement, isLegacySimulationProhibition } from "./legacy";
import { migrateV1RecordToCanonicalBriefV3 } from "./migrate-v1";
import { normalizeCanonicalBrief } from "./normalize";
import { type CanonicalBriefV3, type FormBehaviorState } from "./schema";
import { AnalyticsModeSchema, AuthModeSchema, DatabaseModeSchema, RoutePolicySchema } from "./schema";

const typedEntry = (field: string, index: number, entry: { id: string; statement: string; sourceRefs: string[] }, category: Parameters<typeof legacyRequirement>[4]) => legacyEntryRequirement(2, field, index, entry, category);

function hasLegacySimulationProhibition(brief: ProjectBriefV2): string | undefined {
  return [...brief.explicitExclusions, ...brief.prohibitedRequirements.map((entry) => entry.statement)].find(isLegacySimulationProhibition);
}

function formFromV2(brief: ProjectBriefV2): FormBehaviorState {
  const typed = brief.formBehaviorRequirements;
  const legacyProhibition = hasLegacySimulationProhibition(brief);
  if (!typed.formPresent) {
    if (typed.successUx !== "NONE" || typed.dataTransmission !== "NONE" || typed.persistence !== "NONE" || typed.thirdParty !== "NONE" || typed.privacyCheckbox !== "NOT_APPLICABLE") {
      throw new BriefV3MigrationAmbiguityError("formBehaviorRequirements", "formPresent=false conflicts with active form decisions");
    }
    return {
      mode: "NONE",
      formPresent: false,
      validation: "NOT_REQUIRED",
      transmissionMode: "NONE",
      persistenceMode: "NONE",
      serverProcessingMode: "NONE",
      externalProviderMode: "NONE",
      privacyConsentMode: "NOT_APPLICABLE",
      interactionStates: [],
    };
  }
  if (typed.validation !== "ACTIVE") throw new BriefV3MigrationAmbiguityError("formBehaviorRequirements", "formPresent=true conflicts with NOT_REQUIRED validation");
  if (typed.successUx === "SIMULATED" && legacyProhibition) throw new BriefV3MigrationAmbiguityError("formBehaviorRequirements", "legacy prohibition conflicts with typed simulated success");
  if (typed.successUx === "REAL" && typed.dataTransmission === "NONE") throw new BriefV3MigrationAmbiguityError("formBehaviorRequirements", "real success cannot be mapped with NONE transmission");
  const interactionStates = typed.interactionStates.map((entry, index) => typedEntry("form-interaction", index, entry, "FORM_INTERACTION"));
  const shared = {
    formPresent: true as const,
    validation: typed.validation,
    transmissionMode: typed.dataTransmission,
    persistenceMode: typed.persistence,
    serverProcessingMode: brief.backendRequirements.length || brief.supabaseRequirements.length ? "SERVER" as const : "UNRESOLVED" as const,
    externalProviderMode: typed.thirdParty,
    privacyConsentMode: typed.privacyCheckbox,
    interactionStates,
  };
  if (typed.successUx === "SIMULATED") return { ...shared, mode: "SIMULATED" };
  if (typed.successUx === "REAL") return { ...shared, mode: "REAL", transmissionMode: typed.dataTransmission as Exclude<typeof typed.dataTransmission, "NONE"> };
  return { ...shared, mode: "UNRESOLVED" };
}

function overrideDecision<T extends string>(brief: ProjectBriefV2, key: string, schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, fallback: T): T {
  const item = brief.decisions.find((decision) => decision.key.trim().toLocaleLowerCase() === key);
  if (!item) return fallback;
  const parsed = schema.safeParse(item.value);
  return parsed.success && parsed.data ? parsed.data : fallback;
}

function checkLegacyDecisionConflicts(brief: ProjectBriefV2, form: FormBehaviorState): void {
  if (brief.emailDecision === "needed" && form.transmissionMode === "NONE") throw new BriefV3MigrationAmbiguityError("emailDecision", "legacy needed conflicts with typed NONE transmission");
  if (brief.emailDecision === "not-needed" && form.transmissionMode === "EMAIL") throw new BriefV3MigrationAmbiguityError("emailDecision", "legacy not-needed conflicts with typed EMAIL transmission");
}

export function migrateV2RecordToCanonicalBriefV3(brief: ProjectBriefV2): CanonicalBriefV3 {
  const baseInput = { ...brief, prohibitedRequirements: undefined };
  const base = migrateV1RecordToCanonicalBriefV3(RequirementSpecificationSchema.parse(baseInput));
  const form = formFromV2(brief);
  checkLegacyDecisionConflicts(brief, form);
  const requirements = [
    ...base.requirements,
    ...brief.content.map((entry, index) => typedEntry("content", index, entry, "CONTENT")),
    ...brief.technical.map((entry, index) => typedEntry("technical", index, entry, "TECHNICAL")),
    ...brief.brandVisualRequirements.colorDirection.map((entry, index) => typedEntry("brand-color", index, entry, "BRAND_VISUAL")),
    ...brief.brandVisualRequirements.typographyDirection.map((entry, index) => typedEntry("brand-typography", index, entry, "BRAND_VISUAL")),
    ...brief.brandVisualRequirements.spacingLayoutDirection.map((entry, index) => typedEntry("brand-layout", index, entry, "BRAND_VISUAL")),
    ...brief.brandVisualRequirements.cardSurfaceStyling.map((entry, index) => typedEntry("brand-surface", index, entry, "BRAND_VISUAL")),
    ...brief.brandVisualRequirements.iconDirection.map((entry, index) => typedEntry("brand-icons", index, entry, "BRAND_VISUAL")),
    ...brief.brandVisualRequirements.imageryDirection.map((entry, index) => typedEntry("brand-imagery", index, entry, "BRAND_VISUAL")),
    ...brief.brandVisualRequirements.brandReferenceUsage.map((entry, index) => typedEntry("brand-reference", index, entry, "BRAND_VISUAL")),
    ...brief.brandVisualRequirements.visualAntiPatterns.map((entry, index) => typedEntry("brand-anti-pattern", index, entry, "BRAND_VISUAL")),
    ...brief.uxResponsiveRequirements.responsiveBehavior.map((entry, index) => typedEntry("responsive", index, entry, "UX_RESPONSIVE")),
    ...brief.uxResponsiveRequirements.interactionRequirements.map((entry, index) => typedEntry("interaction", index, entry, "UX_RESPONSIVE")),
    ...(brief.uxResponsiveRequirements.mobileFirst ? [legacyRequirement(2, "responsive-mobile-first", 0, "Mobile-first layout.", "UX_RESPONSIVE", ["legacy:v2:ux:mobile-first"])] : []),
    ...(brief.uxResponsiveRequirements.stickyMobileCta ? [legacyRequirement(2, "responsive-sticky-cta", 0, "Sticky mobile CTA.", "UX_RESPONSIVE", ["legacy:v2:ux:sticky-cta"])] : []),
    ...(brief.uxResponsiveRequirements.smoothScroll ? [legacyRequirement(2, "responsive-smooth-scroll", 0, "Smooth scrolling.", "UX_RESPONSIVE", ["legacy:v2:ux:smooth-scroll"])] : []),
    ...(brief.uxResponsiveRequirements.reducedMotion ? [legacyRequirement(2, "responsive-reduced-motion", 0, "Respect reduced-motion preferences.", "UX_RESPONSIVE", ["legacy:v2:ux:reduced-motion"])] : []),
    ...brief.legalComplianceConstraints.constraints.map((entry, index) => typedEntry("legal-constraint", index, entry, "LEGAL_CONSTRAINT")),
    ...brief.prohibitedRequirements.map((entry, index) => typedEntry("prohibited", index, entry, "PROHIBITED")),
    ...brief.deferredIntegrations.map((entry, index) => legacyDeferredRequirement(2, "deferred", index, entry)),
    ...brief.decisions.map((entry, index) => legacyDecisionRequirement(2, "decisions", index, entry)),
    ...brief.assetRequirements.additionalImagery.sourcingPolicy.map((entry, index) => typedEntry("imagery-policy", index, entry, "IMAGE_NOTE")),
    ...(brief.assetRequirements.additionalImagery.allowed ? [legacyRequirement(2, "imagery-allowed", 0, "Additional imagery is allowed.", "IMAGE_NOTE", ["legacy:v2:imagery:allowed"])] : []),
    ...(brief.assetRequirements.additionalImagery.realisticProfessional ? [legacyRequirement(2, "imagery-realistic", 0, "Use realistic professional imagery.", "IMAGE_NOTE", ["legacy:v2:imagery:realistic"])] : []),
    ...(brief.assetRequirements.additionalImagery.avoidArtificialLook ? [legacyRequirement(2, "imagery-natural", 0, "Avoid an artificial-looking image treatment.", "IMAGE_NOTE", ["legacy:v2:imagery:natural"])] : []),
  ];
  const firstLogoIndex = brief.assetRequirements.requiredAssets.findIndex((asset) => asset.role === "logo");
  const assets = brief.assetRequirements.requiredAssets.map((asset, index) => legacyAsset(2, "assets", index, asset, asset.role === "logo" && index === firstLogoIndex ? "ASSET_COMPANY_LOGO" : legacyAssetId(2, "assets", asset.reference, asset.role)));
  const databaseMode = overrideDecision(brief, "database-mode", DatabaseModeSchema, base.decisions.database.mode);
  const authMode = overrideDecision(brief, "auth-mode", AuthModeSchema, base.decisions.auth.mode);
  const analyticsMode = overrideDecision(brief, "analytics-mode", AnalyticsModeSchema, "UNRESOLVED");
  const routePolicy = overrideDecision(brief, "route-policy", RoutePolicySchema, base.decisions.routePolicy.mode);
  const imageSourceStrategy = base.scope.imageSourceStrategy;
  const canonical: CanonicalBriefV3 = {
    ...base,
    requirements,
    decisions: {
      ...base.decisions,
      form,
      database: { mode: databaseMode },
      auth: { mode: authMode },
      analytics: { mode: analyticsMode },
      routePolicy: { mode: routePolicy },
    },
    assets,
    brand: {
      ...base.brand,
      referenceStrategy: brief.brandVisualRequirements.brandReferenceUsage.length ? "USER_SUPPLIED" : base.brand.referenceStrategy,
    },
    scope: { ...base.scope, imageSourceStrategy },
    seo: {
      primaryKeywords: brief.seoMetadata.primaryKeywords,
      exactTitle: brief.seoMetadata.exactTitle ?? null,
      exactMetaDescription: brief.seoMetadata.exactMetaDescription ?? null,
      locationTargeting: brief.seoMetadata.locationTargeting.map((entry, index) => typedEntry("seo-location", index, entry, "SEO")),
      pageMetadata: brief.seoMetadata.pageMetadata.map((item) => ({ ...item, title: item.title ?? null, metaDescription: item.metaDescription ?? null })),
    },
    legal: {
      placeholderPolicy: brief.legalComplianceConstraints.placeholderPolicy,
      inventedFactsPolicy: brief.legalComplianceConstraints.inventedFactsForbidden ? "FORBIDDEN" : "UNRESOLVED",
    },
  };
  return normalizeCanonicalBrief(canonical);
}

export function migrateV2ToCanonicalBriefV3(input: unknown): CanonicalBriefV3 {
  try {
    const parsed = ProjectBriefV2Schema.parse(input);
    return migrateV2RecordToCanonicalBriefV3(parsed);
  } catch (error) {
    if (error instanceof BriefV3Error) throw error;
    throw new BriefV3Error("BRIEF_V3_MIGRATION_INVALID", { reason: "V2 Brief could not be migrated" });
  }
}
