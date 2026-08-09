import { z } from "zod";

export const ReviewVerdictSchema = z.enum(["APPROVED", "CHANGES_REQUIRED", "BLOCKED"]);
export const ReviewSeveritySchema = z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]);
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
