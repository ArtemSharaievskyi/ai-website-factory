import { ArchitectureReviewProviderOutputSchema, type ArchitectureReviewResult } from "@/domain/review/schema";
import { evaluatePlanningAcceptanceReadiness } from "@/agents/planner/deterministic";
import type { ArchitectureReviewInput } from "./contracts";
import type { ArchitectureReviewProvider } from "./ports";

const finding = (findingId: string, category: ArchitectureReviewResult["findings"][number]["category"], severity: ArchitectureReviewResult["findings"][number]["severity"], summary: string, evidenceRefs: string[], recommendedAction: string) => ({ findingId, category, severity, summary, evidenceRefs, affectedArtifacts: evidenceRefs, recommendedAction });
const hasPersistenceRequirement = (input: ArchitectureReviewInput) => [...input.approvedBrief.features, ...input.approvedBrief.forms, ...input.approvedBrief.backendRequirements, ...input.approvedBrief.supabaseRequirements].some((value) => /persist|database|store|save|submission|record/i.test(value));
const isStaticProfile = (input: ArchitectureReviewInput) => input.acceptedPlanningPackage.profile.selectedProfile === "marketing-site" && input.approvedBrief.backendRequirements.length === 0 && input.approvedBrief.supabaseRequirements.length === 0 && input.approvedBrief.authenticationDecision !== "authentication-required";
const hasDuplicate = (values: string[]) => new Set(values).size !== values.length;
const canonicalBriefEvidence = [
  "brief:projectId", "brief:projectVersion", "brief:projectSummary", "brief:protectedFunctionalityRequired", "brief:imagesRequired", "brief:businessGoals", "brief:targetAudiences", "brief:pages", "brief:userRoles", "brief:features", "brief:forms", "brief:contentRequirements", "brief:backendRequirements", "brief:supabaseRequirements", "brief:authenticationDecision", "brief:storageDecision", "brief:emailDecision", "brief:administrationDecision", "brief:seoRequirements", "brief:localization", "brief:imageSourceDecision", "brief:suppliedBrandInformation", "brief:suppliedLogoLocation", "brief:technicalConstraints", "brief:explicitExclusions", "brief:userAcceptanceCriteria", "brief:unresolvedItems", "brief:approval", "brief:projectTitle", "brief:contactFacts", "brief:legalFacts", "brief:brandFacts", "brief:logoMetadata", "brief:imageSourcingNotes", "brief:evidence", "brief:recommendations", "brief:briefStatus", "brief:briefVersion", "brief:briefApprovalNote",
] as const;

export function canonicalArchitectureEvidence(input: ArchitectureReviewInput) {
  const planning = input.acceptedPlanningPackage;
  return new Set([
    ...canonicalBriefEvidence,
    "planning:projectId", "planning:projectVersion", "planning:accepted", "planning:blockers", "planning:architectureAcceptance", "planning:productScope", "planning:sitemap", "planning:pages", "planning:userFlows", "planning:forms", "planning:dataModel", "planning:authentication", "planning:supabase", "planning:storage", "planning:email", "planning:administration", "planning:architecture", "planning:environment", "planning:dependencies", "planning:testStrategy", "planning:security", "planning:traceability",
    ...planning.sitemap.routes.map((route) => `page:${route.id}`), ...planning.pages.pages.map((page) => `page:${page.id}`), ...planning.userFlows.flows.map((flow) => `flow:${flow.id}`), ...planning.forms.forms.map((form) => `form:${form.id}`), ...planning.dataModel.entities.map((entity) => `entity:${entity.id}`), ...planning.traceability.map((entry) => `decision:${entry.decisionId}`),
  ]);
}

export function deterministicArchitectureReview(input: ArchitectureReviewInput) {
  const planning = input.acceptedPlanningPackage;
  const findings: ArchitectureReviewResult["findings"] = [];
  if (isStaticProfile(input) && (planning.authentication.decision !== "none" || planning.dataModel.entities.length > 0 || planning.supabase.postgres || planning.storage.decision !== "not-required" || planning.email.decision !== "not-required" || planning.administration.decision !== "no-admin")) findings.push(finding("unnecessary-infrastructure", "UNNECESSARY_COMPLEXITY", "ERROR", "Planning introduces infrastructure beyond the approved static-site requirements.", ["brief:features", "brief:backendRequirements", "planning:authentication", "planning:dataModel", "planning:supabase", "planning:storage", "planning:email", "planning:administration"], "Remove infrastructure not justified by the approved Brief."));
  if (hasPersistenceRequirement(input) && (planning.dataModel.entities.length === 0 || !planning.supabase.postgres)) findings.push(finding("missing-persistence-architecture", "DATA_ARCHITECTURE", "ERROR", "Approved requirements describe persistent data, but Planning does not provide a persistence architecture.", ["brief:backendRequirements", "brief:forms", "planning:dataModel", "planning:supabase"], "Define the minimal persistence model and its approved Supabase boundary."));
  if (planning.sitemap.routes.some((route) => route.visibility === "protected") && planning.authentication.decision === "none") findings.push(finding("protected-route-without-auth", "AUTH_ARCHITECTURE", "ERROR", "Planning declares a protected route while authentication is disabled.", ["planning:sitemap", "planning:authentication"], "Resolve the authentication decision or make the route public."));
  const routeIds = planning.sitemap.routes.map((route) => route.id);
  if (hasDuplicate(routeIds) || hasDuplicate(planning.pages.pages.map((page) => page.id)) || hasDuplicate(planning.forms.forms.map((form) => form.id))) findings.push(finding("unstable-domain-identifiers", "IDENTITY_MODEL", "ERROR", "Planning contains duplicate internal identifiers.", ["planning:sitemap", "planning:pages", "planning:forms"], "Assign unique stable language-independent identifiers."));
  for (const form of planning.forms.forms) for (const field of form.fields) if ("fieldId" in field && field.fieldId === field.label) findings.push(finding(`localized-identity-${form.id}-${field.fieldId.toLowerCase()}`, "IDENTITY_MODEL", "ERROR", "A user-facing field label is also used as the internal field identity.", [`form:${form.id}`, "planning:forms"], "Use a stable English machine fieldId and keep the localized label separate."));
  if (planning.architecture.componentDecisions.some((decision) => decision.serverOrClient === "client" && /secret|database|service role|private key/i.test(decision.rationale))) findings.push(finding("client-secret-boundary", "SERVER_CLIENT_BOUNDARY", "CRITICAL", "Planning places secret or database responsibilities in a client boundary.", ["planning:architecture", "planning:security"], "Move secrets and privileged data access to a server boundary."));
  if (!evaluatePlanningAcceptanceReadiness({ planningPackage: planning }).readyForAcceptance || !planning.accepted || !planning.architecture.acceptance.accepted) findings.push(finding("planning-not-ready", "MISSING_DECISION", "ERROR", "Planning contains unresolved acceptance blockers or lacks accepted architecture evidence.", ["planning:architecture", "planning:traceability"], "Resolve technical blockers and rerun Planning Acceptance before review."));
  const verdict = findings.some((item) => item.severity === "ERROR" || item.severity === "CRITICAL") ? "CHANGES_REQUIRED" : "APPROVED";
  return ArchitectureReviewProviderOutputSchema.parse({ verdict, findings, reviewedArtifactRefs: ["brief:projectSummary", "planning:architecture"] });
}

export class DeterministicArchitectureReviewProvider implements ArchitectureReviewProvider {
  readonly promptVersion = "architecture-reviewer.v1";
  async review(input: ArchitectureReviewInput) { return deterministicArchitectureReview(input); }
}
