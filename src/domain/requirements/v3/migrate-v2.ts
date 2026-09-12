import { ProjectBriefV2Schema, RequirementSpecificationSchema, type ProjectBriefV2 } from "../schema";
import { BriefV3Error, BriefV3MigrationAmbiguityError } from "./errors";
import { validateCanonicalBriefV3 } from "./invariants";
import { legacyAsset, legacyAssetId, legacyDecisionRequirement, legacyDeferredRequirement, legacyEntryRequirement, legacyRequirement, legacySourceRef, isLegacySimulationProhibition } from "./legacy";
import { migrateV1RecordToCanonicalBriefV3 } from "./migrate-v1";
import { normalizeCanonicalBrief } from "./normalize";
import { type CanonicalBriefV3, type FormBehaviorState } from "./schema";
import { AnalyticsModeSchema, AuthModeSchema, DatabaseModeSchema, RoutePolicySchema } from "./schema";
import { canonicalizeLegacyBriefV3WithLineage, type CanonicalizedLegacyBriefV3 } from "./identity";

const typedEntry = (field: string, index: number, entry: { id: string; statement: string; sourceRefs: string[] }, category: Parameters<typeof legacyRequirement>[4]) => legacyEntryRequirement(2, field, index, { ...entry, id: `${field}:${entry.id}` }, category);

const V3_SEO_KEYWORD_MAX = 300;
const V3_SEO_TITLE_MAX = 300;
const V3_SEO_DESCRIPTION_MAX = 1000;
const V3_SEO_REQUIREMENT_MAX = 4000;

type SeoMigration = {
  primaryKeywords: string[];
  exactTitle: string | null;
  exactMetaDescription: string | null;
  locationTargeting: CanonicalBriefV3["seo"]["locationTargeting"];
  pageMetadata: CanonicalBriefV3["seo"]["pageMetadata"];
  requirements: CanonicalBriefV3["requirements"];
};

const splitSeoText = (value: string): string[] => value.split(/[;\r\n]+/u).map((part) => part.trim()).filter(Boolean);

function preserveSeoText(value: string, field: string, index: number, sourceRefs?: string[]): CanonicalBriefV3["requirements"] {
  const text = value.trim();
  if (!text) return [];
  const refs = sourceRefs?.length ? sourceRefs : [legacySourceRef(2, field, index, text)];
  const chunks: CanonicalBriefV3["requirements"] = [];
  for (let offset = 0; offset < text.length; offset += V3_SEO_REQUIREMENT_MAX) {
    const chunk = text.slice(offset, offset + V3_SEO_REQUIREMENT_MAX);
    chunks.push(legacyRequirement(2, field, index * 10000 + offset, chunk, "SEO", refs, `seo-preserved:${field}:${index}:${offset}`));
  }
  return chunks;
}

