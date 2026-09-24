import { createHash } from "node:crypto";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import type { RequirementSpecification } from "@/domain/requirements/schema";
import { PlanningPackageSchema, type PlanningPackage, type Traceability } from "./contracts";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { isNoBackendBrief, selectApplicationProfile } from "./deterministic";
import { normalizePlanningPackageForHost } from "./refresh-admission";

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
