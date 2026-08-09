import { z } from "zod";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { ArchitectureReviewRecordSchema, CodeIntegrationReviewRecordSchema, SecurityReviewResultSchema, SecuritySurfaceSchema, ContractAuditRecordSchema } from "@/domain/review/schema";
import { SelectedDesignSchema } from "@/domain/design/schema";
import { TaskGraphSchema } from "@/domain/tasks/schema";
import { SourceManifestEntrySchema, SourceSliceSchema } from "@/agents/reviewers/code-integration/contracts";

export const SECURITY_REVIEW_POLICY_VERSION = "security-review-v1";
export const SECURITY_REVIEW_PROMPT_VERSION = "security-reviewer.v1";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const SafeName = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
export const SecurityEnvironmentDeclarationSchema = z.object({ name: SafeName, serverOnly: z.boolean(), secret: z.boolean() }).strict();
export const SecurityArtifactReferenceSchema = z.object({ relativePath: z.string().regex(/^(?!\.\.?\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)(?:\.env|\.git|node_modules|\.factory)(?:\/|$))[A-Za-z0-9_./-]+$/), surface: SecuritySurfaceSchema, ownerTaskId: z.string().uuid().optional() }).strict();
export const DeterministicSecurityEvidenceSchema = z.object({ checksum: Hash, status: z.enum(["PASSED", "NOT_REQUIRED"]), evidenceRefs: z.array(z.string().min(1).max(300)).min(1), npmAudit: z.enum(["PASSED", "NOT_REQUIRED"]) }).strict();
export const SecurityPolicySummarySchema = z.object({ authRequired: z.boolean(), authDecision: z.string().min(1), persistenceRequired: z.boolean(), persistenceDecision: z.string().min(1), storageDecision: z.string().min(1), adminDecision: z.string().min(1), rlsRequired: z.boolean(), uploadRequired: z.boolean(), emailRequired: z.boolean(), externalApiRequired: z.boolean() }).strict();
export const SecurityReviewInputSchema = z.object({
  projectId: z.string().uuid(), projectVersion: z.number().int().positive(), approvedBrief: RequirementSpecificationSchema, briefChecksum: Hash, acceptedPlanningPackage: PlanningPackageSchema, planningChecksum: Hash, approvedArchitectureReview: ArchitectureReviewRecordSchema, architectureReviewChecksum: Hash, selectedDesign: SelectedDesignSchema, designChecksum: Hash, approvedContractAudit: ContractAuditRecordSchema, contractAuditChecksum: Hash, approvedCodeIntegrationReview: CodeIntegrationReviewRecordSchema, codeIntegrationReviewChecksum: Hash, taskGraph: TaskGraphSchema, taskGraphChecksum: Hash, sourceChecksum: Hash, securityPolicySummary: SecurityPolicySummarySchema, environmentDeclarations: z.array(SecurityEnvironmentDeclarationSchema).max(100), securitySensitiveArtifacts: z.array(SecurityArtifactReferenceSchema).max(200), sourceManifest: z.array(SourceManifestEntrySchema).max(500), sourceSlices: z.array(SourceSliceSchema).max(80), deterministicSecurityEvidence: DeterministicSecurityEvidenceSchema, unitTestEvidence: z.object({ status: z.enum(["PASSED", "NOT_REQUIRED"]), evidenceRefs: z.array(z.string().min(1).max(300)).min(1) }).strict(), runtimePolicyVersion: z.string().min(1), idempotencyKey: z.string().min(1), expectedRowVersion: z.number().int().positive(),
}).strict();
export type SecurityReviewInput = z.input<typeof SecurityReviewInputSchema>;
export type SecurityReviewResult = z.infer<typeof SecurityReviewResultSchema>;
