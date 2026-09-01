import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { PlanningPackage } from "@/agents/planner/contracts";
import type { CanonicalBriefV3, CanonicalRequirement } from "@/domain/requirements/v3/schema";
import { DesignCanonicalContentSchema, canonicalRequirementRef, type DesignCanonicalContent } from "@/domain/design/canonical-content";

const serviceCategories = new Set<CanonicalRequirement["category"]>(["FEATURE", "CONTENT"]);
const legalCategories = new Set<CanonicalRequirement["category"]>(["LEGAL_FACT", "LEGAL_CONSTRAINT"]);
const exclusionCategories = new Set<CanonicalRequirement["category"]>(["EXCLUSION", "PROHIBITED"]);

const mapRequirementGroups = (requirements: readonly CanonicalRequirement[]) => {
  const services = requirements.filter((item) => serviceCategories.has(item.category)).map(canonicalRequirementRef);
  const businessGoals = requirements.filter((item) => item.category === "BUSINESS_GOAL").map(canonicalRequirementRef);
  const contactFacts = requirements.filter((item) => item.category === "CONTACT_FACT").map(canonicalRequirementRef);
  const legalRequirements = requirements.filter((item) => legalCategories.has(item.category)).map(canonicalRequirementRef);
  const exclusions = requirements.filter((item) => exclusionCategories.has(item.category)).map(canonicalRequirementRef);
  const specialIds = new Set([...services, ...businessGoals, ...contactFacts, ...legalRequirements, ...exclusions].map((item) => item.id));
  const otherRequirements = requirements.filter((item) => !specialIds.has(item.id)).map(canonicalRequirementRef);
  return { services, businessGoals, contactFacts, legalRequirements, exclusions, otherRequirements };
};

