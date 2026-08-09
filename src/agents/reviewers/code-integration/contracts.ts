import { z } from "zod";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { ArchitectureReviewRecordSchema, CodeIntegrationReviewResultSchema, ContractAuditRecordSchema } from "@/domain/review/schema";
import { SelectedDesignSchema } from "@/domain/design/schema";
import { TaskGraphSchema } from "@/domain/tasks/schema";

export const CODE_INTEGRATION_REVIEW_POLICY_VERSION = "code-integration-review-v1";
export const CODE_INTEGRATION_REVIEW_PROMPT_VERSION = "code-integration-reviewer.v1";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const RelativePath = z.string().regex(/^(?!\.\.?\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)(?:\.env|\.git|node_modules|\.factory)(?:\/|$))[A-Za-z0-9_./-]+$/);
export const SourceManifestEntrySchema = z.object({ relativePath: RelativePath, sourceChecksum: Hash, symbols: z.array(z.string().min(1).max(200)).max(30) }).strict();
export const SourceSliceSchema = z.object({ relativePath: RelativePath, symbol: z.string().min(1).max(200).optional(), startLine: z.number().int().positive().optional(), endLine: z.number().int().positive().optional(), content: z.string().min(1).max(30000) }).strict().superRefine((slice, context) => { if (slice.endLine !== undefined && slice.startLine !== undefined && slice.endLine < slice.startLine) context.addIssue({ code: "custom", path: ["endLine"], message: "Source slice line range is invalid." }); });
export const StaticValidationEvidenceSchema = z.object({ sourceChecksum: Hash, lint: z.literal("PASSED"), typecheck: z.literal("PASSED"), structural: z.literal("PASSED"), evidenceRefs: z.array(z.string().min(1).max(300)).min(1) }).strict();
export const ImplementationTaskSummarySchema = z.object({ taskId: z.string().uuid(), taskType: z.string().min(1), status: z.literal("passed"), capability: z.string().min(1), sourceRefs: z.array(RelativePath).max(20) }).strict();
export const CodeIntegrationReviewInputSchema = z.object({
  projectId: z.string().uuid(), projectVersion: z.number().int().positive(), approvedBrief: RequirementSpecificationSchema, briefChecksum: Hash, acceptedPlanningPackage: PlanningPackageSchema, planningChecksum: Hash, approvedArchitectureReview: ArchitectureReviewRecordSchema, architectureReviewChecksum: Hash, selectedDesign: SelectedDesignSchema, designChecksum: Hash, approvedContractAudit: ContractAuditRecordSchema, contractAuditChecksum: Hash, taskGraph: TaskGraphSchema, taskGraphChecksum: Hash, sourceChecksum: Hash, implementationTasks: z.array(ImplementationTaskSummarySchema).max(200), sourceManifest: z.array(SourceManifestEntrySchema).max(500), sourceSlices: z.array(SourceSliceSchema).max(80), staticValidation: StaticValidationEvidenceSchema, runtimePolicyVersion: z.string().min(1), idempotencyKey: z.string().min(1), expectedRowVersion: z.number().int().positive(),
}).strict();
export type CodeIntegrationReviewInput = z.input<typeof CodeIntegrationReviewInputSchema>;
export type CodeIntegrationReviewResult = z.infer<typeof CodeIntegrationReviewResultSchema>;
