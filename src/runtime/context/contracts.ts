import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";

export const CONTEXT_BUNDLE_SCHEMA_VERSION = 1 as const;

export const ContextAuthoritySchema = z.enum([
  "CANONICAL_REQUIREMENT",
  "SUPPORTING_TECHNICAL",
]);
export type ContextAuthority = z.infer<typeof ContextAuthoritySchema>;

export const CanonicalDocumentTypeSchema = z.enum([
  "InitialProjectRequest",
  "ClarificationAnswer",
  "ProjectBrief",
  "ApprovedRequirementSet",
  "SelectedDesignDirection",
  "AcceptedDependencyDecision",
  "DatabaseDecision",
  "ApprovedChangeProposal",
  "CurrentCanonicalRequirements",
]);
export type CanonicalDocumentType = z.infer<typeof CanonicalDocumentTypeSchema>;
export const CANONICAL_DOCUMENT_TYPES = CanonicalDocumentTypeSchema.options;

export const ContextItemKindSchema = z.enum([
  "CANONICAL_CONTRACT",
  "FILE_SKELETON",
  "SOURCE_SNIPPET",
  "SYMBOL_SIGNATURE",
  "DEPENDENCY_METADATA",
  "DESIGN_CONTRACT_SLICE",
  "SKILL_SLICE",
  "DOCUMENTATION_SLICE",
  "DIAGNOSTIC",
  "EVIDENCE_SLICE",
  "PROJECT_MANIFEST",
  "STRUCTURAL_RELATION",
]);
export type ContextItemKind = z.infer<typeof ContextItemKindSchema>;

export const ContextPrioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type ContextPriority = z.infer<typeof ContextPrioritySchema>;
export const ContextCurrentnessSchema = z.enum(["CURRENT", "STALE", "UNKNOWN"]);
export type ContextCurrentness = z.infer<typeof ContextCurrentnessSchema>;

export const ContextBudgetPolicySchema = z.object({
  profileId: z.string().min(1),
  softTarget: z.object({ estimatedInputTokens: z.number().int().positive(), bytes: z.number().int().positive() }).strict(),
  hardCeiling: z.object({ estimatedInputTokens: z.number().int().positive(), bytes: z.number().int().positive() }).strict(),
  maxEstimatedInputTokens: z.number().int().positive(),
  maxBytes: z.number().int().positive(),
  maxFiles: z.number().int().positive(),
  maxSnippets: z.number().int().nonnegative(),
  maxSkillBytes: z.number().int().nonnegative(),
  maxDocumentationBytes: z.number().int().nonnegative(),
  maxDiagnostics: z.number().int().nonnegative(),
  reservedResponseTokens: z.number().int().nonnegative(),
  reservedResponseBytes: z.number().int().nonnegative(),
  estimator: z.literal("conservative-four-bytes-per-token"),
}).strict().superRefine((value, context) => {
  if (value.softTarget.estimatedInputTokens > value.hardCeiling.estimatedInputTokens || value.softTarget.bytes > value.hardCeiling.bytes) {
    context.addIssue({ code: "custom", path: ["softTarget"], message: "Soft targets cannot exceed hard ceilings." });
  }
});
export type ContextBudgetPolicy = z.infer<typeof ContextBudgetPolicySchema>;

export const CONTEXT_BUDGET_PROFILES = {
  default: ContextBudgetPolicySchema.parse({ profileId: "default-v1", softTarget: { estimatedInputTokens: 64000, bytes: 256000 }, hardCeiling: { estimatedInputTokens: 96000, bytes: 384000 }, maxEstimatedInputTokens: 96000, maxBytes: 384000, maxFiles: 40, maxSnippets: 24, maxSkillBytes: 48000, maxDocumentationBytes: 24000, maxDiagnostics: 12, reservedResponseTokens: 12000, reservedResponseBytes: 48000, estimator: "conservative-four-bytes-per-token" }),
  implementation: ContextBudgetPolicySchema.parse({ profileId: "implementation-v1", softTarget: { estimatedInputTokens: 48000, bytes: 192000 }, hardCeiling: { estimatedInputTokens: 80000, bytes: 320000 }, maxEstimatedInputTokens: 80000, maxBytes: 320000, maxFiles: 24, maxSnippets: 16, maxSkillBytes: 36000, maxDocumentationBytes: 20000, maxDiagnostics: 10, reservedResponseTokens: 16000, reservedResponseBytes: 64000, estimator: "conservative-four-bytes-per-token" }),
  reviewer: ContextBudgetPolicySchema.parse({ profileId: "reviewer-v1", softTarget: { estimatedInputTokens: 32000, bytes: 128000 }, hardCeiling: { estimatedInputTokens: 64000, bytes: 256000 }, maxEstimatedInputTokens: 64000, maxBytes: 256000, maxFiles: 20, maxSnippets: 16, maxSkillBytes: 24000, maxDocumentationBytes: 16000, maxDiagnostics: 8, reservedResponseTokens: 8000, reservedResponseBytes: 32000, estimator: "conservative-four-bytes-per-token" }),
} as const;

