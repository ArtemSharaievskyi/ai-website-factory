import { BriefV3Error } from "./errors";
import { validateCanonicalBriefV3 } from "./invariants";
import type { CanonicalBriefV3 } from "./schema";
import type { ClarificationQuestion } from "../schema";
import { canonicalUnresolvedBlockingStages, isPhotoRightsUnresolvedRequirement } from "./unresolved";

export type BriefReadinessClarification = {
  questions: ReadonlyArray<Pick<ClarificationQuestion, "id" | "blocking" | "answerStatus">>;
};

export type BriefReadinessApprovalBlocker =
  | { code: "CANONICAL_CONTRADICTION"; invariant: string }
  | { code: "UNRESOLVED_CANONICAL_DECISION"; target: string }
  | { code: "UNRESOLVED_CANONICAL_REQUIREMENT"; target: string }
  | { code: "UNANSWERED_CLARIFICATION"; id: string };

export type BriefPublicationBlockerCode =
  | "FINAL_LEGAL_FACTS_REQUIRED"
  | "PHOTO_RIGHTS_PROVENANCE_REQUIRED"
  | "CURRENT_BRIEF_UNRESOLVED"
  | "CANONICAL_BRIEF_NOT_READY";

export type BriefReadinessResult = {
  readyForApproval: boolean;
  publicationReady: boolean;
  approvalBlockers: ReadonlyArray<BriefReadinessApprovalBlocker>;
  publicationBlockers: ReadonlyArray<BriefPublicationBlockerCode>;
  nonBlockingUnresolvedTargets: ReadonlyArray<string>;
};

const analyticsMarker = /(?:analytics|tracking|telemetrie|analyse)/iu;
const analyticsProhibitionMarker = /(?:no\b|without|kein\w*|keine\w*|ohne|nicht)[^.!?]{0,80}(?:analytics|tracking|telemetrie|analyse)|(?:analytics|tracking|telemetrie|analyse)[^.!?]{0,80}(?:not allowed|forbidden|verboten)/iu;
const inventionMarker = /(?:invent\w*|fabricat\w*|erfind\w*|erfund\w*|business facts?|fakten|unternehmensdaten|geschäftsdaten)/iu;
const inventionProhibitionMarker = /(?:do not|never|without|no\b|kein\w*|keine\w*|nicht|ohne|forbidden|prohibited|verboten)/iu;
const inventionPermissionMarker = /(?:allowed|allow|erlaubt|zulässig)/iu;

function explicitlyForbidsInventedFacts(brief: CanonicalBriefV3): boolean {
  return brief.requirements.some(({ statement }) => {
    if (!inventionMarker.test(statement) || inventionPermissionMarker.test(statement)) return false;
    return inventionProhibitionMarker.test(statement);
  });
}

function hasActiveAnalyticsDecision(brief: CanonicalBriefV3): boolean {
  return brief.requirements.some(({ statement }) => analyticsMarker.test(statement) && !analyticsProhibitionMarker.test(statement));
}

function isUnresolvedDecisionApprovalBlocker(brief: CanonicalBriefV3, target: string): boolean {
  if (target === "FORM_SERVER_PROCESSING_MODE") {
    const form = brief.decisions.form;
    const localSimulation = form.mode === "SIMULATED"
      && form.transmissionMode === "NONE"
      && form.persistenceMode === "NONE"
      && form.externalProviderMode === "NONE";
    if (localSimulation) return false;
  }
  if (target === "ANALYTICS_MODE" && !hasActiveAnalyticsDecision(brief)) return false;
  return true;
}

