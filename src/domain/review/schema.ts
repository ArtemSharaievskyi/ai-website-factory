import { z } from "zod";
import { IsoDateTimeSchema } from "@/domain/shared/schemas";

export const ReviewVerdictSchema = z.enum(["APPROVED", "CHANGES_REQUIRED", "BLOCKED"]);
export const ReviewSeveritySchema = z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]);
export const ArchitectureFindingCategorySchema = z.enum(["REQUIREMENT_TRACEABILITY", "SOURCE_OF_TRUTH", "DOMAIN_MODEL", "IDENTITY_MODEL", "DATA_ARCHITECTURE", "AUTH_ARCHITECTURE", "STORAGE_ARCHITECTURE", "API_BOUNDARY", "SERVER_CLIENT_BOUNDARY", "DEPENDENCY_ARCHITECTURE", "SECURITY_ARCHITECTURE", "IMPLEMENTABILITY", "UNNECESSARY_COMPLEXITY", "MISSING_DECISION", "CONTRADICTORY_DECISION"]);
export const ReviewEvidenceReferenceSchema = z.string().min(1).max(500);
export const ReviewEvidenceIdSchema = z.string().regex(/^E[0-9a-f]{16}-[0-9]{3}$/);
export const ReviewEvidenceCatalogSchema = z.object({
  catalogId: z.string().regex(/^evidence-catalog-[0-9a-f]{16}$/),
  contextChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  entries: z.array(z.object({ id: ReviewEvidenceIdSchema, canonicalRef: ReviewEvidenceReferenceSchema, providerRef: ReviewEvidenceReferenceSchema.optional() }).strict()).min(1),
}).strict();
export type ReviewEvidenceCatalog = z.infer<typeof ReviewEvidenceCatalogSchema>;
export const ReviewEvidenceProvenanceSchema = z.object({ evidenceId: ReviewEvidenceIdSchema, canonicalRef: ReviewEvidenceReferenceSchema }).strict();
export type ReviewEvidenceProvenance = z.infer<typeof ReviewEvidenceProvenanceSchema>;
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
const ProviderReviewFindingSchema = ReviewFindingSchema.extend({
  evidenceRefs: z.array(ReviewEvidenceIdSchema).min(1),
  affectedArtifacts: z.array(ReviewEvidenceIdSchema),
}).strict();

