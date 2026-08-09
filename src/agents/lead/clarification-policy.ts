export const CLARIFICATION_POLICY_VERSION = 2;

export type RequirementSemanticClass = "USER_INPUT_REQUIRED" | "WORKFLOW_GATE" | "APPROVAL_GATE" | "SELECTION_GATE" | "QUALITY_GATE" | "TOOL_PREREQUISITE" | "IMPLEMENTATION_CONSTRAINT";
export type RequirementCandidate = { key?: string; description?: string; question?: string; reason?: string; category?: string };

const workflowKey = /^(?:workflow|approval|selection|quality|tool|implementation|release|planning|design|runtime|qa)(?:[._-]|$)/i;
const approval = /\b(?:approve|approval|approved|approving|freigabe|best(?:ä|ae)tigung|best(?:ä|ae)tigt|user approval)\b/i;
const brief = /\b(?:brief|project brief|projektbrief)\b/i;
const planner = /\b(?:planner|planning|planung)\b/i;
const planningAcceptance = /\b(?:planning acceptance|planning package acceptance|accept(?:ed|ance)? planning|planung(?:spaket)?(?:annahme|akzeptanz))\b/i;
const designSelection = /\b(?:design selection|selected design(?:s)?|design direction(?:s)?|visual direction|design(?:richtung|auswahl))\b/i;
const implementation = /\b(?:start implementation|implementation start|before implementation|implementierung starten|implementierung)\b/i;
const quality = /\b(?:release eligibility|release eligible|qa completion|quality gate|runtime checks?|build must pass|before playwright|playwright)\b/i;
const tool = /\b(?:tool prerequisite|context7|shadcn|npm|package manager|dependency installation)\b/i;

export function classifyRequirementCandidate(candidate: RequirementCandidate): RequirementSemanticClass {
  const key = candidate.key ?? "";
  const text = `${key} ${candidate.description ?? ""} ${candidate.question ?? ""} ${candidate.reason ?? ""}`;
  if (approval.test(text) && (brief.test(text) || planner.test(text) || workflowKey.test(key))) return "APPROVAL_GATE";
  if (planningAcceptance.test(text)) return "WORKFLOW_GATE";
  if (designSelection.test(text) && (implementation.test(text) || /select|selection|auswahl/i.test(text))) return "SELECTION_GATE";
  if (quality.test(text)) return "QUALITY_GATE";
  if (tool.test(text)) return "TOOL_PREREQUISITE";
  if (implementation.test(text) && workflowKey.test(key)) return "IMPLEMENTATION_CONSTRAINT";
  return "USER_INPUT_REQUIRED";
}

export function isWorkflowRequirement(candidate: RequirementCandidate) {
  return classifyRequirementCandidate(candidate) !== "USER_INPUT_REQUIRED";
}