function normalizeV2Seo(brief: ProjectBriefV2): SeoMigration {
  const explicitTitle = brief.seoMetadata.exactTitle?.trim() || null;
  const explicitMetaDescription = brief.seoMetadata.exactMetaDescription?.trim() || null;
  let exactTitle: string | null = explicitTitle && explicitTitle.length <= V3_SEO_TITLE_MAX ? explicitTitle : null;
  let exactMetaDescription: string | null = explicitMetaDescription && explicitMetaDescription.length <= V3_SEO_DESCRIPTION_MAX ? explicitMetaDescription : null;
  const primaryKeywords: string[] = [];
  const requirements: CanonicalBriefV3["requirements"] = [];
  if (explicitTitle && explicitTitle.length > V3_SEO_TITLE_MAX) requirements.push(...preserveSeoText(explicitTitle, "seoMetadata.exactTitle", 0));
  if (explicitMetaDescription && explicitMetaDescription.length > V3_SEO_DESCRIPTION_MAX) requirements.push(...preserveSeoText(explicitMetaDescription, "seoMetadata.exactMetaDescription", 0));
  const setExact = (field: "exactTitle" | "exactMetaDescription", value: string, index: number) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const limit = field === "exactTitle" ? V3_SEO_TITLE_MAX : V3_SEO_DESCRIPTION_MAX;
    const explicit = field === "exactTitle" ? explicitTitle : explicitMetaDescription;
    if (explicit !== null) {
      if (explicit !== trimmed) requirements.push(...preserveSeoText(trimmed, `seoMetadata.primaryKeywords.${field}`, index));
      return;
    }
    if (trimmed.length > limit) {
      requirements.push(...preserveSeoText(trimmed, `seoMetadata.${field}`, index));
      return;
    }
    const previous = field === "exactTitle" ? exactTitle : exactMetaDescription;
    if (previous !== null && previous !== trimmed) throw new BriefV3MigrationAmbiguityError(`seoMetadata.${field}`, "multiple exact SEO values disagree");
    if (field === "exactTitle") exactTitle = trimmed; else exactMetaDescription = trimmed;
  };

  for (const [index, value] of brief.seoMetadata.primaryKeywords.entries()) {
    for (const part of splitSeoText(value)) {
      const title = /^(?:seo[- ]?title|exact[- ]?title|seo[- ]?titel(?:\s+exakt)?|titel(?:\s+exakt)?)\s*[:=]\s*(.*)$/iu.exec(part);
      const description = /^(?:meta[- ]?description(?:\s+(?:exact|exakt))?|exact[- ]?meta[- ]?description|meta[- ]?beschreibung(?:\s+exakt)?)\s*[:=]\s*(.*)$/iu.exec(part);
      const keyword = /^(?:primary[- ]?keywords?|keywords?|suchbegriffe)\s*[:=]\s*(.*)$/iu.exec(part);
      if (title?.[1] !== undefined) { setExact("exactTitle", title[1], index); continue; }
      if (description?.[1] !== undefined) { setExact("exactMetaDescription", description[1], index); continue; }
      const keywordValue = (keyword?.[1] ?? part).trim();
      if (keywordValue.length <= V3_SEO_KEYWORD_MAX) primaryKeywords.push(keywordValue);
      else requirements.push(...preserveSeoText(keywordValue, "seoMetadata.primaryKeywords", index));
    }
  }

  const pageMetadata: CanonicalBriefV3["seo"]["pageMetadata"] = [];
  for (const [index, item] of brief.seoMetadata.pageMetadata.entries()) {
    const route = item.route.trim();
    const validRoute = route.length <= 160;
    if (!validRoute) requirements.push(...preserveSeoText(item.route, `seoMetadata.pageMetadata.${index}.route`, index, item.sourceRefs));
    const title = item.title?.trim() ?? null;
    const metaDescription = item.metaDescription?.trim() ?? null;
    const keywords = item.keywords.filter((keyword) => keyword.trim().length <= V3_SEO_KEYWORD_MAX).map((keyword) => keyword.trim());
    item.keywords.forEach((keyword, keywordIndex) => {
      if (keyword.trim().length > V3_SEO_KEYWORD_MAX) requirements.push(...preserveSeoText(keyword, `seoMetadata.pageMetadata.${index}.keywords`, keywordIndex, item.sourceRefs));
    });
    if (title && title.length > V3_SEO_TITLE_MAX) requirements.push(...preserveSeoText(title, `seoMetadata.pageMetadata.${index}.title`, index, item.sourceRefs));
    if (metaDescription && metaDescription.length > V3_SEO_DESCRIPTION_MAX) requirements.push(...preserveSeoText(metaDescription, `seoMetadata.pageMetadata.${index}.metaDescription`, index, item.sourceRefs));
    if (validRoute) pageMetadata.push({ route, title: title && title.length <= V3_SEO_TITLE_MAX ? title : null, metaDescription: metaDescription && metaDescription.length <= V3_SEO_DESCRIPTION_MAX ? metaDescription : null, keywords, sourceRefs: item.sourceRefs });
  }

  return {
    primaryKeywords: [...new Set(primaryKeywords)],
    exactTitle,
    exactMetaDescription,
    locationTargeting: brief.seoMetadata.locationTargeting.map((entry, index) => typedEntry("seo-location", index, entry, "SEO")),
    pageMetadata,
    requirements,
  };
}

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
      simulatedSuccessPolicy: "NOT_APPLICABLE",
      transmissionMode: "NONE",
      persistenceMode: "NONE",
      serverProcessingMode: "NONE",
      externalProviderMode: "NONE",
      privacyConsentMode: "NOT_APPLICABLE",
      interactionStates: [],
    };
  }
  if (typed.validation !== "ACTIVE") throw new BriefV3MigrationAmbiguityError("formBehaviorRequirements", "formPresent=true conflicts with NOT_REQUIRED validation");
  if (typed.successUx === "NONE") throw new BriefV3MigrationAmbiguityError("formBehaviorRequirements", "formPresent=true has no success behavior");
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
  if (typed.successUx === "SIMULATED") return { ...shared, mode: "SIMULATED", simulatedSuccessPolicy: "ALLOWED" };
  if (typed.successUx === "REAL") return { ...shared, mode: "REAL", simulatedSuccessPolicy: "UNRESOLVED", transmissionMode: typed.dataTransmission as Exclude<typeof typed.dataTransmission, "NONE"> };
  return { ...shared, mode: "UNRESOLVED", simulatedSuccessPolicy: "UNRESOLVED" };
}