function unresolvedDecisionTargets(brief: CanonicalBriefV3): string[] {
  const decisions: Array<[string, string]> = [
    ["FORM_SUCCESS_MODE", brief.decisions.form.mode],
    ["FORM_SIMULATED_SUCCESS_POLICY", brief.decisions.form.simulatedSuccessPolicy],
    ["FORM_TRANSMISSION_MODE", brief.decisions.form.transmissionMode],
    ["FORM_PERSISTENCE_MODE", brief.decisions.form.persistenceMode],
    ["FORM_SERVER_PROCESSING_MODE", brief.decisions.form.serverProcessingMode],
    ["FORM_EXTERNAL_PROVIDER_MODE", brief.decisions.form.externalProviderMode],
    ["FORM_PRIVACY_CONSENT_MODE", brief.decisions.form.privacyConsentMode],
    ["DATABASE_MODE", brief.decisions.database.mode],
    ["AUTH_MODE", brief.decisions.auth.mode],
    ["ANALYTICS_MODE", brief.decisions.analytics.mode],
    ["ROUTE_POLICY", brief.decisions.routePolicy.mode],
    ["BRAND_REFERENCE_STRATEGY", brief.brand.referenceStrategy],
    ["IMAGE_SOURCE_STRATEGY", brief.scope.images.sourceStrategy],
    ["LEGAL_PLACEHOLDER_POLICY", brief.legal.placeholderPolicy],
  ];
  if (brief.legal.inventedFactsPolicy === "UNRESOLVED" && !explicitlyForbidsInventedFacts(brief)) {
    decisions.push(["LEGAL_INVENTED_FACTS_POLICY", brief.legal.inventedFactsPolicy]);
  }
  return decisions.filter(([, value]) => value === "UNRESOLVED").map(([target]) => target);
}

function invariantName(error: unknown): string {
  if (error instanceof BriefV3Error) return error.details?.invariant ?? error.code;
  return "invalid-canonical-brief";
}

/**
 * The single host-owned V3 readiness authority. Approval readiness permits
 * explicit legal placeholders; publication readiness never does. Only current
 * clarification questions are inspected, so superseded history cannot return
 * as a blocker.
 */
export function evaluateBriefReadiness(input: {
  brief: CanonicalBriefV3;
  clarificationSession?: BriefReadinessClarification;
}): BriefReadinessResult {
  let brief: CanonicalBriefV3;
  try {
    brief = validateCanonicalBriefV3(input.brief);
  } catch (error) {
    return {
      readyForApproval: false,
      publicationReady: false,
      approvalBlockers: [{ code: "CANONICAL_CONTRADICTION", invariant: invariantName(error) }],
      publicationBlockers: ["CANONICAL_BRIEF_NOT_READY"],
      nonBlockingUnresolvedTargets: [],
    };
  }

  const approvalBlockers: BriefReadinessApprovalBlocker[] = [];
  const nonBlockingUnresolvedTargets: string[] = [];
  const unresolvedTargets = unresolvedDecisionTargets(brief);
  for (const target of unresolvedTargets.filter((candidate) => isUnresolvedDecisionApprovalBlocker(brief, candidate))) approvalBlockers.push({ code: "UNRESOLVED_CANONICAL_DECISION", target });

  for (const item of brief.unresolved) {
    const stages = canonicalUnresolvedBlockingStages(brief, item);
    if (!stages.includes("PLANNING") && !stages.includes("BRIEF_APPROVAL")) nonBlockingUnresolvedTargets.push(item.target);
    else approvalBlockers.push({ code: "UNRESOLVED_CANONICAL_REQUIREMENT", target: item.target });
  }

  const unansweredQuestions = input.clarificationSession?.questions.filter((question) => question.answerStatus === "unresolved") ?? [];
  for (const question of unansweredQuestions) {
    if (question.blocking) approvalBlockers.push({ code: "UNANSWERED_CLARIFICATION", id: question.id });
  }

  const publicationBlockers = new Set<BriefPublicationBlockerCode>();
  if (brief.legal.placeholderPolicy !== "NO_PLACEHOLDERS" || nonBlockingUnresolvedTargets.length > 0) publicationBlockers.add("FINAL_LEGAL_FACTS_REQUIRED");
  if (brief.unresolved.some((item) => isPhotoRightsUnresolvedRequirement(item) && canonicalUnresolvedBlockingStages(brief, item).includes("ASSET_REVIEW"))) publicationBlockers.add("PHOTO_RIGHTS_PROVENANCE_REQUIRED");
  if (brief.unresolved.length > 0 || unansweredQuestions.length > 0) publicationBlockers.add("CURRENT_BRIEF_UNRESOLVED");
  if (approvalBlockers.length > 0) publicationBlockers.add("CANONICAL_BRIEF_NOT_READY");

  const readyForApproval = approvalBlockers.length === 0;
  const publicationReady = readyForApproval
    && brief.unresolved.length === 0
    && unansweredQuestions.length === 0
    && brief.legal.placeholderPolicy === "NO_PLACEHOLDERS"
    && brief.legal.inventedFactsPolicy !== "UNRESOLVED";

  return {
    readyForApproval,
    publicationReady,
    approvalBlockers,
    publicationBlockers: [...publicationBlockers],
    nonBlockingUnresolvedTargets,
  };
}