export const ReviewResultSchema = z.object({
  verdict: ReviewVerdictSchema,
  findings: z.array(ReviewFindingSchema),
  reviewedArtifactRefs: z.array(ReviewEvidenceReferenceSchema).min(1),
  policyVersion: z.string().min(1),
  blockedReason: z.string().min(1).nullable().optional(),
}).strict().superRefine((result, context) => {
  if (new Set(result.findings.map((finding) => finding.findingId)).size !== result.findings.length) context.addIssue({ code: "custom", path: ["findings"], message: "Finding IDs must be unique." });
  if (result.verdict === "CHANGES_REQUIRED" && result.findings.length === 0) context.addIssue({ code: "custom", path: ["findings"], message: "CHANGES_REQUIRED requires at least one finding." });
  if (result.verdict === "BLOCKED" && (!result.blockedReason || !result.reviewedArtifactRefs.length)) context.addIssue({ code: "custom", path: ["blockedReason"], message: "BLOCKED requires a reason and reviewed evidence." });
  if (result.verdict !== "BLOCKED" && result.blockedReason != null) context.addIssue({ code: "custom", path: ["blockedReason"], message: "Only BLOCKED reviews may include a blocked reason." });
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export const ArchitectureReviewFindingSchema = ReviewFindingSchema.extend({ category: ArchitectureFindingCategorySchema });
export const ArchitectureReviewResultSchema = ReviewResultSchema.safeExtend({ findings: z.array(ArchitectureReviewFindingSchema) }).strict();
export type ArchitectureReviewResult = z.infer<typeof ArchitectureReviewResultSchema>;
export const ArchitectureReviewProviderOutputSchema = z.object({ verdict: ReviewVerdictSchema, findings: z.array(ProviderReviewFindingSchema.extend({ category: ArchitectureFindingCategorySchema }).strict()), reviewedArtifactRefs: z.array(ReviewEvidenceIdSchema).min(1), blockedReason: z.string().min(1).nullable().optional() }).strict();
export type ArchitectureReviewProviderOutput = z.infer<typeof ArchitectureReviewProviderOutputSchema>;
export const ArchitectureReviewRecordSchema = z.object({
  schemaVersion: z.literal(1), documentType: z.literal("architecture-review"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema,
  reviewId: z.string().uuid(), reviewerAgentId: z.literal("architecture-reviewer"), reviewerVersion: z.string().min(1), capability: z.literal("review.architecture"), policyVersion: z.string().min(1), promptVersion: z.string().min(1), reviewInputChecksum: z.string().regex(/^[a-f0-9]{64}$/), approvedBriefChecksum: z.string().regex(/^[a-f0-9]{64}$/), acceptedPlanningChecksum: z.string().regex(/^[a-f0-9]{64}$/), architectureChecksum: z.string().regex(/^[a-f0-9]{64}$/), phase7cChecksum: z.string().regex(/^[a-f0-9]{64}$/), evidenceCatalogId: z.string().regex(/^evidence-catalog-[0-9a-f]{16}$/).optional(), evidenceCatalogChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(), evidenceProvenance: z.array(ReviewEvidenceProvenanceSchema).optional(), resultChecksum: z.string().regex(/^[a-f0-9]{64}$/), result: ArchitectureReviewResultSchema,
}).strict();
export type ArchitectureReviewRecord = z.infer<typeof ArchitectureReviewRecordSchema>;
export const ArchitectureReviewHistorySchema = z.object({ schemaVersion: z.literal(1), documentType: z.literal("architecture-review-history"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema, records: z.array(ArchitectureReviewRecordSchema) }).strict();
export const ContractFindingCategorySchema = z.enum(["REQUIREMENT_NOT_TRACED", "REQUIREMENT_CONTRADICTION", "ARTIFACT_NOT_OWNED", "ARTIFACT_MULTIPLE_OWNERS", "TASK_REQUIREMENT_MISSING", "TASK_CAPABILITY_MISSING", "EXECUTOR_MISSING", "VALIDATION_NOT_SCHEDULED", "IDENTITY_MISMATCH", "REFERENCE_NOT_FOUND", "DESIGN_CONTRACT_MISMATCH", "FORM_CONTRACT_MISMATCH", "DATA_CONTRACT_MISMATCH", "ROUTE_CONTRACT_MISMATCH", "SCOPE_CONTRACT_MISMATCH", "DEPENDENCY_CONTRACT_MISMATCH"]);
export const ContractCorrectionTargetSchema = z.enum(["PLANNING", "DESIGN", "TASKGRAPH", "WORKFLOW_CONTRACT"]);
export const ContractAuditFindingSchema = ReviewFindingSchema.extend({ category: ContractFindingCategorySchema, correctionTarget: ContractCorrectionTargetSchema.nullable().optional() });
export const ContractAuditResultSchema = ReviewResultSchema.safeExtend({ findings: z.array(ContractAuditFindingSchema) }).strict();
export type ContractAuditFinding = z.infer<typeof ContractAuditFindingSchema>;
export type ContractAuditResult = z.infer<typeof ContractAuditResultSchema>;
export const ContractAuditProviderOutputSchema = z.object({ verdict: ReviewVerdictSchema, findings: z.array(ProviderReviewFindingSchema.extend({ category: ContractFindingCategorySchema, correctionTarget: ContractCorrectionTargetSchema.nullable().optional() }).strict()), reviewedArtifactRefs: z.array(ReviewEvidenceIdSchema).min(1), blockedReason: z.string().min(1).nullable().optional() }).strict();
export type ContractAuditProviderOutput = z.infer<typeof ContractAuditProviderOutputSchema>;
export const ContractAuditRecordSchema = z.object({
  schemaVersion: z.literal(1), documentType: z.literal("contract-audit"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema,
  auditId: z.string().uuid(), auditorAgentId: z.literal("contract-auditor"), auditorVersion: z.string().min(1), capability: z.literal("review.contracts"), policyVersion: z.literal("contract-audit-v1"), promptVersion: z.string().min(1),
  briefChecksum: z.string().regex(/^[a-f0-9]{64}$/), planningChecksum: z.string().regex(/^[a-f0-9]{64}$/), architectureReviewId: z.string().uuid(), architectureReviewChecksum: z.string().regex(/^[a-f0-9]{64}$/), designChecksum: z.string().regex(/^[a-f0-9]{64}$/), taskGraphChecksum: z.string().regex(/^[a-f0-9]{64}$/), evidenceCatalogId: z.string().regex(/^evidence-catalog-[0-9a-f]{16}$/).optional(), evidenceCatalogChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(), evidenceProvenance: z.array(ReviewEvidenceProvenanceSchema).optional(), resultChecksum: z.string().regex(/^[a-f0-9]{64}$/), result: ContractAuditResultSchema,
}).strict();
export type ContractAuditRecord = z.infer<typeof ContractAuditRecordSchema>;
export const ContractAuditHistorySchema = z.object({ schemaVersion: z.literal(1), documentType: z.literal("contract-audit-history"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema, records: z.array(ContractAuditRecordSchema) }).strict();
export const CodeIntegrationFindingCategorySchema = z.enum(["CONTRACT_IMPLEMENTATION_MISMATCH", "MODULE_INTEGRATION_MISMATCH", "SERVER_CLIENT_BOUNDARY", "ROUTE_INTEGRATION", "FORM_INTEGRATION", "DATA_FLOW_INTEGRATION", "AUTH_INTEGRATION", "STATE_OWNERSHIP", "ERROR_HANDLING", "DESIGN_IMPLEMENTATION_MISMATCH", "UNPLANNED_DEPENDENCY", "DUPLICATED_DOMAIN_LOGIC", "INCOMPLETE_FLOW", "IMPLEMENTATION_RESPONSIBILITY_MISMATCH"]);
export const CodeIntegrationCorrectionTargetSchema = z.enum(["IMPLEMENTATION_TASK", "MULTIPLE_IMPLEMENTATION_TASKS", "UPSTREAM_CONTRACT"]);
export const CodeIntegrationFindingSchema = ReviewFindingSchema.extend({ category: CodeIntegrationFindingCategorySchema, correctionTarget: CodeIntegrationCorrectionTargetSchema, ownerTaskId: z.string().uuid().nullable().optional() });
export const CodeIntegrationReviewResultSchema = ReviewResultSchema.safeExtend({ findings: z.array(CodeIntegrationFindingSchema) }).strict();
export type CodeIntegrationReviewResult = z.infer<typeof CodeIntegrationReviewResultSchema>;
export const CodeIntegrationReviewProviderOutputSchema = z.object({ verdict: ReviewVerdictSchema, findings: z.array(ProviderReviewFindingSchema.extend({ category: CodeIntegrationFindingCategorySchema, correctionTarget: CodeIntegrationCorrectionTargetSchema, ownerTaskId: z.string().uuid().nullable().optional() }).strict()), reviewedArtifactRefs: z.array(ReviewEvidenceIdSchema).min(1), blockedReason: z.string().min(1).nullable().optional() }).strict();
export type CodeIntegrationReviewProviderOutput = z.infer<typeof CodeIntegrationReviewProviderOutputSchema>;
export const CodeIntegrationReviewRecordSchema = z.object({
  schemaVersion: z.literal(1), documentType: z.literal("code-integration-review"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema,
  reviewId: z.string().uuid(), reviewerAgentId: z.literal("code-integration-reviewer"), reviewerVersion: z.string().min(1), capability: z.literal("review.integration"), policyVersion: z.literal("code-integration-review-v1"), promptVersion: z.string().min(1),
  briefChecksum: z.string().regex(/^[a-f0-9]{64}$/), planningChecksum: z.string().regex(/^[a-f0-9]{64}$/), architectureReviewChecksum: z.string().regex(/^[a-f0-9]{64}$/), designChecksum: z.string().regex(/^[a-f0-9]{64}$/), contractAuditChecksum: z.string().regex(/^[a-f0-9]{64}$/), taskGraphChecksum: z.string().regex(/^[a-f0-9]{64}$/), sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/), evidenceCatalogId: z.string().regex(/^evidence-catalog-[0-9a-f]{16}$/).optional(), evidenceCatalogChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(), evidenceProvenance: z.array(ReviewEvidenceProvenanceSchema).optional(), resultChecksum: z.string().regex(/^[a-f0-9]{64}$/), result: CodeIntegrationReviewResultSchema,
}).strict();
export const CodeIntegrationReviewHistorySchema = z.object({ schemaVersion: z.literal(1), documentType: z.literal("code-integration-review-history"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema, records: z.array(CodeIntegrationReviewRecordSchema) }).strict();
export const SecurityFindingCategorySchema = z.enum(["TRUST_BOUNDARY", "INPUT_VALIDATION", "AUTHORIZATION", "AUTHENTICATION_FLOW", "SERVER_CLIENT_EXPOSURE", "SECRET_EXPOSURE", "DATABASE_ACCESS", "RLS_POLICY", "STORAGE_ACCESS", "ADMIN_PROTECTION", "MASS_ASSIGNMENT", "UNSAFE_REDIRECT", "ERROR_INFORMATION_EXPOSURE", "EXTERNAL_INPUT_HANDLING", "FILE_UPLOAD_SECURITY", "DEPENDENCY_SECURITY", "SECURITY_CONTRACT_MISMATCH"]);
export const SecurityCorrectionTargetSchema = z.enum(["IMPLEMENTATION_TASK", "MULTIPLE_IMPLEMENTATION_TASKS", "UPSTREAM_SECURITY_CONTRACT"]);
export const SecuritySurfaceSchema = z.enum(["NONE", "FORM_INPUT", "SERVER_ACTION", "ROUTE_HANDLER", "AUTH", "DATABASE", "STORAGE", "UPLOAD", "ADMIN", "EMAIL", "EXTERNAL_API"]);
export type SecuritySurface = z.infer<typeof SecuritySurfaceSchema>;
export const SecurityFindingSchema = ReviewFindingSchema.extend({ category: SecurityFindingCategorySchema, correctionTarget: SecurityCorrectionTargetSchema, ownerTaskId: z.string().uuid().nullable().optional() });
export const SecurityReviewResultSchema = ReviewResultSchema.safeExtend({ findings: z.array(SecurityFindingSchema) }).strict();
export type SecurityReviewResult = z.infer<typeof SecurityReviewResultSchema>;
export const SecurityReviewProviderOutputSchema = z.object({ verdict: ReviewVerdictSchema, findings: z.array(ProviderReviewFindingSchema.extend({ category: SecurityFindingCategorySchema, correctionTarget: SecurityCorrectionTargetSchema, ownerTaskId: z.string().uuid().nullable().optional() }).strict()), reviewedArtifactRefs: z.array(ReviewEvidenceIdSchema).min(1), blockedReason: z.string().min(1).nullable().optional() }).strict();
export type SecurityReviewProviderOutput = z.infer<typeof SecurityReviewProviderOutputSchema>;
export const SecurityReviewRecordSchema = z.object({
  schemaVersion: z.literal(1), documentType: z.literal("security-review"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema,
  reviewId: z.string().uuid(), reviewerAgentId: z.literal("security-reviewer"), reviewerVersion: z.string().min(1), capability: z.literal("review.security"), policyVersion: z.literal("security-review-v1"), promptVersion: z.string().min(1), securitySurface: z.array(SecuritySurfaceSchema).min(1), semanticReviewSkipped: z.boolean(),
  briefChecksum: z.string().regex(/^[a-f0-9]{64}$/), planningChecksum: z.string().regex(/^[a-f0-9]{64}$/), architectureReviewChecksum: z.string().regex(/^[a-f0-9]{64}$/), designChecksum: z.string().regex(/^[a-f0-9]{64}$/), contractAuditChecksum: z.string().regex(/^[a-f0-9]{64}$/), taskGraphChecksum: z.string().regex(/^[a-f0-9]{64}$/), codeIntegrationReviewChecksum: z.string().regex(/^[a-f0-9]{64}$/), sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/), securityEvidenceChecksum: z.string().regex(/^[a-f0-9]{64}$/), evidenceCatalogId: z.string().regex(/^evidence-catalog-[0-9a-f]{16}$/).optional(), evidenceCatalogChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(), evidenceProvenance: z.array(ReviewEvidenceProvenanceSchema).optional(), resultChecksum: z.string().regex(/^[a-f0-9]{64}$/), result: SecurityReviewResultSchema,
}).strict();
export const SecurityReviewHistorySchema = z.object({ schemaVersion: z.literal(1), documentType: z.literal("security-review-history"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema, records: z.array(SecurityReviewRecordSchema) }).strict();
export const TestQualityFindingCategorySchema = z.enum(["REQUIREMENT_NOT_VERIFIED", "CRITICAL_FLOW_NOT_VERIFIED", "WEAK_ASSERTION", "FALSE_CONFIDENCE_TEST", "FORM_FLOW_NOT_VERIFIED", "AUTH_FLOW_NOT_VERIFIED", "DATA_FLOW_NOT_VERIFIED", "ERROR_PATH_NOT_VERIFIED", "FUNCTIONAL_SCENARIO_INCOMPLETE", "TEST_CONTRACT_MISMATCH", "QUALITY_EVIDENCE_STALE", "UNNECESSARY_TEST_COMPLEXITY"]);
export const TestQualityCorrectionTargetSchema = z.enum(["TEST_TASK", "FUNCTIONAL_QA_TASK", "IMPLEMENTATION_TASK", "UPSTREAM_TEST_CONTRACT"]);
export const TestQualityFindingSchema = ReviewFindingSchema.extend({ category: TestQualityFindingCategorySchema, correctionTarget: TestQualityCorrectionTargetSchema, ownerTaskId: z.string().uuid().nullable().optional() });
export const TestQualityReviewResultSchema = ReviewResultSchema.safeExtend({ findings: z.array(TestQualityFindingSchema) }).strict();
export type TestQualityReviewResult = z.infer<typeof TestQualityReviewResultSchema>;
export const TestQualityReviewProviderOutputSchema = z.object({ verdict: ReviewVerdictSchema, findings: z.array(ProviderReviewFindingSchema.extend({ category: TestQualityFindingCategorySchema, correctionTarget: TestQualityCorrectionTargetSchema, ownerTaskId: z.string().uuid().nullable().optional() }).strict()), reviewedArtifactRefs: z.array(ReviewEvidenceIdSchema).min(1), blockedReason: z.string().min(1).nullable().optional() }).strict();
export type TestQualityReviewProviderOutput = z.infer<typeof TestQualityReviewProviderOutputSchema>;
export const TestQualityReviewRecordSchema = z.object({
  schemaVersion: z.literal(1), documentType: z.literal("test-quality-review"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema,
  reviewId: z.string().uuid(), reviewerAgentId: z.literal("test-quality-reviewer"), reviewerVersion: z.string().min(1), capability: z.literal("review.test-quality"), policyVersion: z.literal("test-quality-review-v1"), promptVersion: z.string().min(1),
  briefChecksum: z.string().regex(/^[a-f0-9]{64}$/), planningChecksum: z.string().regex(/^[a-f0-9]{64}$/), architectureReviewChecksum: z.string().regex(/^[a-f0-9]{64}$/), contractAuditChecksum: z.string().regex(/^[a-f0-9]{64}$/), codeIntegrationReviewChecksum: z.string().regex(/^[a-f0-9]{64}$/), securityReviewChecksum: z.string().regex(/^[a-f0-9]{64}$/), sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/), testSourceChecksum: z.string().regex(/^[a-f0-9]{64}$/), qualityEvidenceChecksum: z.string().regex(/^[a-f0-9]{64}$/), evidenceCatalogId: z.string().regex(/^evidence-catalog-[0-9a-f]{16}$/).optional(), evidenceCatalogChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(), evidenceProvenance: z.array(ReviewEvidenceProvenanceSchema).optional(), resultChecksum: z.string().regex(/^[a-f0-9]{64}$/), result: TestQualityReviewResultSchema,
}).strict();
export const TestQualityReviewHistorySchema = z.object({ schemaVersion: z.literal(1), documentType: z.literal("test-quality-review-history"), projectId: z.string().uuid(), projectVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema, records: z.array(TestQualityReviewRecordSchema) }).strict();
