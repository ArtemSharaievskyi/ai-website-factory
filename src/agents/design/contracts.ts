import { z } from "zod";
import { DesignDirectionSetSchema, SelectedDesignSchema } from "@/domain/design/schema";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { WorkflowStateSchema } from "@/domain/project/schema";
import { AssetManifestSchema } from "@/domain/assets/schema";
import { ContentPlanSchema } from "@/domain/content/schema";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { ProviderFailureDiagnosticSchema } from "@/domain/shared/provider-failure";
import { SourceHeadSchema } from "@/domain/shared/source-head";
import { DesignCanonicalContentSchema } from "@/domain/design/canonical-content";

export const DesignAgentInputSchema = z.object({ projectId: z.string().uuid(), projectVersion: z.number().int().positive(), approvedBrief: RequirementSpecificationSchema, canonicalBrief: CanonicalBriefV3Schema.optional(), canonicalContent: DesignCanonicalContentSchema.optional(), approvedBriefChecksum: z.string().regex(/^[a-f0-9]{64}$/), acceptedPlanningPackage: PlanningPackageSchema, acceptedPlanningChecksum: z.string().regex(/^[a-f0-9]{64}$/), contentPlan: ContentPlanSchema, assetManifest: AssetManifestSchema, suppliedBrandMetadata: z.record(z.string(), z.unknown()), suppliedLogoMetadata: z.record(z.string(), z.unknown()), imageSourceDecision: z.enum(["ai-generated", "user-supplied", "ai-plus-user-supplied", "placeholders", "custom", "pending"]), designPreferences: z.array(z.string()), explicitDesignExclusions: z.array(z.string()), currentWorkflowState: WorkflowStateSchema, existingDecisions: z.array(z.unknown()), allowedSkills: z.array(z.string()), idempotencyKey: z.string().min(1), expectedRowVersion: z.number().int().positive() }).strict();
export type DesignAgentInput = z.infer<typeof DesignAgentInputSchema>;
export type { CanonicalBriefV3 };

