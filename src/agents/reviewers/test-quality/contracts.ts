import { z } from "zod";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { ArchitectureReviewRecordSchema, CodeIntegrationReviewRecordSchema, ContractAuditRecordSchema, SecurityReviewRecordSchema, TestQualityReviewResultSchema } from "@/domain/review/schema";
import { SelectedDesignSchema } from "@/domain/design/schema";
import { TaskGraphSchema } from "@/domain/tasks/schema";
import { SourceManifestEntrySchema, SourceSliceSchema } from "@/agents/reviewers/code-integration/contracts";

export const TEST_QUALITY_REVIEW_POLICY_VERSION = "test-quality-review-v1";
export const TEST_QUALITY_REVIEW_PROMPT_VERSION = "test-quality-reviewer.v1";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Ref = z.string().min(1).max(500);
const EvidenceStatus = z.enum(["PASSED", "NOT_REQUIRED"]);

export const QualityGateEvidenceSchema = z.object({ name: z.string().min(1), status: EvidenceStatus, sourceChecksum: Hash, evidenceRefs: z.array(Ref).min(1), reportRef: Ref.optional() }).strict();
export const UnitTestEvidenceSchema = z.object({ status: EvidenceStatus, sourceChecksum: Hash, testSourceChecksum: Hash, evidenceRefs: z.array(Ref).min(1), testFiles: z.array(Ref).max(200), testNames: z.array(Ref).max(500), meaningfulAssertions: z.boolean() }).strict();
export const FunctionalScenarioEvidenceSchema = z.object({ scenarioId: Ref, status: z.enum(["PASSED", "NOT_REQUIRED"]), sourceChecksum: Hash, evidenceRefs: z.array(Ref).min(1), requirementReferences: z.array(Ref), assertions: z.array(z.string().min(1)).max(30), flowKind: z.enum(["navigation", "form", "auth", "data", "upload", "admin", "content", "other"]) }).strict();
export const TargetedTestEvidenceSchema = z.object({ taskId: z.string().uuid(), status: z.enum(["PASSED", "FAILED", "NOT_RUN"]), validationRefs: z.array(Ref), ownedArtifacts: z.array(Ref) }).strict();
export const RequirementValidationTraceSchema = z.object({ requirementId: Ref, implementationTaskIds: z.array(z.string().uuid()), validationResponsibility: z.enum(["UNIT", "INTEGRATION", "FUNCTIONAL_QA", "STRUCTURAL", "NONE"]), evidenceRefs: z.array(Ref), risk: z.enum(["LOW", "NORMAL", "HIGH"]) }).strict();
export const QualityEvidenceSummarySchema = z.object({ sourceChecksum: Hash, testSourceChecksum: Hash, requirements: z.array(RequirementValidationTraceSchema), unitTests: UnitTestEvidenceSchema, functionalScenarios: z.array(FunctionalScenarioEvidenceSchema), qualityGates: z.array(QualityGateEvidenceSchema), targetedChecks: z.array(TargetedTestEvidenceSchema), traceEdges: z.array(Ref) }).strict();
export type QualityEvidenceSummary = z.infer<typeof QualityEvidenceSummarySchema>;

export const TestQualityReviewInputSchema = z.object({
  projectId: z.string().uuid(), projectVersion: z.number().int().positive(), approvedBrief: RequirementSpecificationSchema, briefChecksum: Hash,
  acceptedPlanningPackage: PlanningPackageSchema, planningChecksum: Hash, approvedArchitectureReview: ArchitectureReviewRecordSchema, architectureReviewChecksum: Hash,
  selectedDesign: SelectedDesignSchema, designChecksum: Hash, approvedContractAudit: ContractAuditRecordSchema, contractAuditChecksum: Hash,
  approvedCodeIntegrationReview: CodeIntegrationReviewRecordSchema, codeIntegrationReviewChecksum: Hash, approvedSecurityReview: SecurityReviewRecordSchema, securityReviewChecksum: Hash,
  taskGraph: TaskGraphSchema, taskGraphChecksum: Hash, sourceChecksum: Hash, testSourceChecksum: Hash, qualityPolicyVersion: z.string().min(1), qualityEvidence: QualityEvidenceSummarySchema,
  sourceManifest: z.array(SourceManifestEntrySchema).max(500), testSourceSlices: z.array(SourceSliceSchema).max(120), implementationContractRefs: z.array(Ref).max(300),
  idempotencyKey: z.string().min(1), expectedRowVersion: z.number().int().positive(),
}).strict();
export type TestQualityReviewInput = z.input<typeof TestQualityReviewInputSchema>;
export type TestQualityReviewResult = z.infer<typeof TestQualityReviewResultSchema>;