export function buildDesignCanonicalContent(input: {
  brief: CanonicalBriefV3;
  briefChecksum: string;
  planning: PlanningPackage;
  planningChecksum: string;
  architectureChecksum: string;
}): DesignCanonicalContent {
  const groups = mapRequirementGroups(input.brief.requirements);
  const routes = input.planning.sitemap.routes.map((route) => ({
    id: route.id,
    path: route.path,
    pageType: route.pageType,
    titlePurpose: route.titlePurpose,
    formDependencies: route.formDependencies,
    navigationVisible: route.navigationVisible,
  }));
  const pageResponsibilities = input.planning.pages.pages.map((page) => ({
    id: page.id,
    routeId: page.routeId,
    purpose: page.purpose,
    contentBlocks: page.contentBlocks,
    functionalComponents: page.functionalComponents,
    forms: page.forms,
  }));
  const forms = input.planning.forms.forms.map((form) => ({
    id: form.id,
    route: form.route,
    purpose: form.purpose,
    fields: form.fields.map((field) => ({ id: "fieldId" in field ? field.fieldId : field.name, label: "label" in field ? field.label : field.name, type: field.type, required: field.required, validation: "validation" in field ? field.validation : [] })),
    businessValidation: form.businessValidation,
    consentRequirements: form.consentRequirements,
    submissionMechanism: form.submissionMechanism,
    databaseWrite: form.databaseWrite,
    emailBehavior: form.emailBehavior,
    successState: form.successState,
    errorState: form.errorState,
    rateLimitRequired: form.rateLimitRequired,
    spamProtectionRequired: form.spamProtectionRequired,
  }));
  const legalPageRouteIds = routes.filter((route) => route.pageType === "legal" || /(?:impressum|datenschutz|privacy|legal)/iu.test(route.path)).map((route) => route.id);
  const architecture = input.planning.architecture;
  const base = {
    schemaVersion: 1 as const,
    briefChecksum: input.briefChecksum,
    planningChecksum: input.planningChecksum,
    architectureChecksum: input.architectureChecksum,
    businessIdentity: {
      title: input.brief.title,
      summary: input.brief.summary,
      locales: input.brief.localization.locales,
      defaultLocale: input.brief.localization.defaultLocale,
      suppliedInformation: input.brief.brand.suppliedInformation,
      suppliedLogoDescription: input.brief.brand.suppliedLogoDescription,
    },
    ...groups,
    productScope: {
      purpose: input.planning.productScope.purpose,
      primaryOutcomes: input.planning.productScope.primaryOutcomes,
      outOfScopeCapabilities: input.planning.productScope.outOfScopeCapabilities,
      userRoles: input.planning.productScope.userRoles,
      majorWorkflows: input.planning.productScope.majorWorkflows,
      constraints: input.planning.productScope.constraints,
    },
    navigation: {
      primary: input.planning.navigation.primary,
      secondary: input.planning.navigation.secondary,
      footer: input.planning.navigation.footer,
      contextual: input.planning.navigation.contextual,
      protected: input.planning.navigation.protected,
      mobileBehavior: input.planning.navigation.mobileBehavior,
      ctaPlacementIntent: input.planning.navigation.ctaPlacementIntent,
      routeReferences: input.planning.navigation.routeReferences,
    },
    userFlows: input.planning.userFlows.flows.map((flow) => ({
      id: flow.id,
      actor: flow.actor,
      trigger: flow.trigger,
      startRoute: flow.startRoute,
      successOutcome: flow.successOutcome,
      failureOutcomes: flow.failureOutcomes,
      formRequirements: flow.formRequirements,
    })),
    contentPlan: {
      approvedGeneratedCopy: input.planning.content.approvedGeneratedCopy,
      missingFactualContent: input.planning.content.missingFactualContent,
      legalContentRequiringConfirmation: input.planning.content.legalContentRequiringConfirmation,
      approvedPlaceholders: input.planning.content.approvedPlaceholders,
      suppliedContentNotes: input.planning.content.suppliedContentNotes,
    },
    routes,
    pageResponsibilities,
    legalPageRouteIds,
    legalPolicy: {
      placeholderPolicy: input.brief.legal.placeholderPolicy,
      inventedFactsPolicy: input.brief.legal.inventedFactsPolicy,
    },
    formPolicy: input.brief.decisions.form,
    forms,
    imageSourceStrategy: input.brief.scope.images.sourceStrategy,
    assets: input.brief.assets.map((asset) => ({ reference: asset.reference, role: asset.role, usage: asset.usage, replacementPolicy: asset.replacementPolicy })),
    plannedAssets: input.planning.assets.entries.map((asset) => ({
      id: asset.id,
      purpose: asset.purpose,
      targetPage: asset.targetPage,
      sourceDecision: asset.sourceDecision,
      subject: asset.subject,
      styleDirection: asset.styleDirection,
      aspectRatio: asset.aspectRatio,
      targetDimensions: asset.targetDimensions,
      format: asset.format,
      ...(asset.consistencyGroup ? { consistencyGroup: asset.consistencyGroup } : {}),
      altText: asset.altText,
      generationStatus: asset.generationStatus,
      userApprovalRequired: asset.userApprovalRequired,
      isLogo: asset.isLogo,
    })),
    architecture: {
      applicationProfile: architecture.applicationProfile,
      packageManager: architecture.packageManager,
      routes: architecture.routes,
      componentBoundaries: architecture.componentBoundaries,
      componentDecisions: architecture.componentDecisions,
      serverActions: architecture.serverActions,
      routeHandlers: architecture.routeHandlers,
      backendPriority: architecture.backendPriority,
      supabaseDatabaseRequirements: architecture.supabaseDatabaseRequirements,
      schemaPlan: architecture.schemaPlan,
      rlsRequirements: architecture.rlsRequirements,
      authenticationPlan: architecture.authenticationPlan,
      storagePlan: architecture.storagePlan,
      emailPlan: architecture.emailPlan,
      environmentVariables: architecture.environmentVariables,
      dependencies: architecture.dependencies,
      npmScripts: architecture.npmScripts,
      testStrategy: architecture.testStrategy,
      securityControls: architecture.securityControls,
      rejectedInfrastructure: architecture.rejectedInfrastructure,
    },
    unresolved: input.brief.unresolved,
  };
  return DesignCanonicalContentSchema.parse({ ...base, contentChecksum: checksumPersistedDocument(base) });
}

export function canonicalContentWithoutChecksum(content: DesignCanonicalContent) {
  const base = { ...content } as Record<string, unknown>;
  delete base.contentChecksum;
  return base;
}
