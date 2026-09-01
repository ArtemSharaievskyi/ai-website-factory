import { z } from "zod";
import { DesignDirectionSetSchema, SelectedDesignSchema } from "@/domain/design/schema";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { WorkflowStateSchema } from "@/domain/project/schema";
import { AssetManifestSchema } from "@/domain/assets/schema";
import { ContentPlanSchema } from "@/domain/content/schema";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { ProviderFailureDiagnosticSchema } from "@/domain/shared/provider-failure";

export const DesignAgentInputSchema = z.object({ projectId: z.string().uuid(), projectVersion: z.number().int().positive(), approvedBrief: RequirementSpecificationSchema, canonicalBrief: CanonicalBriefV3Schema.optional(), approvedBriefChecksum: z.string().regex(/^[a-f0-9]{64}$/), acceptedPlanningPackage: PlanningPackageSchema, acceptedPlanningChecksum: z.string().regex(/^[a-f0-9]{64}$/), contentPlan: ContentPlanSchema, assetManifest: AssetManifestSchema, suppliedBrandMetadata: z.record(z.string(), z.unknown()), suppliedLogoMetadata: z.record(z.string(), z.unknown()), imageSourceDecision: z.enum(["ai-generated", "user-supplied", "ai-plus-user-supplied", "placeholders", "custom", "pending"]), designPreferences: z.array(z.string()), explicitDesignExclusions: z.array(z.string()), currentWorkflowState: WorkflowStateSchema, existingDecisions: z.array(z.unknown()), allowedSkills: z.array(z.string()), idempotencyKey: z.string().min(1), expectedRowVersion: z.number().int().positive() }).strict();
export type DesignAgentInput = z.infer<typeof DesignAgentInputSchema>;
export type { CanonicalBriefV3 };

export const DesignReadinessSchema = z.object({ readyForSelection: z.boolean(), blockingReasons: z.array(z.string()), warnings: z.array(z.string()), directionSetChecksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type DesignReadiness = z.infer<typeof DesignReadinessSchema>;
export const DesignGenerationResultSchema = z.object({ directionSet: DesignDirectionSetSchema, readiness: DesignReadinessSchema }).strict();
export type DesignGenerationResult = z.infer<typeof DesignGenerationResultSchema>;

export const DesignGenerationAttemptStateSchema = z.enum(["CREATED", "CLAIMED", "PROVIDER_STARTED", "PROVIDER_FAILED", "WIRE_FAILED", "DOMAIN_FAILED", "ADMISSION_FAILED", "PERSISTENCE_FAILED", "PERSISTED"]);
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
  selectedSkillIds: z.array(z.string().min(1).max(160)),
  selectedSkillChecksums: z.array(z.object({ skillId: z.string().min(1).max(160), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  failureCode: z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/).optional(),
  failureDiagnostic: ProviderFailureDiagnosticSchema.optional(),
  providerObservation: DesignProviderObservationSchema.optional(),
}).strict();
export type DesignGenerationAttempt = z.infer<typeof DesignGenerationAttemptSchema>;

export const DesignSelectionRequestSchema = z.object({ projectId: z.string().uuid(), projectVersion: z.number().int().positive(), designDirectionSetId: z.string().uuid(), selectedDirectionId: z.string().uuid(), directionSetChecksum: z.string().regex(/^[a-f0-9]{64}$/), selectedDirectionChecksum: z.string().regex(/^[a-f0-9]{64}$/), expectedRowVersion: z.number().int().positive(), selectedBy: z.string().min(1), selectedAt: z.string().datetime(), selectionNotes: z.string().optional(), idempotencyKey: z.string().min(1) }).strict();
export type DesignSelectionRequest = z.input<typeof DesignSelectionRequestSchema>;
export const DesignSelectionResultSchema = z.object({ selectedDesign: SelectedDesignSchema, projectState: z.literal("READY_FOR_IMPLEMENTATION"), rowVersion: z.number().int().positive() }).strict();
export type DesignSelectionResult = z.infer<typeof DesignSelectionResultSchema>;
export const DesignRevisionRequestSchema = z.object({ projectId: z.string().uuid(), projectVersion: z.number().int().positive(), reason: z.string().min(1), requestedBy: z.string().min(1), idempotencyKey: z.string().min(1) }).strict();
export type DesignRevisionRequest = z.input<typeof DesignRevisionRequestSchema>;
export type { DesignDirectionSet, DesignDirection } from "@/domain/design/schema";
