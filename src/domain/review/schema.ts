import { z } from "zod";
import { IsoDateTimeSchema } from "@/domain/shared/schemas";

export const ReviewVerdictSchema = z.enum(["APPROVED", "CHANGES_REQUIRED", "BLOCKED"]);
export const ReviewSeveritySchema = z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]);
export const ArchitectureFindingCategorySchema = z.enum(["REQUIREMENT_TRACEABILITY", "SOURCE_OF_TRUTH", "DOMAIN_MODEL", "IDENTITY_MODEL", "DATA_ARCHITECTURE", "AUTH_ARCHITECTURE", "STORAGE_ARCHITECTURE", "API_BOUNDARY", "SERVER_CLIENT_BOUNDARY", "DEPENDENCY_ARCHITECTURE", "SECURITY_ARCHITECTURE", "IMPLEMENTABILITY", "UNNECESSARY_COMPLEXITY", "MISSING_DECISION", "CONTRADICTORY_DECISION"]);
export const ReviewEvidenceReferenceSchema = z.string().min(1).max(500);
export const ReviewFindingSchema = z.object({
  findingId: z.string().regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/),
  severity: ReviewSeveritySchema,
  category: z.string().min(1),
  summary: z.string().min(1),
  evidenceRefs: z.array(ReviewEvidenceReferenceSchema).min(1),
  affectedArtifacts: z.array(ReviewEvidenceReferenceSchema),
  recommendedAction: z.string().min(1),
}).strict();
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewResultSchema = z.object({
  verdict: ReviewVerdictSchema,
  findings: z.array(ReviewFindingSchema),
  reviewedArtifactRefs: z.array(ReviewEvidenceReferenceSchema).min(1),
  policyVersion: z.string().min(1),
  blockedReason: z.string().min(1).optional(),
}).strict().superRefine((result, context) => {
  if (new Set(result.findings.map((finding) => finding.findingId)).size !== result.findings.length) context.addIssue({ code: "custom", path: ["findings"], message: "Finding IDs must be unique." });
  if (result.verdict === "CHANGES_REQUIRED" && result.findings.length === 0) context.addIssue({ code: "custom", path: ["findings"], message: "CHANGES_REQUIRED requires at least one finding." });
  if (result.verdict === "BLOCKED" && (!result.blockedReason || !result.reviewedArtifactRefs.length)) context.addIssue({ code: "custom", path: ["blockedReason"], message: "BLOCKED requires a reason and reviewed evidence." });
  if (result.verdict !== "BLOCKED" && result.blockedReason !== undefined) context.addIssue({ code: "custom", path: ["blockedReason"], message: "Only BLOCKED reviews may include a blocked reason." });
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export const ArchitectureReviewFindingSchema = ReviewFindingSchema.extend({ category: ArchitectureFindingCategorySchema });
export const ArchitectureReviewResultSchema = ReviewResultSchema.safeExtend({ findings: z.array(ArchitectureReviewFindingSchema) }).strict();
export type ArchitectureReviewResult = z.infer<typeof ArchitectureReviewResultSchema>;
export const ArchitectureReviewProviderOutputSchema = z.object({ verdict: ReviewVerdictSchema, findings: z.array(ArchitectureReviewFindingSchema), reviewedArtifactRefs: z.array(ReviewEvidenceReferenceSchema).min(1), policyVersion: z.string().min(1), blockedReason: z.string().min(1).optional() }).strict();
export const ArchitectureReviewRecordSchema = z.object({
  schemaVersion: z.literal(1), documentType: z.literal("architecture-review"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema,
  reviewId: z.string().uuid(), reviewerAgentId: z.literal("architecture-reviewer"), reviewerVersion: z.string().min(1), capability: z.literal("review.architecture"), policyVersion: z.literal("architecture-review-v1"), promptVersion: z.string().min(1), approvedBriefChecksum: z.string().regex(/^[a-f0-9]{64}$/), acceptedPlanningChecksum: z.string().regex(/^[a-f0-9]{64}$/), resultChecksum: z.string().regex(/^[a-f0-9]{64}$/), result: ArchitectureReviewResultSchema,
}).strict();
export type ArchitectureReviewRecord = z.infer<typeof ArchitectureReviewRecordSchema>;
export const ArchitectureReviewHistorySchema = z.object({ schemaVersion: z.literal(1), documentType: z.literal("architecture-review-history"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema, records: z.array(ArchitectureReviewRecordSchema) }).strict();
