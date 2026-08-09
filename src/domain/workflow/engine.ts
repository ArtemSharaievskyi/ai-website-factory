import { DomainError } from "../shared/errors";
import { WorkflowStateSchema } from "../project/schema";
import type { DesignDirectionSet, SelectedDesign } from "../design/schema";
import type { RequirementSpecification } from "../requirements/schema";
import type { ClarificationSession } from "../requirements/schema";
import type { TechnicalArchitecture } from "../architecture/schema";
import type { QualityReport } from "../quality/schema";
import type { ReleaseReport } from "../release/schema";
import type { DecisionRecord } from "./decision";

export type WorkflowState = typeof WorkflowStateSchema.options[number];
export const WORKFLOW_TRANSITIONS: Record<WorkflowState, readonly WorkflowState[]> = {
  DRAFT: ["CLARIFYING"], CLARIFYING: ["AWAITING_BRIEF_APPROVAL"], AWAITING_BRIEF_APPROVAL: ["CLARIFYING", "AWAITING_DESIGN_SELECTION"], AWAITING_DESIGN_SELECTION: ["AWAITING_BRIEF_APPROVAL", "ARCHITECTURE_REVIEW", "READY_FOR_IMPLEMENTATION"], ARCHITECTURE_REVIEW: ["AWAITING_DESIGN_SELECTION", "CLARIFYING", "FAILED"], READY_FOR_IMPLEMENTATION: ["AWAITING_BRIEF_APPROVAL", "AWAITING_DESIGN_SELECTION", "CONTRACT_AUDIT", "IMPLEMENTING"], CONTRACT_AUDIT: ["READY_FOR_IMPLEMENTATION", "CLARIFYING", "FAILED"], IMPLEMENTING: ["CODE_INTEGRATION_REVIEW", "VALIDATING", "FAILED"], CODE_INTEGRATION_REVIEW: ["SECURITY_REVIEW", "VALIDATING", "REPAIRING", "FAILED"], SECURITY_REVIEW: ["VALIDATING", "TEST_QUALITY_REVIEW", "REPAIRING", "FAILED"], VALIDATING: ["CODE_INTEGRATION_REVIEW", "SECURITY_REVIEW", "TEST_QUALITY_REVIEW", "REPAIRING", "PROJECT_READY", "FAILED"], TEST_QUALITY_REVIEW: ["VALIDATING", "PROJECT_READY", "REPAIRING", "FAILED"], REPAIRING: ["VALIDATING", "CODE_INTEGRATION_REVIEW", "SECURITY_REVIEW", "TEST_QUALITY_REVIEW", "FAILED"], PROJECT_READY: [], FAILED: [],
};

export type TransitionContext = { requirements?: RequirementSpecification; clarificationSession?: ClarificationSession; requirementsChecksum?: string; designSet?: DesignDirectionSet; selectedDesign?: SelectedDesign; selectedDirectionChecksum?: string; architecture?: TechnicalArchitecture; decisions?: DecisionRecord[]; qualityReport?: QualityReport; releaseReport?: ReleaseReport; testQualityReviewApproved?: boolean; knownErrors?: string[]; recovery?: boolean };

function reject(code: ConstructorParameters<typeof DomainError>[0], message: string): never { throw new DomainError(code, message); }

