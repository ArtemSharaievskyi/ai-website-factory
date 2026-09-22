import { createHash, randomUUID } from "node:crypto";
import { InvocationDecisionSchema, type ContextBundle, type InvocationDecision, type ProviderPricingProfile } from "./contracts";
import { estimateProviderCost } from "./contracts";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const bytes = (value: string) => Buffer.byteLength(value, "utf8");

export type InvocationUsageRecord = {
  invocationId: string;
  invocationFingerprint: string;
  agentId: string;
  taskId?: string;
  workflowStage: string;
  role: string;
  promptVersion: string;
  contextBundleId?: string;
  contextChecksum?: string;
  provider: string;
  model: string;
  reasoningEffort?: "xhigh";
  resultIdentity?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  uncachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  actualUsageCaptured: boolean;
  cacheTelemetryUnavailable: boolean;
  prefixChecksum: string;
  prefixBytes: number;
  contextMetrics?: ContextBundle["metrics"];
  requestCount: number;
  retryCount: number;
  correctionCount: number;
  estimatedCost?: number;
  pricingProfileId?: string;
  createdAt: string;
};

export type EfficiencyAggregate = {
  llmInvocationCount: number;
  llmAvoidedCount: number;
  reviewerCallAvoidedByCurrentness: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextCandidateBytes: number;
  contextSelectedBytes: number;
  canonicalRequirementBytes: number;
  canonicalRequirementIncludedBytes: number;
  supportingContextBytes: number;
  supportingContextIncludedBytes: number;
  diagnosticBytesBefore: number;
  diagnosticBytesAfter: number;
  skillBytesBefore: number;
  skillBytesAfter: number;
  astPatchBytes: number;
  fullFileCounterfactualBytes: number;
};

export function createEfficiencyAggregate(): EfficiencyAggregate {
  return { llmInvocationCount: 0, llmAvoidedCount: 0, reviewerCallAvoidedByCurrentness: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, contextCandidateBytes: 0, contextSelectedBytes: 0, canonicalRequirementBytes: 0, canonicalRequirementIncludedBytes: 0, supportingContextBytes: 0, supportingContextIncludedBytes: 0, diagnosticBytesBefore: 0, diagnosticBytesAfter: 0, skillBytesBefore: 0, skillBytesAfter: 0, astPatchBytes: 0, fullFileCounterfactualBytes: 0 };
}
export function addUsageToAggregate(aggregate: EfficiencyAggregate, usage: Pick<InvocationUsageRecord, "inputTokens" | "cachedInputTokens" | "outputTokens" | "totalTokens" | "contextMetrics">) {
  aggregate.llmInvocationCount += 1;
  aggregate.inputTokens += usage.inputTokens ?? 0;
  aggregate.cachedInputTokens += usage.cachedInputTokens ?? 0;
  aggregate.outputTokens += usage.outputTokens ?? 0;
  aggregate.totalTokens += usage.totalTokens ?? 0;
  if (usage.contextMetrics) {
    aggregate.contextCandidateBytes += usage.contextMetrics.rawCandidateBytes;
    aggregate.contextSelectedBytes += usage.contextMetrics.selectedBytes;
    aggregate.canonicalRequirementBytes += usage.contextMetrics.canonicalRequirementBytes;
    aggregate.canonicalRequirementIncludedBytes += usage.contextMetrics.canonicalRequirementIncludedBytes;
    aggregate.supportingContextBytes += usage.contextMetrics.supportingContextOriginalBytes;
    aggregate.supportingContextIncludedBytes += usage.contextMetrics.supportingContextIncludedBytes;
    aggregate.diagnosticBytesBefore += usage.contextMetrics.rawDiagnosticBytes;
    aggregate.diagnosticBytesAfter += usage.contextMetrics.diagnosticSelectedBytes;
    aggregate.skillBytesBefore += usage.contextMetrics.skillCandidateBytes;
    aggregate.skillBytesAfter += usage.contextMetrics.skillSelectedBytes;
  }
}

export function createInvocationFingerprint(input: { agentId: string; model: string; schemaVersion: number; currentnessIdentity: string; contextBundleChecksum: string; promptPrefixChecksum: string }) {
  return digest(JSON.stringify({ agentId: input.agentId, model: input.model, schemaVersion: input.schemaVersion, currentnessIdentity: input.currentnessIdentity, contextBundleChecksum: input.contextBundleChecksum, promptPrefixChecksum: input.promptPrefixChecksum }));
}
export function createInvocationUsageRecord(input: Omit<InvocationUsageRecord, "invocationId" | "createdAt" | "uncachedInputTokens" | "estimatedCost"> & { pricingProfile?: ProviderPricingProfile }) {
  const { pricingProfile, ...record } = input;
  const uncachedInputTokens = record.inputTokens === undefined ? undefined : Math.max(0, record.inputTokens - Math.min(record.cachedInputTokens ?? 0, record.inputTokens));
  const totalTokens = record.totalTokens ?? (record.inputTokens !== undefined && record.outputTokens !== undefined ? record.inputTokens + record.outputTokens : undefined);
  const estimatedCost = estimateProviderCost(record, pricingProfile);
  return { ...record, invocationId: randomUUID(), createdAt: new Date().toISOString(), ...(uncachedInputTokens === undefined ? {} : { uncachedInputTokens }), ...(totalTokens === undefined ? {} : { totalTokens }), ...(estimatedCost === undefined ? {} : { estimatedCost }), ...(pricingProfile ? { pricingProfileId: pricingProfile.profileId } : {}) } satisfies InvocationUsageRecord;
}

export type AstPatchEfficiencyMetric = { sourceFileBytes: number; patchPayloadBytes: number; outputReductionRatio: number; relativePath: string; patchKind: string; result: "APPLIED" | "IDEMPOTENT_NOOP" };
export function astPatchEfficiencyMetric(input: { relativePath: string; patchKind: string; sourceFile: string; patchPayload: unknown; result: "APPLIED" | "IDEMPOTENT_NOOP" }): AstPatchEfficiencyMetric {
  const sourceFileBytes = bytes(input.sourceFile);
  const patchPayloadBytes = bytes(JSON.stringify(input.patchPayload));
  return { relativePath: input.relativePath, patchKind: input.patchKind, sourceFileBytes, patchPayloadBytes, outputReductionRatio: Math.max(0, 1 - patchPayloadBytes / Math.max(1, sourceFileBytes)), result: input.result };
}

export function deterministicCallDecision(input: { semanticRequired: boolean; reasonCode?: InvocationDecision["reasonCode"]; explanation: string }): InvocationDecision {
  const decision = input.semanticRequired ? { decision: "LLM_REQUIRED" as const, reasonCode: "SEMANTIC_REASONING_REQUIRED" as const, explanation: input.explanation, deterministic: false } : { decision: "LLM_AVOIDED_DETERMINISTIC" as const, reasonCode: input.reasonCode ?? "CURRENTNESS_CHECK" as const, explanation: input.explanation, deterministic: true };
  return InvocationDecisionSchema.parse(decision);
}
