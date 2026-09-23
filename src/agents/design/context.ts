import { designAgentDefinition } from "@/agents/catalog";
import { CONTEXT_BUDGET_PROFILES, ContextBudgetPolicySchema, type ContextBudgetPolicy } from "@/runtime/context/contracts";
import type { DesignAgentInput } from "./contracts";

/**
 * Design receives the current canonical content manifest and the small set of
 * presentation constraints it needs. The full legacy Brief, V3 document,
 * PlanningPackage, and duplicated derived plans remain host-side authorities.
 */
export function buildDesignContext(input: DesignAgentInput) {
  if (!input.canonicalContent) return input;
  return {
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    currentWorkflowState: input.currentWorkflowState,
    canonicalDesignContent: input.canonicalContent,
    presentationConstraints: {
      designPreferences: input.designPreferences,
      explicitDesignExclusions: input.explicitDesignExclusions,
      imageSourceDecision: input.imageSourceDecision,
      ...(input.canonicalBrief?.customerUxDirection ? { customerUxDirection: input.canonicalBrief.customerUxDirection } : {}),
    },
  };
}

export function designContextBreakdown(input: DesignAgentInput) {
  const context = buildDesignContext(input);
  const record = context as Record<string, unknown>;
  const canonicalBytes = Buffer.byteLength(JSON.stringify(record.canonicalDesignContent ?? {}), "utf8");
  const presentationBytes = Buffer.byteLength(JSON.stringify(record.presentationConstraints ?? {}), "utf8");
  const identityBytes = Buffer.byteLength(JSON.stringify({ projectId: record.projectId, projectVersion: record.projectVersion, currentWorkflowState: record.currentWorkflowState }), "utf8");
  const totalBytes = Buffer.byteLength(JSON.stringify(context), "utf8");
  return {
    totalBytes,
    canonicalDesignContentBytes: canonicalBytes,
    presentationConstraintsBytes: presentationBytes,
    identityBytes,
    legacyBriefBytes: 0,
    duplicatedPlanningBytes: 0,
    duplicatedContentPlanBytes: 0,
  };
}

export function designContextBudget(): ContextBudgetPolicy {
  const maxBytes = designAgentDefinition.contextPolicy.maxBytes;
  const maxEstimatedInputTokens = Math.floor(maxBytes / 4);
  const base = CONTEXT_BUDGET_PROFILES.default;
  return ContextBudgetPolicySchema.parse({
    ...base,
    profileId: designAgentDefinition.contextPolicy.version,
    softTarget: {
      estimatedInputTokens: Math.min(base.softTarget.estimatedInputTokens, maxEstimatedInputTokens),
      bytes: Math.min(base.softTarget.bytes, maxBytes),
    },
    hardCeiling: {
      estimatedInputTokens: maxEstimatedInputTokens,
      bytes: maxBytes,
    },
    maxEstimatedInputTokens,
    maxBytes,
  });
}
