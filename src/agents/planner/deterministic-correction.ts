import { createHash } from "node:crypto";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import type { RequirementSpecification } from "@/domain/requirements/schema";
import { PlanningPackageSchema, type PlanningPackage, type Traceability } from "./contracts";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { isNoBackendBrief, selectApplicationProfile } from "./deterministic";
import { normalizePlanningPackageForHost } from "./refresh-admission";
import type { ContractAuditRecord } from "@/domain/review/schema";

const correctionId = (key: string) => {
  const bytes = Buffer.from(createHash("sha256").update(key).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return `${bytes.toString("hex").slice(0, 8)}-${bytes.toString("hex").slice(8, 12)}-${bytes.toString("hex").slice(12, 16)}-${bytes.toString("hex").slice(16, 20)}-${bytes.toString("hex").slice(20)}`;
};

const trace = (operationKey: string, refs: string[], rationale: string): Traceability => ({
  decisionId: correctionId(`${operationKey}:${refs.join(",")}`),
  category: "deterministic-planning-correction",
  requirementReferences: refs,
  systemConstraintReferences: ["host-owned-planning-assembly"],
  rationale,
  confidence: "high",
  userConfirmationRequired: false,
});

const activeHandoffText = (planning: PlanningPackage) => JSON.stringify({
  routes: planning.sitemap.routes.map((route) => ({ path: route.path, primaryCta: route.primaryCta })),
  navigation: planning.navigation.ctaPlacementIntent,
  pages: planning.pages.pages.map((page) => ({ routeId: page.routeId, functionalComponents: page.functionalComponents, acceptanceCriteria: page.acceptanceCriteria })),
  flows: planning.userFlows.flows,
});

export type DeterministicPlanningCorrection = {
  package: PlanningPackage;
  correctionKinds: string[];
};

/**
 * Corrects only host-assembly defects already proven against the current
 * canonical Brief. It never edits product scope, exclusions, legal routes or
 * the Brief itself, and it does not turn an unconfirmed channel into an
 * active handoff.
 */
export function correctUnapprovedPlanningPackage(input: {
  current: PlanningPackage;
  brief: RequirementSpecification;
  canonicalBrief: CanonicalBriefV3;
  operationKey: string;
  timestamp: string;
}): DeterministicPlanningCorrection {
  const { current, brief, canonicalBrief, operationKey, timestamp } = input;
  const conversion = canonicalBrief.customerUxDirection?.conversionPolicy;
  const allowedDirectChannels = conversion?.allowedChannels.filter((channel) =>
    (channel === "DIRECT_PHONE" && canonicalBrief.contact?.publicPhone?.publicationAuthorized === true)
    || (channel === "DIRECT_EMAIL" && canonicalBrief.contact?.publicEmail?.publicationAuthorized === true),
  ) ?? [];
  if (!conversion || allowedDirectChannels.length === 0 || conversion.dataCollectionForm !== "FORBIDDEN" || !conversion.forbiddenChannels.includes("CONTACT_FORM")) {
    throw new Error("PLANNING_CORRECTION_CANONICAL_CONVERSION_POLICY_UNSAFE");
  }
  if (current.forms.forms.length > 0 || /whatsapp\s*:/iu.test(activeHandoffText(current))) {
    throw new Error("PLANNING_CORRECTION_ACTIVE_HANDOFF_REQUIRES_REVIEW");
  }

  const expectedProfile = selectApplicationProfile(brief, canonicalBrief);
  const canonicalNoBackend = canonicalBrief.decisions.database.mode === "NONE"
    && canonicalBrief.decisions.auth.mode === "NONE"
    && canonicalBrief.decisions.form.mode === "NONE"
    && !canonicalBrief.scope.protectedFunctionality;
  const noBackend = canonicalNoBackend || isNoBackendBrief(brief);
  const correctionKinds: string[] = [];
  const mainRoute = current.sitemap.routes.find((route) => route.path === "/");
  const mainPage = mainRoute ? current.pages.pages.find((page) => page.routeId === mainRoute.id) : undefined;
  if (!mainRoute || !mainPage) throw new Error("PLANNING_CORRECTION_MAIN_ROUTE_MISSING");

  const directCta = conversion.primaryCtaIntent;
  const nextProfile = current.profile.selectedProfile === expectedProfile.selectedProfile && current.architecture.applicationProfile === expectedProfile.selectedProfile
    ? current.profile
    : expectedProfile;
  if (nextProfile !== current.profile || current.architecture.applicationProfile !== expectedProfile.selectedProfile) correctionKinds.push("PUBLIC_SITE_PROFILE");

  const nextBlockers = noBackend && current.dataModel.entities.length === 0 && current.authentication.decision === "none" && !current.authentication.required
    ? current.blockers.filter((blocker) => blocker !== "DATA_MODEL_INCOMPLETE")
    : current.blockers;
  if (nextBlockers.length !== current.blockers.length) correctionKinds.push("REMOVE_FALSE_DATA_MODEL_BLOCKER");

  const nextRoute = mainRoute.primaryCta === directCta ? mainRoute : { ...mainRoute, primaryCta: directCta };
  if (nextRoute.primaryCta !== mainRoute.primaryCta) correctionKinds.push("DIRECT_CONTACT_CTA");
  const nextPage = {
    ...mainPage,
    functionalComponents: [...new Set([...mainPage.functionalComponents, "Direct telephone action", "Direct email action"])],
    acceptanceCriteria: [...new Set([...mainPage.acceptanceCriteria, "Confirmed direct phone and email actions are available without a form."])],
  };
  if (nextPage.functionalComponents.length !== mainPage.functionalComponents.length || nextPage.acceptanceCriteria.length !== mainPage.acceptanceCriteria.length) correctionKinds.push("DIRECT_CONTACT_PAGE_HANDOFF");

  const nextNavigation = {
    ...current.navigation,
    ctaPlacementIntent: current.navigation.ctaPlacementIntent.map((entry) => entry.startsWith(`${mainRoute.id}:`) ? `${mainRoute.id}: ${directCta}` : entry),
  };
  if (nextNavigation.ctaPlacementIntent.some((entry, index) => entry !== current.navigation.ctaPlacementIntent[index])) correctionKinds.push("DIRECT_CONTACT_NAVIGATION");

  const existingDirectFlow = current.userFlows.flows.some((flow) => flow.id === "flow-direct-contact");
  const directFlow = {
    id: "flow-direct-contact",
    actor: brief.targetAudiences[0] ?? "Visitor",
    trigger: directCta,
    startRoute: "/",
    steps: [
      { order: 1, description: "Choose the confirmed direct phone or email action.", routeId: mainRoute.id },
      { order: 2, description: "Open the visitor's phone or email client for a direct conversation." },
    ],
    dataCreated: [],
    dataRead: [],
    dataUpdated: [],
    successOutcome: "The visitor's phone or email client opens for a direct conversation.",
    failureOutcomes: ["The visitor can use the alternative confirmed direct phone or email action."],
    authorizationRequirements: [],
    formRequirements: [],
    emailRequirements: [],
    storageRequirements: [],
    acceptanceCriteria: ["The main page exposes confirmed direct phone and email actions without a form."],
    requirementReferences: ["brief:customerUxDirection", "brief:contact.publicPhone", "brief:contact.publicEmail"],
  };
  const nextFlows = existingDirectFlow ? current.userFlows.flows : [...current.userFlows.flows, directFlow];
  if (!existingDirectFlow) correctionKinds.push("DIRECT_CONTACT_FLOW");

  const nextTraceability = current.traceability.some((entry) => entry.decisionId === correctionId(`${operationKey}:brief:customerUxDirection,brief:contact.publicPhone,brief:contact.publicEmail`))
    ? current.traceability
    : [...current.traceability, trace(operationKey, ["brief:customerUxDirection", "brief:contact.publicPhone", "brief:contact.publicEmail"], "The active conversion handoff is limited to the customer-confirmed phone and email channels. WhatsApp remains an unpublished placeholder because it is absent from the structured contact authority and allowed-channel policy.")];

  const corrected = PlanningPackageSchema.parse({
    ...current,
    updatedAt: timestamp,
    profile: nextProfile,
    blockers: nextBlockers,
    sitemap: { ...current.sitemap, routes: current.sitemap.routes.map((route) => route.id === mainRoute.id ? nextRoute : route) },
    navigation: nextNavigation,
    pages: { ...current.pages, pages: current.pages.pages.map((page) => page.id === mainPage.id ? nextPage : page) },
    userFlows: { ...current.userFlows, flows: nextFlows },
    architecture: { ...current.architecture, applicationProfile: expectedProfile.selectedProfile },
    traceability: nextTraceability,
  });
  const hostNormalized = normalizePlanningPackageForHost({
    candidate: corrected,
    projectId: current.projectId,
    projectVersion: current.projectVersion,
    approvedBriefChecksum: current.approvedBriefChecksum,
    canonicalBrief,
    current,
    timestamp,
  });
  if (checksumPersistedDocument(hostNormalized) !== checksumPersistedDocument(corrected))
    correctionKinds.push("NORMALIZE_TRACEABILITY_REFERENCES");
  return { package: hostNormalized, correctionKinds: [...new Set(correctionKinds)] };
}

export type ContractAuditPlanningCorrection = {
  kind: "REMOVE_MARKETING_SEO_FROM_LEGAL_ROUTES";
  findingId: string;
  routePaths: ["/datenschutz", "/impressum"];
};

function legalRouteSeoCorrectionEvidence(current: PlanningPackage, audit: ContractAuditRecord, findingId: string) {
  const finding = audit.result.findings.find((entry) => entry.findingId === findingId);
  if (!finding || finding.severity === "INFO" || finding.correctionTarget !== "PLANNING"
    || finding.category !== "ROUTE_CONTRACT_MISMATCH" || finding.routeMismatchAspect !== "SEO_OBLIGATION"
    || !finding.affectedArtifacts.includes("planning-package")) {
    throw new Error("PLANNING_CONTRACT_AUDIT_CORRECTION_EVIDENCE_INCOMPLETE");
  }
  const retainedEvidence = `${finding.summary} ${finding.recommendedAction}`.toLocaleLowerCase("en-US");
  if (!retainedEvidence.includes("/datenschutz") || !retainedEvidence.includes("/impressum")
    || !/seo|metadata/u.test(retainedEvidence) || !/remove|remov/u.test(finding.recommendedAction.toLocaleLowerCase("en-US"))) {
    throw new Error("PLANNING_CONTRACT_AUDIT_CORRECTION_EVIDENCE_INCOMPLETE");
  }

  const homeRoute = current.sitemap.routes.filter((route) => route.path === "/");
  const legalRoutes = (["/datenschutz", "/impressum"] as const).map((routePath) => current.sitemap.routes.filter((route) => route.path === routePath));
  if (homeRoute.length !== 1 || legalRoutes.some((matches) => matches.length !== 1 || matches[0]?.pageType !== "legal"))
    throw new Error("PLANNING_CONTRACT_AUDIT_LEGAL_ROUTES_INCOMPLETE");
  const pages = [homeRoute[0]!, ...legalRoutes.map((matches) => matches[0]!)].map((route) => {
    const matches = current.pages.pages.filter((page) => page.routeId === route.id);
    if (matches.length !== 1) throw new Error("PLANNING_CONTRACT_AUDIT_LEGAL_PAGES_INCOMPLETE");
    return { route, page: matches[0]! };
  });
  const homeMetadata = pages[0]!.page.seoMetadata;
  if (homeMetadata.length === 0) throw new Error("PLANNING_CONTRACT_AUDIT_SEO_SOURCE_MISSING");
  if (pages.slice(1).some(({ page }) => !page.seoMetadata.some((metadata) => homeMetadata.includes(metadata))))
    throw new Error("PLANNING_CONTRACT_AUDIT_SEO_TARGET_EVIDENCE_MISSING");
  const citedPages = pages.map(({ route, page }) => finding.evidenceRefs.some((reference) => [
    route.id, `route:${route.id}`, `planning:${route.id}`, page.id, `page:${page.id}`, `planning:${page.id}`,
  ].includes(reference)));
  if (citedPages.some((cited) => !cited)) throw new Error("PLANNING_CONTRACT_AUDIT_STRUCTURED_ROUTE_EVIDENCE_MISSING");
  return { legalRoutes: legalRoutes.map((matches) => matches[0]!), pages };
}

export function hasSupportedContractAuditPlanningCorrection(current: PlanningPackage, audit: ContractAuditRecord): boolean {
  return audit.result.findings.some((finding) => {
    try {
      legalRouteSeoCorrectionEvidence(current, audit, finding.findingId);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Returns an unaccepted Planning candidate for the one explicitly supported
 * Contract Audit correction. Only homepage SEO entries duplicated on both
 * canonical legal routes are removed; legal-specific metadata is preserved.
 */
export function correctAcceptedPlanningFromContractAudit(input: {
  current: PlanningPackage;
  audit: ContractAuditRecord;
  correction: ContractAuditPlanningCorrection;
  timestamp: string;
}): DeterministicPlanningCorrection {
  const { current, audit, correction, timestamp } = input;
  const { legalRoutes, pages } = legalRouteSeoCorrectionEvidence(current, audit, correction.findingId);
  if (correction.routePaths[0] !== "/datenschutz" || correction.routePaths[1] !== "/impressum")
    throw new Error("PLANNING_CONTRACT_AUDIT_CORRECTION_INPUT_UNSUPPORTED");

  const nextPages = {
    ...current.pages,
    pages: current.pages.pages.map((page) => {
      const routeIndex = legalRoutes.findIndex((route) => route.id === page.routeId);
      if (routeIndex < 0) return page;
      const inherited = new Set(pages[routeIndex + 1]!.page.seoMetadata.filter((metadata) => pages[0]!.page.seoMetadata.includes(metadata)));
      return { ...page, seoMetadata: page.seoMetadata.filter((metadata) => !inherited.has(metadata)) };
    }),
  };
  const candidate = PlanningPackageSchema.parse({
    ...current,
    pages: nextPages,
    accepted: false,
    acceptance: {},
    architecture: { ...current.architecture, acceptance: { accepted: false } },
    updatedAt: timestamp,
  });
  return { package: candidate, correctionKinds: ["REMOVE_MARKETING_SEO_FROM_LEGAL_ROUTES"] };
}