function overrideDecision<T extends string>(brief: ProjectBriefV2, key: string, schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, fallback: T): T {
  const items = brief.decisions.filter((decision) => decision.key.trim().toLowerCase() === key);
  if (!items.length) return fallback;
  const values = items.map((item) => schema.safeParse(item.value));
  if (values.some((value) => !value.success || value.data === undefined)) throw new BriefV3MigrationAmbiguityError(`decisions.${key}`, "a typed decision has an unsupported value");
  const unique = [...new Set(values.map((value) => value.data as T))];
  if (unique.length > 1) throw new BriefV3MigrationAmbiguityError(`decisions.${key}`, "multiple typed decisions disagree");
  return unique[0] ?? fallback;
}

function checkLegacyDecisionConflicts(brief: ProjectBriefV2, form: FormBehaviorState): void {
  if (brief.emailDecision === "needed" && form.transmissionMode === "NONE") throw new BriefV3MigrationAmbiguityError("emailDecision", "legacy needed conflicts with typed NONE transmission");
  if (brief.emailDecision === "not-needed" && form.transmissionMode === "EMAIL") throw new BriefV3MigrationAmbiguityError("emailDecision", "legacy not-needed conflicts with typed EMAIL transmission");
  if (brief.storageDecision === "needed" && form.persistenceMode === "NONE") throw new BriefV3MigrationAmbiguityError("storageDecision", "legacy needed conflicts with typed NONE persistence");
  if (brief.storageDecision === "not-needed" && brief.supabaseRequirements.length === 0 && form.persistenceMode !== "NONE" && form.persistenceMode !== "UNRESOLVED") throw new BriefV3MigrationAmbiguityError("storageDecision", "legacy not-needed conflicts with typed persistence");
  if (brief.formBehaviorRequirements.formPresent === false && brief.forms.length > 0) throw new BriefV3MigrationAmbiguityError("forms/formBehaviorRequirements", "legacy forms conflict with typed formPresent=false");
}

function checkTypedDecisionAgainstLegacy(brief: ProjectBriefV2, key: string, legacyValue: string, typedValue: string): void {
  if (!brief.decisions.some((decision) => decision.key.trim().toLowerCase() === key)) return;
  if (legacyValue !== "pending" && legacyValue !== typedValue) throw new BriefV3MigrationAmbiguityError(`decisions.${key}`, "legacy and typed decision representations disagree");
}

function rejectConflictingV2Collections(brief: ProjectBriefV2): void {
  const checkEntries = (field: string, entries: readonly { id: string; statement: string }[]) => {
    const byId = new Map<string, string>();
    for (const entry of entries) {
      const previous = byId.get(entry.id);
      if (previous !== undefined && previous !== entry.statement) throw new BriefV3MigrationAmbiguityError(field, "duplicate legacy entry ID has conflicting statements");
      byId.set(entry.id, entry.statement);
    }
  };
  checkEntries("content", brief.content);
  checkEntries("technical", brief.technical);
  checkEntries("formBehaviorRequirements.interactionStates", brief.formBehaviorRequirements.interactionStates);
  checkEntries("seoMetadata.locationTargeting", brief.seoMetadata.locationTargeting);
  checkEntries("prohibitedRequirements", brief.prohibitedRequirements);
  checkEntries("legalComplianceConstraints.constraints", brief.legalComplianceConstraints.constraints);
  checkEntries("brandVisualRequirements.colorDirection", brief.brandVisualRequirements.colorDirection);
  checkEntries("brandVisualRequirements.typographyDirection", brief.brandVisualRequirements.typographyDirection);
  checkEntries("brandVisualRequirements.spacingLayoutDirection", brief.brandVisualRequirements.spacingLayoutDirection);
  checkEntries("brandVisualRequirements.cardSurfaceStyling", brief.brandVisualRequirements.cardSurfaceStyling);
  checkEntries("brandVisualRequirements.iconDirection", brief.brandVisualRequirements.iconDirection);
  checkEntries("brandVisualRequirements.imageryDirection", brief.brandVisualRequirements.imageryDirection);
  checkEntries("brandVisualRequirements.brandReferenceUsage", brief.brandVisualRequirements.brandReferenceUsage);
  checkEntries("brandVisualRequirements.visualAntiPatterns", brief.brandVisualRequirements.visualAntiPatterns);
  checkEntries("uxResponsiveRequirements.responsiveBehavior", brief.uxResponsiveRequirements.responsiveBehavior);
  checkEntries("uxResponsiveRequirements.interactionRequirements", brief.uxResponsiveRequirements.interactionRequirements);
  const decisions = new Map<string, string>();
  for (const decision of brief.decisions) {
    const key = decision.key.trim().toLowerCase();
    const previous = decisions.get(key);
    if (previous !== undefined && previous !== decision.value) throw new BriefV3MigrationAmbiguityError(`decisions.${key}`, "duplicate legacy decision keys disagree");
    decisions.set(key, decision.value);
  }
  const assets = new Map<string, string>();
  for (const asset of brief.assetRequirements.requiredAssets) {
    const key = `${asset.reference}\u0000${asset.role}`;
    const fingerprint = `${asset.usage}\u0000${asset.replacementForbidden}`;
    const previous = assets.get(key);
    if (previous !== undefined && previous !== fingerprint) throw new BriefV3MigrationAmbiguityError("assetRequirements.requiredAssets", "duplicate legacy asset identity has conflicting values");
    assets.set(key, fingerprint);
  }
  const routes = new Set<string>();
  for (const metadata of brief.seoMetadata.pageMetadata) {
    if (routes.has(metadata.route)) throw new BriefV3MigrationAmbiguityError("seoMetadata.pageMetadata", "duplicate legacy SEO route");
    routes.add(metadata.route);
  }
}