export const ContextLineRangeSchema = z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).strict().refine((value) => value.end >= value.start, "Line range must be ordered.");
export const ContextItemSchema = z.object({
  contextItemId: z.string().min(1),
  kind: ContextItemKindSchema,
  authority: ContextAuthoritySchema,
  canonicalDocumentType: CanonicalDocumentTypeSchema.optional(),
  sourceRef: z.string().min(1),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  selectionReason: z.string().min(1).max(500),
  priority: ContextPrioritySchema,
  required: z.boolean(),
  bytes: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  lineRange: ContextLineRangeSchema.optional(),
  symbolIdentity: z.string().min(1).optional(),
  contentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  currentness: ContextCurrentnessSchema,
  content: z.string(),
}).strict();
export type ContextItem = z.infer<typeof ContextItemSchema>;

export const ContextItemManifestSchema = ContextItemSchema.omit({ content: true }).strict();
export type ContextItemManifest = z.infer<typeof ContextItemManifestSchema>;

export const ContextDeduplicationStatsSchema = z.object({ candidateCount: z.number().int().nonnegative(), selectedCount: z.number().int().nonnegative(), duplicateCount: z.number().int().nonnegative(), duplicateBytes: z.number().int().nonnegative(), omittedOptionalCount: z.number().int().nonnegative(), omittedOptionalBytes: z.number().int().nonnegative() }).strict();
export const ContextSelectionEvidenceSchema = z.object({ selectedReasons: z.array(z.object({ sourceRef: z.string().min(1), reason: z.string().min(1), required: z.boolean() }).strict()), excludedReasons: z.array(z.object({ sourceRef: z.string().min(1), reason: z.string().min(1) }).strict()) }).strict();

export const ContextMetricsSchema = z.object({
  rawCandidateBytes: z.number().int().nonnegative(),
  selectedBytes: z.number().int().nonnegative(),
  canonicalRequirementBytes: z.number().int().nonnegative(),
  canonicalRequirementIncludedBytes: z.number().int().nonnegative(),
  canonicalRequirementChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  canonicalRequirementTruncated: z.literal(false),
  supportingContextOriginalBytes: z.number().int().nonnegative(),
  supportingContextIncludedBytes: z.number().int().nonnegative(),
  supportingContextReductionRatio: z.number().min(0).max(1),
  estimatedInputTokens: z.number().int().nonnegative(),
  fileCandidateCount: z.number().int().nonnegative(),
  fileSelectedCount: z.number().int().nonnegative(),
  fullFileCount: z.number().int().nonnegative(),
  skeletonCount: z.number().int().nonnegative(),
  snippetCount: z.number().int().nonnegative(),
  skillCandidateBytes: z.number().int().nonnegative(),
  skillSelectedBytes: z.number().int().nonnegative(),
  documentationCandidateBytes: z.number().int().nonnegative(),
  documentationSelectedBytes: z.number().int().nonnegative(),
  rawDiagnosticBytes: z.number().int().nonnegative(),
  diagnosticSelectedBytes: z.number().int().nonnegative(),
  deduplicatedBytes: z.number().int().nonnegative(),
  budgetProfile: z.string().min(1),
  budgetUtilization: z.number().min(0).max(1),
  contextReductionRatio: z.number().min(0).max(1),
}).strict();
export type ContextMetrics = z.infer<typeof ContextMetricsSchema>;

