import { emptyBriefV2Fields } from "../brief";
import { ProjectBriefV2Schema, RequirementSpecificationSchema, type ProjectBriefV2, type RequirementSpecification } from "../schema";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "./schema";

const entry = (id: string, statement: string) => ({ id, statement, sourceRefs: [`fixture:${id}`] });

export const representativeV1Brief: RequirementSpecification = RequirementSpecificationSchema.parse({
  schemaVersion: 1,
  documentType: "requirements",
  projectId: "22222222-2222-4222-8222-222222222222",
  projectVersion: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  projectSummary: "Synthetic atelier landing page.",
  protectedFunctionalityRequired: false,
  imagesRequired: true,
  businessGoals: ["Explain the synthetic service."],
  targetAudiences: ["Local synthetic visitors."],
  pages: [{ slug: "home", purpose: "Explain the synthetic service." }],
  userRoles: [],
  features: ["Service overview."],
  forms: ["Contact form."],
  contentRequirements: ["Use only supplied synthetic facts."],
  backendRequirements: [],
  supabaseRequirements: [],
  authenticationDecision: "no-authentication-guest-first",
  storageDecision: "not-needed",
  emailDecision: "not-needed",
  administrationDecision: "not-needed",
  seoRequirements: ["Synthetic local search phrase."],
  localization: { locales: ["en"], defaultLocale: "en" },
  imageSourceDecision: "user-supplied",
  suppliedBrandInformation: { status: "provided", value: "Synthetic blue-and-copper identity." },
  suppliedLogoLocation: { status: "provided", value: "Synthetic primary logo reference." },
  technicalConstraints: ["Single-page only.", "Never invent business facts."],
  explicitExclusions: [],
  userAcceptanceCriteria: ["Visitor can read the synthetic offer."],
  unresolvedItems: [],
  approval: { approved: false },
  contactFacts: [],
  legalFacts: [],
  brandFacts: ["Synthetic blue-and-copper identity."],
  logoMetadata: ["Synthetic primary logo reference."],
  imageSourcingNotes: [],
  evidence: [],
  recommendations: [],
  briefStatus: "draft",
  briefVersion: 1,
});

export const representativeV2Brief: ProjectBriefV2 = ProjectBriefV2Schema.parse({
  ...representativeV1Brief,
  ...emptyBriefV2Fields(),
  brandVisualRequirements: {
    ...emptyBriefV2Fields().brandVisualRequirements,
    colorDirection: [entry("color", "Synthetic navy with copper accents.")],
  },
  content: [entry("content", "Use concise synthetic service copy.")],
  technical: [entry("technical", "Keep the page static and bounded.")],
  assetRequirements: {
    ...emptyBriefV2Fields().assetRequirements,
    requiredAssets: [{ reference: "asset:synthetic-logo", role: "logo", usage: "Use the synthetic supplied logo.", replacementForbidden: true, sourceRefs: ["fixture:logo"] }],
  },
  formBehaviorRequirements: {
    ...emptyBriefV2Fields().formBehaviorRequirements,
    formPresent: true,
    validation: "ACTIVE",
    successUx: "SIMULATED",
    dataTransmission: "NONE",
    persistence: "NONE",
    thirdParty: "NONE",
    privacyCheckbox: "OPTIONAL",
    interactionStates: [entry("form-state", "Show local validation and synthetic simulated success.")],
  },
  uxResponsiveRequirements: {
    ...emptyBriefV2Fields().uxResponsiveRequirements,
    mobileFirst: true,
    responsiveBehavior: [entry("responsive", "Reflow the synthetic page on narrow screens.")],
  },
  seoMetadata: {
    ...emptyBriefV2Fields().seoMetadata,
    primaryKeywords: ["synthetic atelier"],
    exactTitle: "Synthetic Atelier",
    exactMetaDescription: "A synthetic atelier description.",
    locationTargeting: [entry("location", "Target the synthetic region.")],
    pageMetadata: [{ route: "/", title: "Synthetic Atelier", metaDescription: "A synthetic atelier description.", keywords: ["synthetic atelier"], sourceRefs: ["fixture:seo"] }],
  },
  legalComplianceConstraints: {
    constraints: [entry("legal", "Use marked synthetic placeholders.")],
    placeholderPolicy: "USE_EXPLICIT_PLACEHOLDERS",
    inventedFactsForbidden: true,
  },
  prohibitedRequirements: [entry("prohibited", "Do not invent synthetic business facts.")],
  deferredIntegrations: [{ integration: "email", status: "DEFERRED", rationale: "Synthetic form has no transmission.", sourceRefs: ["fixture:email"] }],
  decisions: [
    { key: "form-transmission", value: "NONE", status: "CONFIRMED", sourceRefs: ["fixture:form"] },
  ],
});