export const DesignReadinessSchema = z.object({ readyForSelection: z.boolean(), blockingReasons: z.array(z.string()), warnings: z.array(z.string()), directionSetChecksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type DesignReadiness = z.infer<typeof DesignReadinessSchema>;
export const DesignGenerationResultSchema = z.object({ directionSet: DesignDirectionSetSchema, readiness: DesignReadinessSchema }).strict();
export type DesignGenerationResult = z.infer<typeof DesignGenerationResultSchema>;

export const DesignGenerationAttemptStateSchema = z.enum(["CREATED", "CLAIMED", "REPLAY_STARTED", "PROVIDER_STARTED", "OUTCOME_UNKNOWN", "SETUP_FAILED", "PROVIDER_FAILED", "WIRE_FAILED", "DOMAIN_FAILED", "ADMISSION_FAILED", "PERSISTENCE_FAILED", "PERSISTED"]);
export const DesignAdmissionDiagnosticSchema = z.object({
  schemaVersion: z.literal(1),
  boundary: z.literal("PROFESSIONAL_CAPABILITY_PIPELINE"),
  stage: z.enum(["SKILL_COVERAGE", "FONT_SOURCE_DISCOVERY", "COMPONENT_SOURCE_DISCOVERY", "CAPABILITY_ASSEMBLY", "CAPABILITY_VALIDATION", "UNKNOWN"]),
  source: z.enum(["APPROVED_SKILL_REGISTRY", "FONTPAIR", "DESIGN_COMPONENT_SOURCES", "IMPECCABLE", "DEPENDENCY_AUTHORITY", "CAPABILITY_VALIDATOR", "UNKNOWN"]),
  code: z.string().min(1).max(120).regex(/^[A-Z][A-Z0-9_:-]*$/),
  retryability: z.enum(["NOT_RETRYABLE", "REQUIRES_REASSESSMENT", "UNKNOWN"]),
}).strict();
export type DesignAdmissionDiagnostic = z.infer<typeof DesignAdmissionDiagnosticSchema>;
export const DesignAdmissionFindingSchema = z.object({
  code: z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/),
  severity: z.enum(["BLOCKING", "WARNING"]),
  directionIndex: z.number().int().min(0).max(2).nullable(),
  directionRole: z.string().min(1).max(80).nullable(),
  fieldPath: z.string().min(1).max(200).nullable(),
  expectedInvariant: z.string().min(1).max(320),
  actualCategory: z.string().min(1).max(180),
  relatedAuthorities: z.array(z.string().min(1).max(160)).max(8),
  validatorPredicate: z.string().min(1).max(240),
  diagnostic: DesignAdmissionDiagnosticSchema.optional(),
}).strict();
export type DesignAdmissionFinding = z.infer<typeof DesignAdmissionFindingSchema>;
export const DesignProviderObservationSchema = z.object({
  provider: z.literal("openai"),
  model: z.string().min(1).max(160).nullable(),
  requestAttempted: z.boolean(),
  requestId: z.string().min(1).max(160).nullable(),
  responseReceived: z.boolean(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  choicesCount: z.number().int().nonnegative().nullable(),
  finishReason: z.string().min(1).max(160).nullable(),
  refusalPresent: z.boolean().nullable(),
  parsedPresent: z.boolean().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  jsonParseSucceeded: z.boolean().nullable(),
  rawContentBytes: z.number().int().nonnegative().nullable(),
  rawContentChecksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  zodIssueCount: z.number().int().nonnegative().nullable(),
  zodIssuesTruncated: z.boolean().nullable(),
  completeZodIssuesChecksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();
export const DesignAttemptExecutionEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  processId: z.number().int().positive().nullable(),
  processGeneration: z.string().uuid().nullable(),
  processStartedAt: z.string().datetime().nullable(),
  configuredTimeoutMs: z.number().int().positive().nullable(),
  deadlineAt: z.string().datetime().nullable(),
  providerBoundary: z.enum(["NOT_STARTED", "STARTED", "RESPONSE_RECEIVED", "RESPONSE_UNKNOWN"]),
  providerBoundaryAt: z.string().datetime(),
}).strict();
export type DesignAttemptExecutionEvidence = z.infer<typeof DesignAttemptExecutionEvidenceSchema>;
export const DesignOutcomeUnknownEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  code: z.literal("OUTCOME_UNKNOWN"),
  sourceState: z.literal("PROVIDER_STARTED"),
  providerReceipt: z.literal("UNKNOWN"),
  providerUsage: z.literal("UNKNOWN"),
  providerCost: z.literal("UNKNOWN"),
  reconciledAt: z.string().datetime(),
  reconciledBy: z.string().min(1).max(120).regex(/^[A-Za-z0-9:_-]+$/),
  sourceAttemptChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DesignOutcomeUnknownEvidence = z.infer<typeof DesignOutcomeUnknownEvidenceSchema>;
export const DesignPreProviderFailureEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  code: z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/),
  sourceState: z.literal("CLAIMED"),
  providerInvocation: z.literal("NOT_STARTED"),
  providerReceipt: z.literal("NOT_ATTEMPTED"),
  providerUsage: z.literal("NOT_AVAILABLE"),
  providerCost: z.literal("NOT_AVAILABLE"),
  reconciledAt: z.string().datetime(),
  reconciledBy: z.string().min(1).max(120).regex(/^[A-Za-z0-9:_-]+$/),
  sourceAttemptChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DesignPreProviderFailureEvidence = z.infer<typeof DesignPreProviderFailureEvidenceSchema>;
export const DesignFreshAttemptAuthorizationSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("EXPLICIT_USER_AUTHORIZATION"),
  authorizationId: z.string().uuid(),
  authorizedBy: z.string().min(1).max(120).regex(/^[A-Za-z0-9:_-]+$/),
  authorizedAt: z.string().datetime(),
}).strict();
export type DesignFreshAttemptAuthorization = z.infer<typeof DesignFreshAttemptAuthorizationSchema>;
export const DesignGenerationAttemptSchema = z.object({
  schemaVersion: z.literal(1),
  documentType: z.literal("design-generation-attempt"),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  attemptId: z.string().uuid(),
  operationKey: z.string().min(1).max(180),
  state: DesignGenerationAttemptStateSchema,
  expectedRowVersion: z.number().int().positive(),
  approvedBriefChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  acceptedPlanningChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  architectureChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  canonicalContentChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  selectedSkillIds: z.array(z.string().min(1).max(160)),
  selectedSkillChecksums: z.array(z.object({ skillId: z.string().min(1).max(160), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  sourceHead: SourceHeadSchema.optional(),
  executionEvidence: DesignAttemptExecutionEvidenceSchema.optional(),
  providerAttempted: z.boolean().optional(),
  responseReceived: z.boolean().optional(),
  providerModel: z.string().min(1).max(160).optional(),
  providerRequestId: z.string().min(1).max(160).optional(),
  finishReason: z.string().min(1).max(160).nullable().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  providerResultChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  normalizedCandidateSchemaVersion: z.literal(1).optional(),
  normalizedCandidateChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  normalizedCandidate: DesignDirectionSetSchema.optional(),
  replayOfAttemptId: z.string().uuid().optional(),
  replayProviderResultChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  replayNormalizedCandidateChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  admissionFindingCount: z.number().int().nonnegative().optional(),
  admissionFindingsChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  admissionFindings: z.array(DesignAdmissionFindingSchema).max(20).optional(),
  failureCode: z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/).optional(),
  failureDiagnostic: ProviderFailureDiagnosticSchema.optional(),
  providerObservation: DesignProviderObservationSchema.optional(),
  outcomeUnknown: DesignOutcomeUnknownEvidenceSchema.optional(),
  preProviderFailure: DesignPreProviderFailureEvidenceSchema.optional(),
  freshAttemptAuthorization: DesignFreshAttemptAuthorizationSchema.optional(),
}).strict();
export type DesignGenerationAttempt = z.infer<typeof DesignGenerationAttemptSchema>;
export const DesignGenerationAttemptHistorySchema = z.object({
  schemaVersion: z.literal(1),
  documentType: z.literal("design-generation-attempt-history"),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  records: z.array(DesignGenerationAttemptSchema),
}).strict();
export type DesignGenerationAttemptHistory = z.infer<typeof DesignGenerationAttemptHistorySchema>;

export const DesignCandidateReplayRequestSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  historicalAttemptId: z.string().uuid(),
  operationKey: z.string().min(1).max(180),
  expectedRowVersion: z.number().int().positive(),
}).strict();
export type DesignCandidateReplayRequest = z.input<typeof DesignCandidateReplayRequestSchema>;