export const ContextBundleSchema = z.object({
  contextBundleId: z.string().uuid(),
  schemaVersion: z.literal(CONTEXT_BUNDLE_SCHEMA_VERSION),
  agentId: z.string().min(1),
  agentRole: z.string().min(1),
  workflowStage: z.string().min(1),
  taskId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  projectVersion: z.number().int().positive().optional(),
  currentnessIdentity: z.string().min(1),
  requiredItems: z.array(ContextItemSchema),
  selectedItems: z.array(ContextItemSchema),
  manifest: z.array(ContextItemManifestSchema),
  estimatedInputTokens: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  snippetCount: z.number().int().nonnegative(),
  skillSliceCount: z.number().int().nonnegative(),
  docSliceCount: z.number().int().nonnegative(),
  diagnosticCount: z.number().int().nonnegative(),
  budget: ContextBudgetPolicySchema,
  deduplicationStats: ContextDeduplicationStatsSchema,
  selectionEvidence: ContextSelectionEvidenceSchema,
  metrics: ContextMetricsSchema,
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ContextBundle = z.infer<typeof ContextBundleSchema>;

export const ContextAssemblyBlockerCodeSchema = z.enum(["CONTEXT_REQUIRED_BUDGET_EXCEEDED", "CONTEXT_REQUIRED_ITEM_MISSING", "CONTEXT_SOURCE_STALE", "CONTEXT_SECRET_EXPOSURE_BLOCKED"]);
export type ContextAssemblyBlockerCode = z.infer<typeof ContextAssemblyBlockerCodeSchema>;
export const ContextAssemblyBlockerSchema = z.object({ code: ContextAssemblyBlockerCodeSchema, message: z.string().min(1), requiredBytes: z.number().int().nonnegative(), requiredEstimatedTokens: z.number().int().nonnegative(), budgetProfile: z.string().min(1), missingKinds: z.array(ContextItemKindSchema), authority: ContextAuthoritySchema.optional(), recoverable: z.boolean().optional() }).strict();
export type ContextAssemblyBlocker = z.infer<typeof ContextAssemblyBlockerSchema>;

export const ContextExpansionRequestSchema = z.object({ requestId: z.string().uuid(), reason: z.string().min(8).max(500), requiredSourceRefs: z.array(z.string().min(1)).max(8), requiredSymbols: z.array(z.string().min(1)).max(8), requiredDiagnosticRefs: z.array(z.string().min(1)).max(8), requestedContextKind: ContextItemKindSchema, taskScope: z.array(z.string().min(1)).min(1), maxExpansionCount: z.number().int().positive().max(2), currentExpansionCount: z.number().int().nonnegative().max(2) }).strict();
export type ContextExpansionRequest = z.infer<typeof ContextExpansionRequestSchema>;

export const InvocationDecisionSchema = z.object({ decision: z.enum(["LLM_REQUIRED", "LLM_AVOIDED_DETERMINISTIC"]), reasonCode: z.enum(["SEMANTIC_REASONING_REQUIRED", "SCHEMA_VALIDATION", "CHECKSUM_MISMATCH", "STALE_TASK_CONTRACT", "PATH_TRAVERSAL", "CAPABILITY_DENIED", "DEPENDENCY_NOT_APPROVED", "DUPLICATE_NOOP", "AST_TARGET_AMBIGUITY", "PACKAGE_ALLOWLIST", "EVIDENCE_REFERENCE_INVALID", "DATABASE_NONE_CONTRADICTION", "CURRENTNESS_CHECK", "CONTEXT_REQUIRED_ITEM_MISSING", "CONTEXT_REQUIRED_BUDGET_EXCEEDED"]), explanation: z.string().min(1).max(500), deterministic: z.boolean() }).strict();
export type InvocationDecision = z.infer<typeof InvocationDecisionSchema>;

export const ProviderPricingProfileSchema = z.object({ profileId: z.string().min(1), modelId: z.string().min(1), inputTokenPrice: z.number().nonnegative(), cachedInputTokenPrice: z.number().nonnegative().optional(), outputTokenPrice: z.number().nonnegative(), currency: z.string().length(3), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.string().min(1) }).strict();
export type ProviderPricingProfile = z.infer<typeof ProviderPricingProfileSchema>;
export function estimateProviderCost(usage: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number }, profile?: ProviderPricingProfile) {
  if (!profile || usage.inputTokens === undefined || usage.outputTokens === undefined) return undefined;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncached = usage.inputTokens - cached;
  return (uncached * profile.inputTokenPrice + cached * (profile.cachedInputTokenPrice ?? profile.inputTokenPrice) + usage.outputTokens * profile.outputTokenPrice) / 1_000_000;
}

export function contextChecksum(bundle: Omit<ContextBundle, "checksum">) {
  return checksumPersistedDocument(bundle);
}
