import { z } from "zod";
import {
  SkillsShAuditResultSchema,
  SkillsShCandidateSchema,
} from "@/integrations/skills-sh/contracts";
import { AGENT_CAPABILITY_IDS } from "@/agents/catalog";

export const CURATION_POLICY_VERSION = "external-skill-curation-v1" as const;
export const CurationReviewerSchema = z.enum([
  "lead",
  "planner",
  "design",
  "implementation",
  "architecture-reviewer",
  "contract-auditor",
  "code-integration-reviewer",
  "security-reviewer",
  "test-quality-reviewer",
]);
export type CurationReviewer = z.infer<typeof CurationReviewerSchema>;
export const CurationCapabilitySchema = z.enum(AGENT_CAPABILITY_IDS);
export type CurationCapability = z.infer<typeof CurationCapabilitySchema>;
export const CurationDimensionSchema = z.enum([
  "strong",
  "moderate",
  "weak",
  "none",
]);
export const ProcedureFitSchema = z.enum(["high", "medium", "low", "none"]);
export const ArchitectureCompatibilitySchema = z.enum([
  "compatible",
  "boundary-compatible",
  "incompatible",
]);
export const ToolCompatibilitySchema = z.enum([
  "compatible",
  "read-only-compatible",
  "incompatible",
]);
export const ContextEfficiencySchema = z.enum([
  "compact",
  "bounded",
  "large",
  "too-large",
]);
export const OverlapAssessmentSchema = z.enum([
  "low",
  "moderate",
  "high",
  "duplicate",
]);
export const LocalSecurityAssessmentSchema = z.enum([
  "pass",
  "fail",
]);
export const ExternalAuditStatusSchema = z.enum([
  "pass",
  "warn",
  "fail",
  "unavailable",
]);
export const CurationDispositionSchema = z.enum([
  "SHORTLIST",
  "REJECT",
  "NEEDS_HUMAN_REVIEW",
]);
export const HumanRecommendationSchema = z.enum([
  "RECOMMEND",
  "OPTIONAL",
  "DO_NOT_USE",
]);
export const CurationMetadataReadinessSchema = z.enum(["COMPLETE", "INCOMPLETE"]);
export const CurationLicenseEvidenceStatusSchema = z.enum(["PRESENT", "MISSING"]);
export const ToolAssumptionCategorySchema = z.enum([
  "agent-or-subagent",
  "shell",
  "git",
  "github",
  "playwright-or-browser",
  "python",
  "filesystem-write",
  "network-fetch",
  "mcp",
  "package-install",
]);
export const ToolAssumptionSchema = z
  .object({
    category: ToolAssumptionCategorySchema,
    essential: z.boolean(),
    evidence: z.array(z.string().max(240)).max(4),
  })
  .strict();
export type ToolAssumption = z.infer<typeof ToolAssumptionSchema>;

export const SkillCandidateEvaluationSchema = z
  .object({
    schemaVersion: z.literal(1),
    policyVersion: z.literal(CURATION_POLICY_VERSION),
    skillId: z.string().min(1),
    sourceId: z.literal("skills-sh"),
    externalSkillId: z.string().min(1),
    canonicalSourceRef: z.string().url(),
    targetReviewer: CurationReviewerSchema,
    targetCapability: CurationCapabilitySchema,
    coverageKeys: z.array(z.string().min(1)).max(20).optional(),
    candidateChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    retrievedContentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.string().min(1),
    displayName: z.string().min(1),
    installs: z.number().int().nonnegative().optional(),
    contentBytes: z.number().int().nonnegative(),
    estimatedInjectionBytes: z.number().int().nonnegative(),
    roleFit: CurationDimensionSchema,
    procedureFit: ProcedureFitSchema,
    architectureCompatibility: ArchitectureCompatibilitySchema,
    toolAssumptionCompatibility: ToolCompatibilitySchema,
    contextEfficiency: ContextEfficiencySchema,
    overlapAssessment: OverlapAssessmentSchema,
    nearDuplicateDetected: z.boolean(),
    localSecurityAssessment: LocalSecurityAssessmentSchema,
    externalAuditStatus: ExternalAuditStatusSchema,
    externalAudit: SkillsShAuditResultSchema,
    metadataReadiness: CurationMetadataReadinessSchema.optional(),
    licenseEvidenceStatus: CurationLicenseEvidenceStatusSchema.optional(),
    toolAssumptions: z.array(ToolAssumptionSchema),
    deterministicChecks: z
      .object({
        metadataValid: z.boolean(),
        exactChecksumKnown: z.boolean(),
        duplicateDetected: z.boolean(),
        nearDuplicateDetected: z.boolean(),
        unsafeFindingCount: z.number().int().nonnegative(),
        externalLinksDetected: z.number().int().nonnegative(),
      })
      .strict(),
    reasons: z.array(z.string().min(1).max(500)).max(20),
    recommendedDisposition: CurationDispositionSchema,
    recommendation: HumanRecommendationSchema,
    semanticEvaluationUsed: z.boolean(),
    stagedSkillId: z.string().min(1).optional(),
    evaluatedAt: z.string().datetime(),
  })
  .strict();
export type SkillCandidateEvaluation = z.infer<
  typeof SkillCandidateEvaluationSchema
>;

export type ExistingCurationCandidate = {
  skillId: string;
  externalSkillId?: string;
  candidateChecksum: string;
  content: string;
};

export type CurationInput = {
  candidate: z.input<typeof SkillsShCandidateSchema>;
  targetReviewer: CurationReviewer;
  targetCapability: CurationCapability;
  coverageKeys?: readonly string[];
  audit?: z.input<typeof SkillsShAuditResultSchema>;
  existingCandidates?: readonly ExistingCurationCandidate[];
  now?: string;
};

export type SemanticCurationResult = {
  roleFit: z.infer<typeof CurationDimensionSchema>;
  procedureFit: z.infer<typeof ProcedureFitSchema>;
  architectureCompatibility: z.infer<
    typeof ArchitectureCompatibilitySchema
  >;
  reasons?: string[];
};

export type SemanticCurationEvaluator = (input: {
  targetReviewer: CurationReviewer;
  targetCapability: CurationCapability;
  boundedContent: string;
}) => Promise<SemanticCurationResult>;