export const cleanBriefV3: CanonicalBriefV3 = CanonicalBriefV3Schema.parse({
  schemaVersion: 3,
  summary: "Synthetic atelier landing page.",
  title: "Synthetic Atelier",
  scope: { protectedFunctionality: false, imagesRequired: true, imageSourceStrategy: "USER_SUPPLIED" },
  pages: [{ id: "PAGE:home", slug: "home", purpose: "Explain the synthetic service.", sourceRefs: ["fixture:page"] }],
  requirements: [
    { id: "REQUIREMENT:legal", category: "LEGAL_CONSTRAINT", statement: "Use marked synthetic placeholders.", sourceRefs: ["fixture:legal"] },
    { id: "REQUIREMENT:service", category: "FEATURE", statement: "Show the synthetic service overview.", sourceRefs: ["fixture:service"] },
  ],
  decisions: {
    form: {
      mode: "SIMULATED",
      formPresent: true,
      validation: "ACTIVE",
      transmissionMode: "NONE",
      persistenceMode: "NONE",
      serverProcessingMode: "NONE",
      externalProviderMode: "NONE",
      privacyConsentMode: "OPTIONAL",
      interactionStates: [],
    },
    database: { mode: "NONE" },
    auth: { mode: "NONE" },
    analytics: { mode: "NONE" },
    routePolicy: { mode: "SINGLE_PAGE" },
  },
  assets: [{ id: "ASSET_COMPANY_LOGO", reference: "asset:synthetic-logo", role: "logo", usage: "Use the synthetic supplied logo.", replacementPolicy: "FORBIDDEN", sourceRefs: ["fixture:logo"] }],
  brand: { referenceStrategy: "USER_SUPPLIED", suppliedInformation: "Synthetic identity.", suppliedLogoDescription: "Synthetic logo." },
  seo: {
    primaryKeywords: ["synthetic atelier"],
    exactTitle: "Synthetic Atelier",
    exactMetaDescription: "A synthetic atelier description.",
    locationTargeting: [],
    pageMetadata: [],
  },
  legal: { placeholderPolicy: "USE_EXPLICIT_PLACEHOLDERS", inventedFactsPolicy: "FORBIDDEN" },
  localization: { locales: ["en"], defaultLocale: "en" },
  unresolved: [],
});

export const cleanFormRevisionChangeSet = {
  contractVersion: 1 as const,
  changes: [
    { operation: "SET" as const, target: "FORM_SUCCESS_MODE" as const, value: "SIMULATED" as const, sourceRefs: ["fixture:revision"] },
    { operation: "SET" as const, target: "FORM_TRANSMISSION_MODE" as const, value: "NONE" as const, sourceRefs: ["fixture:revision"] },
  ],
  unresolved: [],
};

export const multiDomainChangeSet = {
  contractVersion: 1 as const,
  changes: [
    { operation: "SET" as const, target: "SEO_TITLE" as const, value: "Synthetic Atelier — Revised" as const, sourceRefs: ["fixture:seo-revision"] },
    { operation: "SET" as const, target: "DATABASE_MODE" as const, value: "NONE" as const, sourceRefs: ["fixture:database-revision"] },
    { operation: "UPSERT" as const, target: "REQUIREMENT:service" as const, value: { category: "FEATURE" as const, statement: "Show the synthetic service overview and hours.", sourceRefs: ["fixture:service-revision"] }, sourceRefs: ["fixture:service-revision"] },
  ],
  unresolved: [],
};

export const expectedV1Migration = {
  summary: "Synthetic atelier landing page.",
  formMode: "UNRESOLVED",
  databaseMode: "NONE",
  authMode: "NONE",
  routePolicy: "SINGLE_PAGE",
  legalInventedFactsPolicy: "FORBIDDEN",
} as const;

export const expectedV2Migration = {
  formMode: "SIMULATED",
  formTransmissionMode: "NONE",
  seoTitle: "Synthetic Atelier",
  assetId: "ASSET_COMPANY_LOGO",
  legalPlaceholderPolicy: "USE_EXPLICIT_PLACEHOLDERS",
} as const;