export function transitionWorkflow(state: WorkflowState, next: WorkflowState, context: TransitionContext = {}): WorkflowState {
  if (state === "PROJECT_READY") reject("PROJECT_VERSION_IMMUTABLE", "Released project versions are immutable.");
  if (state === "FAILED" && !context.recovery) reject("WORKFLOW_TRANSITION_INVALID", "Failed workflows require explicit recovery.");
  const recoveryTargets: WorkflowState[] = ["CLARIFYING", "AWAITING_BRIEF_APPROVAL", "AWAITING_DESIGN_SELECTION", "ARCHITECTURE_REVIEW", "READY_FOR_IMPLEMENTATION", "CONTRACT_AUDIT", "CODE_INTEGRATION_REVIEW", "SECURITY_REVIEW", "VALIDATING", "TEST_QUALITY_REVIEW", "REPAIRING"];
  if (!(state === "FAILED" && context.recovery && recoveryTargets.includes(next)) && !WORKFLOW_TRANSITIONS[state].includes(next)) reject("WORKFLOW_TRANSITION_INVALID", `Transition from ${state} to ${next} is not permitted.`);
  const unresolvedClarification = context.clarificationSession?.questions.some((question) => question.blocking && question.answerStatus === "unresolved") ?? false;
  if (state === "CLARIFYING" && next === "AWAITING_BRIEF_APPROVAL" && (unresolvedClarification || context.requirements?.unresolvedItems.some((item) => item.blocking))) reject("BLOCKING_CLARIFICATIONS_REMAIN", "Blocking clarification items remain unresolved.");
  if (state === "AWAITING_BRIEF_APPROVAL" && next === "AWAITING_DESIGN_SELECTION") {
    if (!context.requirements?.approval.approved) reject("REQUIREMENTS_NOT_APPROVED", "Requirements must be approved first.");
    if (!context.requirementsChecksum || context.requirements.approval.approvedRequirementsChecksum !== context.requirementsChecksum) reject("REQUIREMENTS_CHECKSUM_MISMATCH", "Approved requirements checksum does not match.");
    if (context.requirements.unresolvedItems.some((item) => item.blocking)) reject("BLOCKING_CLARIFICATIONS_REMAIN", "Blocking requirement items remain unresolved.");
  }
  if (state === "AWAITING_DESIGN_SELECTION" && next === "READY_FOR_IMPLEMENTATION") {
    if (!context.designSet || context.designSet.directions.length !== 3 || !context.designSet.readyForSelection) reject("DESIGN_DIRECTIONS_INVALID", "Exactly three ready design directions are required.");
    if (!context.selectedDesign || context.selectedDesign.directionSetId !== context.designSet.setId || context.selectedDesign.projectId !== context.designSet.projectId || context.selectedDesign.projectVersion !== context.designSet.projectVersion || !context.designSet.directions.some((direction) => direction.id === context.selectedDesign?.selectedDirectionId)) reject("DESIGN_NOT_SELECTED", "A current design direction must be selected.");
    if (context.selectedDirectionChecksum !== context.selectedDesign.selectedDirectionChecksum) reject("DESIGN_CHECKSUM_MISMATCH", "Selected design checksum does not match.");
    if (!context.architecture?.acceptance.accepted) reject("ARCHITECTURE_NOT_ACCEPTED", "Technical architecture must be accepted.");
    if (context.requirements?.imagesRequired && context.requirements.imageSourceDecision === "pending") reject("REQUIREMENTS_NOT_APPROVED", "Image sourcing decision is pending.");
    if (context.requirements?.protectedFunctionalityRequired && context.requirements.authenticationDecision === "pending") reject("REQUIREMENTS_NOT_APPROVED", "Authentication decision is pending for protected functionality.");
  }
  if (state === "READY_FOR_IMPLEMENTATION" && next === "IMPLEMENTING") {
    if (!context.requirements?.approval.approved) reject("REQUIREMENTS_NOT_APPROVED", "Requirements must be approved before implementation.");
    if (!context.architecture?.acceptance.accepted) reject("ARCHITECTURE_NOT_ACCEPTED", "Architecture must be accepted before implementation.");
    if (context.decisions?.some((decision) => decision.requirementChange && decision.userApprovalStatus !== "approved")) reject("UNAPPROVED_REQUIREMENT_CHANGE", "An unapproved requirement change is present.");
  }
  if (state === "VALIDATING" && next === "PROJECT_READY") {
    if (context.testQualityReviewApproved === false) reject("QUALITY_GATES_INCOMPLETE", "A current approved Test / Quality Review is required.");
    if (context.knownErrors?.length || context.releaseReport?.knownErrors.length || context.qualityReport?.knownErrors.length) reject("KNOWN_ERRORS_REMAIN", "Known errors remain.");
    if (!context.releaseReport?.ready || context.qualityReport?.checks.some((check) => check.required && check.status !== "passed" && (check.status !== "skipped" || !check.skippedReason))) reject("QUALITY_GATES_INCOMPLETE", "Required quality gates are incomplete.");
  }
  if (state === "TEST_QUALITY_REVIEW" && next === "PROJECT_READY") {
    if (context.testQualityReviewApproved !== true) reject("QUALITY_GATES_INCOMPLETE", "A current approved Test / Quality Review is required.");
    if (context.knownErrors?.length || context.releaseReport?.knownErrors.length || context.qualityReport?.knownErrors.length) reject("KNOWN_ERRORS_REMAIN", "Known errors remain.");
    if (!context.releaseReport?.ready || context.qualityReport?.checks.some((check) => check.required && check.status !== "passed" && (check.status !== "skipped" || !check.skippedReason))) reject("QUALITY_GATES_INCOMPLETE", "Required quality gates are incomplete.");
  }
  return next;
}