function finalizeV2Migration(canonical: CanonicalBriefV3, scope: { projectId: string; projectVersion: number }): CanonicalizedLegacyBriefV3 {
  try {
    return canonicalizeLegacyBriefV3WithLineage(validateCanonicalBriefV3(normalizeCanonicalBrief(canonical)), scope);
  } catch (error) {
    if (error instanceof BriefV3MigrationAmbiguityError) throw error;
    if (error instanceof BriefV3Error) throw new BriefV3MigrationAmbiguityError("canonical-state", error.details?.issue ?? error.details?.invariant ?? error.code);
    throw error;
  }
}

export function migrateV2RecordToCanonicalBriefV3WithLineage(brief: ProjectBriefV2): CanonicalizedLegacyBriefV3 {
  rejectConflictingV2Collections(brief);
  const baseInput = { ...brief, prohibitedRequirements: undefined };
  const base = migrateV1RecordToCanonicalBriefV3(RequirementSpecificationSchema.parse(baseInput));
  const form = formFromV2(brief);
  const seo = normalizeV2Seo(brief);
  checkLegacyDecisionConflicts(brief, form);
  const requirements = [
    ...base.requirements,
    ...seo.requirements,
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
  if ((routePolicy === "MULTI_PAGE" && base.pages.length < 2) || (routePolicy === "SINGLE_PAGE" && base.pages.length > 1)) throw new BriefV3MigrationAmbiguityError("decisions.route-policy/pages", "typed route policy conflicts with the legacy page collection");
  checkTypedDecisionAgainstLegacy(brief, "database-mode", base.decisions.database.mode, databaseMode);
  checkTypedDecisionAgainstLegacy(brief, "auth-mode", base.decisions.auth.mode, authMode);
  checkTypedDecisionAgainstLegacy(brief, "route-policy", base.decisions.routePolicy.mode, routePolicy);
  const images = base.scope.images;
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
    scope: { ...base.scope, images },
    seo: {
      primaryKeywords: seo.primaryKeywords,
      exactTitle: seo.exactTitle,
      exactMetaDescription: seo.exactMetaDescription,
      locationTargeting: seo.locationTargeting,
      pageMetadata: seo.pageMetadata,
    },
    legal: {
      placeholderPolicy: brief.legalComplianceConstraints.placeholderPolicy,
      inventedFactsPolicy: brief.legalComplianceConstraints.inventedFactsForbidden ? "FORBIDDEN" : "UNRESOLVED",
    },
  };
  return finalizeV2Migration(canonical, { projectId: brief.projectId, projectVersion: brief.projectVersion });
}

export function migrateV2RecordToCanonicalBriefV3(brief: ProjectBriefV2): CanonicalBriefV3 {
  return migrateV2RecordToCanonicalBriefV3WithLineage(brief).brief;
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
