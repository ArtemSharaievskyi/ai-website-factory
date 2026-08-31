import { DecisionRecordSchema, type DecisionRecord } from "@/domain/workflow/decision";
import type { RequirementSpecification } from "@/domain/requirements/schema";
import type { CanonicalBriefV3 } from "./schema";
import { evaluateBriefReadiness } from "./readiness";

export const REAL_FORM_PROCESSING_APPROVAL_CATEGORY = "real-form-processing" as const;
export const REAL_FORM_PROCESSING_APPROVAL_DECISION = "REAL_FORM_PROCESSING_APPROVED" as const;
export const REAL_FORM_PROCESSING_APPROVAL_CODE = "REAL_FORM_PROCESSING_EXPLICIT_APPROVAL_REQUIRED" as const;
const REAL_FORM_PROCESSING_TASK_TYPES = new Set(["implement-server-action", "implement-route-handler", "implement-email"]);

type FormRequirements = Pick<RequirementSpecification, "formBehaviorRequirements"> | CanonicalBriefV3;

function formState(input: FormRequirements) {
  if ("decisions" in input) return input.decisions.form;
  return input.formBehaviorRequirements;
}

/** A real form is the only form state that may create a processing side effect. */
export function requiresRealFormProcessingApproval(input: FormRequirements): boolean {
  const form = formState(input);
  if (!form) return false;
  if ("mode" in form) {
    return form.mode === "REAL"
      || form.transmissionMode !== "NONE"
      || form.persistenceMode !== "NONE"
      || form.serverProcessingMode !== "NONE"
      || form.externalProviderMode !== "NONE";
  }
  return form.successUx === "REAL"
    || form.dataTransmission !== "NONE"
    || form.persistence !== "NONE"
    || form.thirdParty !== "NONE";
}

export function isRealFormProcessingTask(taskType: string): boolean {
  return REAL_FORM_PROCESSING_TASK_TYPES.has(taskType);
}

function approvalBindsToBrief(record: DecisionRecord, approvedBriefChecksum: string): boolean {
  return record.actorType === "user"
    && record.category === REAL_FORM_PROCESSING_APPROVAL_CATEGORY
    && record.decision === REAL_FORM_PROCESSING_APPROVAL_DECISION
    && record.userApprovalRequired
    && record.userApprovalStatus === "approved"
    && record.affectedDocuments.includes(`brief-v3:${approvedBriefChecksum}`);
}

/** Generic project or Brief approval is deliberately insufficient for this side effect. */
export function hasExplicitRealFormProcessingApproval(input: {
  decisions: readonly unknown[];
  approvedBriefChecksum: string;
}): boolean {
  return input.decisions.some((candidate) => {
    const record = DecisionRecordSchema.safeParse(candidate);
    return record.success && approvalBindsToBrief(record.data, input.approvedBriefChecksum);
  });
}

export function evaluateRealFormProcessingGate(input: {
  brief: FormRequirements;
  decisions: readonly unknown[];
  approvedBriefChecksum: string;
}) {
  const required = requiresRealFormProcessingApproval(input.brief);
  const approved = !required || hasExplicitRealFormProcessingApproval(input);
  return {
    owner: "IMPLEMENTATION" as const,
    required,
    approved,
    allowed: approved,
    blockers: approved ? [] : [REAL_FORM_PROCESSING_APPROVAL_CODE],
  };
}

/** Release remains hard-blocked by canonical publication readiness and side-effect approval. */
export function evaluateReleaseLifecycleGates(input: {
  brief: CanonicalBriefV3;
  decisions: readonly unknown[];
  approvedBriefChecksum: string;
}) {
  const readiness = evaluateBriefReadiness({ brief: input.brief });
  const form = evaluateRealFormProcessingGate(input);
  const blockers = [...new Set([...readiness.publicationBlockers, ...form.blockers])];
  return {
    ready: blockers.length === 0,
    blockers,
    publicationReady: readiness.publicationReady,
    formProcessing: form,
  };
}