export const DesignOutcomeUnknownReconciliationRequestSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  attemptId: z.string().uuid(),
  operationKey: z.string().min(1).max(180),
  operationPayloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRowVersion: z.number().int().positive(),
  expectedAttemptChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DesignOutcomeUnknownReconciliationRequest = z.input<typeof DesignOutcomeUnknownReconciliationRequestSchema>;

export const DesignPreProviderFailureReconciliationRequestSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  attemptId: z.string().uuid(),
  operationKey: z.string().min(1).max(180),
  operationPayloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRowVersion: z.number().int().positive(),
  expectedAttemptChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DesignPreProviderFailureReconciliationRequest = z.input<typeof DesignPreProviderFailureReconciliationRequestSchema>;

export const DesignAdmissionInvalidationRequestSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  directionSetChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  operationKey: z.string().min(1).max(180),
  expectedRowVersion: z.number().int().positive(),
}).strict();
export type DesignAdmissionInvalidationRequest = z.input<typeof DesignAdmissionInvalidationRequestSchema>;

export const DesignSelectionRequestSchema = z.object({ projectId: z.string().uuid(), projectVersion: z.number().int().positive(), designDirectionSetId: z.string().uuid(), selectedDirectionId: z.string().uuid(), directionSetChecksum: z.string().regex(/^[a-f0-9]{64}$/), selectedDirectionChecksum: z.string().regex(/^[a-f0-9]{64}$/), expectedRowVersion: z.number().int().positive(), selectedBy: z.string().min(1), selectedAt: z.string().datetime(), selectionNotes: z.string().optional(), idempotencyKey: z.string().min(1) }).strict();
export type DesignSelectionRequest = z.input<typeof DesignSelectionRequestSchema>;
export const DesignSelectionResultSchema = z.object({ selectedDesign: SelectedDesignSchema, projectState: z.literal("READY_FOR_IMPLEMENTATION"), rowVersion: z.number().int().positive() }).strict();
export type DesignSelectionResult = z.infer<typeof DesignSelectionResultSchema>;
export const DesignRevisionRequestSchema = z.object({ projectId: z.string().uuid(), projectVersion: z.number().int().positive(), reason: z.string().min(1), requestedBy: z.string().min(1), idempotencyKey: z.string().min(1) }).strict();
export type DesignRevisionRequest = z.input<typeof DesignRevisionRequestSchema>;
export type { DesignDirectionSet, DesignDirection } from "@/domain/design/schema";
