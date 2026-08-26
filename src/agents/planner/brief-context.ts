import { createHash } from "node:crypto";
import {
  RequirementSpecificationSchema,
  type RequirementSpecification,
} from "@/domain/requirements/schema";
import type { BriefV3Approval } from "@/persistence/database/brief-revision-v3-contracts";
import type { CanonicalBriefV3, CanonicalRequirement, RequirementCategory } from "@/domain/requirements/v3/schema";
import { canonicalUnresolvedBlocksStage } from "@/domain/requirements/v3/unresolved";

/**
 * The Planner still has a V1-shaped internal contract. This adapter is the
 * only supported way for a current V3 Brief to cross that boundary. The
 * complete canonical Brief is carried separately on PlannerAgentInput; this
 * normalized value exists only so older Planner helpers can consume a typed
 * view without making the persisted legacy document authoritative.
 */
export const canonicalBriefToPlannerBrief = (
  canonical: CanonicalBriefV3,
  compatibility: RequirementSpecification,
  approval?: BriefV3Approval,
): RequirementSpecification => {
  const requirements = canonical.requirements;
  const byCategory = (category: RequirementCategory) =>
    requirements.filter((entry) => entry.category === category);
  const statements = (category: RequirementCategory) =>
    byCategory(category).map((entry) => entry.statement);
  const entries = (values: CanonicalRequirement[]) =>
    values.map((entry) => ({
      id: entry.id,
      statement: entry.statement,
      sourceRefs: [...entry.sourceRefs],
    }));
  const allVisual = byCategory("BRAND_VISUAL");
  const responsive = byCategory("UX_RESPONSIVE");
  const legalConstraints = byCategory("LEGAL_CONSTRAINT");
  const excluded = [...byCategory("EXCLUSION"), ...byCategory("PROHIBITED")];
  const logoAssets = canonical.assets.filter((asset) => asset.role === "logo");
  const suppliedBrand = canonical.brand.suppliedInformation;
  const suppliedLogo = canonical.brand.suppliedLogoDescription ?? logoAssets[0]?.reference ?? null;
  const approvalEnvelope = approval
    ? {
        approved: true as const,
        approvedAt: approval.approvedAt,
        approvedBy: approval.approvedBy,
        approvedRequirementsChecksum: approval.approvedCanonicalChecksum,
      }
    : compatibility.approval;

  const modeToAuthentication = (mode: CanonicalBriefV3["decisions"]["auth"]["mode"]): RequirementSpecification["authenticationDecision"] =>
    mode === "NONE" ? "no-authentication-guest-first" : mode === "REQUIRED" ? "authentication-required" : "pending";
  const imageSource = (): RequirementSpecification["imageSourceDecision"] => {
    if (!canonical.scope.images.required) return "placeholders";
    switch (canonical.scope.images.sourceStrategy) {
      case "AI_GENERATED": return "ai-generated";
      case "USER_SUPPLIED": return "user-supplied";
      case "USER_AND_AI": return "ai-plus-user-supplied";
      case "PLACEHOLDERS": return "placeholders";
      case "CUSTOM": return "custom";
      default: return "pending";
    }
  };
  const stableUnresolvedId = (target: string, reason: string) => {
    const hex = createHash("sha256").update(`${target}\n${reason}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  const unresolvedItems = canonical.unresolved.map((item) => ({
    id: stableUnresolvedId(item.target, item.reason),
    description: item.reason,
    blocking: canonicalUnresolvedBlocksStage(canonical, item, "PLANNING"),
  }));
  const unmappedPlanningRequirements = requirements.filter((entry) =>
    ["OTHER", "FORM_INTERACTION", "DECISION", "DEFERRED_INTEGRATION", "ADMINISTRATION"].includes(entry.category),
  );
  const form = canonical.decisions.form;
  const formStatements = statements("FORM").length > 0
    ? statements("FORM")
    : form.formPresent
      ? ["Approved form interaction (behavior is defined by the canonical form decision)."]
      : [];
  const formBehaviorRequirements = {
    formPresent: form.formPresent,
    validation: form.validation,
    successUx: form.mode === "SIMULATED" ? "SIMULATED" as const : form.mode === "REAL" ? "REAL" as const : form.mode === "NONE" ? "NONE" as const : "NONE" as const,
    dataTransmission: form.transmissionMode === "EMAIL" ? "EMAIL" as const : form.transmissionMode === "API" ? "API" as const : form.transmissionMode === "NONE" ? "NONE" as const : "OTHER" as const,
    persistence: form.persistenceMode === "DATABASE" ? "DATABASE" as const : form.persistenceMode === "NONE" ? "NONE" as const : "OTHER" as const,
    thirdParty: form.externalProviderMode === "APPROVED_PROVIDER" ? "APPROVED_PROVIDER" as const : form.externalProviderMode === "NONE" ? "NONE" as const : "OTHER" as const,
    privacyCheckbox: form.privacyConsentMode === "REQUIRED" ? "REQUIRED" as const : form.privacyConsentMode === "NOT_APPLICABLE" ? "NOT_APPLICABLE" as const : "OPTIONAL" as const,
    interactionStates: entries(form.interactionStates),
  };
  const databaseMode = canonical.decisions.database.mode;
  const administration = statements("ADMINISTRATION").some((value) => /not[- ]needed|none|nicht erforderlich/i.test(value))
    ? "not-needed" as const
    : statements("ADMINISTRATION").length || databaseMode !== "NONE" ? "needed" as const : "not-needed" as const;
  const visualEntries = entries(allVisual);
  const responsiveEntries = entries(responsive);
  const seoRequirements = [
    ...canonical.seo.primaryKeywords.map((keyword) => `Keyword: ${keyword}`),
    ...(canonical.seo.exactTitle ? [`Exact title: ${canonical.seo.exactTitle}`] : []),
    ...(canonical.seo.exactMetaDescription ? [`Exact meta description: ${canonical.seo.exactMetaDescription}`] : []),
    ...canonical.seo.locationTargeting.map((entry) => entry.statement),
    ...canonical.seo.pageMetadata.flatMap((page) => [
      ...(page.title ? [`${page.route} title: ${page.title}`] : []),
      ...(page.metaDescription ? [`${page.route} meta description: ${page.metaDescription}`] : []),
      ...page.keywords.map((keyword) => `${page.route} keyword: ${keyword}`),
    ]),
    ...statements("SEO"),
  ];
  const technicalConstraints = [
    ...statements("TECHNICAL"),
    ...responsive.map((entry) => entry.statement),
    ...legalConstraints.map((entry) => entry.statement),
  ];
  const contentRequirements = [
    ...statements("CONTENT"),
    ...unmappedPlanningRequirements.map((entry) => entry.statement),
  ];
  const next = {
    ...compatibility,
    projectSummary: canonical.summary,
    projectTitle: canonical.title ?? undefined,
    protectedFunctionalityRequired: canonical.scope.protectedFunctionality,
    imagesRequired: canonical.scope.images.required,
    businessGoals: statements("BUSINESS_GOAL"),
    targetAudiences: statements("AUDIENCE"),
    pages: canonical.pages.map((page) => ({ slug: page.slug, purpose: page.purpose })),
    userRoles: statements("USER_ROLE"),
    features: statements("FEATURE"),
    forms: formStatements,
    contentRequirements,
    backendRequirements: statements("BACKEND"),
    supabaseRequirements: statements("DATABASE"),
    authenticationDecision: modeToAuthentication(canonical.decisions.auth.mode),
    storageDecision: databaseMode === "NONE" ? "not-needed" as const : databaseMode === "UNRESOLVED" ? "pending" as const : "needed" as const,
    emailDecision: form.transmissionMode === "EMAIL" ? "needed" as const : "not-needed" as const,
    administrationDecision: administration,
    seoRequirements,
    localization: canonical.localization,
    imageSourceDecision: imageSource(),
    suppliedBrandInformation: suppliedBrand ? { status: "provided" as const, value: suppliedBrand } : { status: "missing" as const },
    suppliedLogoLocation: suppliedLogo ? { status: "provided" as const, value: suppliedLogo } : { status: "missing" as const },
    technicalConstraints,
    explicitExclusions: excluded.map((entry) => entry.statement),
    userAcceptanceCriteria: statements("ACCEPTANCE"),
    unresolvedItems,
    contactFacts: statements("CONTACT_FACT"),
    legalFacts: statements("LEGAL_FACT"),
    brandFacts: [...statements("BRAND_FACT"), ...(suppliedBrand ? [suppliedBrand] : [])],
    logoMetadata: [...statements("LOGO_METADATA"), ...logoAssets.map((asset) => `${asset.reference}: ${asset.usage}`)],
    imageSourcingNotes: statements("IMAGE_NOTE"),
    recommendations: statements("RECOMMENDATION"),
    evidence: canonical.evidence.map((item) => ({ field: item.field, source: item.source, excerpt: item.excerpt })),
    approval: approvalEnvelope,
    briefStatus: approval?.approved ? "approved" as const : compatibility.briefStatus,
    ...(approval?.approvalNote ? { briefApprovalNote: approval.approvalNote } : {}),
    briefSchemaVersion: 2 as const,
    content: entries(byCategory("CONTENT")),
    technical: entries(byCategory("TECHNICAL")),
    brandVisualRequirements: {
      colorDirection: [],
      typographyDirection: [],
      spacingLayoutDirection: visualEntries,
      cardSurfaceStyling: [],
      iconDirection: [],
      imageryDirection: [],
      brandReferenceUsage: [...visualEntries, ...entries(byCategory("BRAND_FACT")), ...entries(byCategory("LOGO_METADATA"))],
      visualAntiPatterns: entries(excluded),
    },
    assetRequirements: {
      requiredAssets: canonical.assets.map((asset) => ({
        reference: asset.reference,
        role: asset.role,
        usage: asset.usage,
        replacementForbidden: asset.replacementPolicy === "FORBIDDEN",
        sourceRefs: [...asset.sourceRefs],
      })),
      additionalImagery: {
        allowed: canonical.scope.images.required,
        sourcingPolicy: entries(byCategory("IMAGE_NOTE")),
        realisticProfessional: canonical.scope.images.sourceStrategy !== "PLACEHOLDERS",
        avoidArtificialLook: statements("IMAGE_NOTE").some((value) => /artificial|künstlich|cartoon|3d/i.test(value)),
      },
    },
    formBehaviorRequirements,
    uxResponsiveRequirements: {
      mobileFirst: responsive.some((entry) => /mobile[- ]first/i.test(entry.statement)),
      responsiveBehavior: responsiveEntries,
      stickyMobileCta: responsive.some((entry) => /sticky.*cta|cta.*sticky/i.test(entry.statement)),
      smoothScroll: responsive.some((entry) => /smooth|sanft.*scroll/i.test(entry.statement)),
      reducedMotion: responsive.some((entry) => /reduced motion|wenig.*beweg|keine.*unnöt/i.test(entry.statement)),
      interactionRequirements: entries(byCategory("FORM_INTERACTION")),
    },
    seoMetadata: {
      primaryKeywords: [...canonical.seo.primaryKeywords],
      ...(canonical.seo.exactTitle ? { exactTitle: canonical.seo.exactTitle } : {}),
      ...(canonical.seo.exactMetaDescription ? { exactMetaDescription: canonical.seo.exactMetaDescription } : {}),
      locationTargeting: entries(canonical.seo.locationTargeting),
      pageMetadata: canonical.seo.pageMetadata.map((page) => ({ ...page, title: page.title ?? undefined, metaDescription: page.metaDescription ?? undefined })),
    },
    legalComplianceConstraints: {
      constraints: entries(legalConstraints),
      placeholderPolicy: canonical.legal.placeholderPolicy,
      inventedFactsForbidden: canonical.legal.inventedFactsPolicy === "FORBIDDEN",
    },
    prohibitedRequirements: entries(excluded),
    deferredIntegrations: byCategory("DEFERRED_INTEGRATION").map((entry) => ({ integration: entry.id, status: "DEFERRED" as const, rationale: entry.statement, sourceRefs: [...entry.sourceRefs] })),
    decisions: [
      { key: "database", value: canonical.decisions.database.mode, status: "CONFIRMED" as const, sourceRefs: ["canonical-v3:decisions.database"] },
      { key: "auth", value: canonical.decisions.auth.mode, status: "CONFIRMED" as const, sourceRefs: ["canonical-v3:decisions.auth"] },
      { key: "analytics", value: canonical.decisions.analytics.mode, status: "CONFIRMED" as const, sourceRefs: ["canonical-v3:decisions.analytics"] },
      { key: "route-policy", value: canonical.decisions.routePolicy.mode, status: "CONFIRMED" as const, sourceRefs: ["canonical-v3:decisions.routePolicy"] },
    ],
  };
  return RequirementSpecificationSchema.parse(next);
};

export const effectivePlannerBrief = (input: {
  approvedBrief: unknown;
  canonicalBrief?: CanonicalBriefV3;
  canonicalApproval?: BriefV3Approval;
}) => {
  const compatibility = RequirementSpecificationSchema.parse(input.approvedBrief);
  return input.canonicalBrief
    ? canonicalBriefToPlannerBrief(input.canonicalBrief, compatibility, input.canonicalApproval)
    : compatibility;
};
