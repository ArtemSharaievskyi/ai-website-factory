import { z } from "zod";
import {
  SkillLicenseIdentifierSchema,
  SkillLicensePolicyStatusSchema,
  SkillLicenseScopeSchema,
} from "@/skills/registry/contracts";
import {
  CandidateApprovalReadinessSchema,
  ExternalSkillEvidenceSchema,
  MetadataEvidenceReferenceSchema,
  assessCandidateEvidence,
  createHumanLicenseEvidence,
  extractMetadataEvidence,
} from "./evidence";
import {
  CurationReviewerSchema,
  CURATION_POLICY_VERSION,
  SkillCandidateEvaluationSchema,
} from "./contracts";

const ToolAssumptionRecordSchema = z
  .object({
    category: z.string().min(1),
    essential: z.boolean(),
    evidence: z.array(z.string().min(1)),
  })
  .strict();

const HumanLicenseSourceSchema = z
  .object({
    canonicalRepository: z.string().url(),
    normalizedRepository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    suppliedBy: z.literal("HUMAN"),
  })
  .strict();

const PurposeEvidenceSchema = z
  .object({
    status: z.enum(["COMPLETE", "INCOMPLETE"]),
    reference: MetadataEvidenceReferenceSchema.optional(),
  })
  .strict();

const CurrentnessSchema = z
  .object({
    status: z.enum(["CURRENT", "CHANGED"]),
    expectedCandidateChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    evaluationCandidateChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    stagedRecordCandidateChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    stagedContentManifestVerified: z.boolean(),
    upstreamNetworkChecked: z.literal(false),
  })
  .strict();

const ExternalAuditEvidenceSchema = z
  .object({
    status: z.enum(["PASS", "WARN", "FAIL", "UNAVAILABLE"]),
    advisory: z.literal(true),
    source: z.literal("existing-checksum-bound-evaluation"),
    records: z.array(
      z
        .object({
          provider: z.string().min(1),
          status: z.enum(["pass", "warn", "fail"]),
          auditedAt: z.string().datetime({ offset: true }).optional(),
          summary: z.string().max(500).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const ExternalAdvanceEvidenceRecordSchema = z
  .object({
    externalSkillId: z.string().min(1),
    targetAgent: CurationReviewerSchema,
    targetCapability: z.string().min(1),
    coverageKeys: z.array(z.string().min(1)).min(1),
    sourceId: z.literal("skills-sh"),
    source: z.string().min(1),
    slug: z.string().min(1),
    stagedSkillId: z.string().min(1),
    candidateChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    normalizedContentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    retrievedContentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    retrievedContent: z.literal("LOCAL_STAGED_CONTENT"),
    evaluation: z
      .object({
        policyVersion: z.literal(CURATION_POLICY_VERSION),
        procedureFit: z.string().min(1),
        roleFit: z.string().min(1),
        toolAssumptionCompatibility: z.string().min(1),
        overlapAssessment: z.string().min(1),
        localSecurityAssessment: z.literal("pass"),
        recommendedDisposition: z.literal("NEEDS_HUMAN_REVIEW"),
      })
      .strict(),
    provenance: z
      .object({
        canonicalSource: z.string().url(),
        sourceRepository: z.string().min(1),
        sourceCommit: z.string().min(1),
        sourceRef: z.string().url(),
        targetRole: z.string().min(1),
      })
      .strict(),
    licenseEvidence: ExternalSkillEvidenceSchema,
    canonicalLicenseSource: HumanLicenseSourceSchema,
    licenseId: SkillLicenseIdentifierSchema,
    licenseEvidenceType: z.literal("CANONICAL_SOURCE_LICENSE"),
    licenseScope: SkillLicenseScopeSchema,
    licensePolicyStatus: SkillLicensePolicyStatusSchema,
    attributionObligations: z.array(z.literal("ATTRIBUTION_REQUIRED")),
    purposeEvidence: PurposeEvidenceSchema,
    stepsEvidence: z.array(MetadataEvidenceReferenceSchema),
    toolAssumptions: z.array(ToolAssumptionRecordSchema),
    toolCompatibility: z.enum(["COMPATIBLE", "OPTIONAL_ONLY", "INCOMPATIBLE"]),
    staticSecurity: z
      .object({
        status: z.literal("PASS"),
        approvalBlockingFinding: z.literal(false),
      })
      .strict(),
    externalAudit: ExternalAuditEvidenceSchema,
    overlapStatus: z.enum(["JUSTIFIED", "NOT_JUSTIFIED"]),
    currentness: CurrentnessSchema,
    approvalReadiness: CandidateApprovalReadinessSchema,
    blockers: z.array(z.string().min(1)),
    evidencePolicyVersion: z.literal(CURATION_POLICY_VERSION),
    recordedAt: z.string().datetime(),
  })
  .strict();
export type ExternalAdvanceEvidenceRecord = z.infer<
  typeof ExternalAdvanceEvidenceRecordSchema
>;

export const ExternalAdvanceEvidenceArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    phase: z.literal("4D2"),
    generatedAt: z.string().datetime(),
    discoverySearches: z.literal(0),
    githubRequests: z.literal(0),
    approvalCalled: z.literal(false),
    assignmentsChanged: z.literal(false),
    approvedExternalSkillCount: z.literal(3),
    assignedExternalSkillCount: z.literal(3),
    approvedInternalSkillCount: z.literal(0),
    assignedInternalSkillCount: z.literal(0),
    candidates: z.array(ExternalAdvanceEvidenceRecordSchema).length(4),
  })
  .strict();
export type ExternalAdvanceEvidenceArtifact = z.infer<
  typeof ExternalAdvanceEvidenceArtifactSchema
>;

export type ExternalAdvanceBuildInput = {
  externalSkillId: string;
  targetAgent: z.infer<typeof CurationReviewerSchema>;
  targetCapability: string;
  coverageKeys: string[];
  source: string;
  slug: string;
  stagedSkillId: string;
  candidateChecksum: string;
  retrievedContentChecksum: string;
  sourceCommit: string;
  canonicalSource: string;
  canonicalLicenseSource: string;
  normalizedRepository: string;
  licenseId: z.infer<typeof SkillLicenseIdentifierSchema>;
  licenseScope: z.infer<typeof SkillLicenseScopeSchema>;
  licensePolicyStatus: z.infer<typeof SkillLicensePolicyStatusSchema>;
  attributionObligations: Array<"ATTRIBUTION_REQUIRED">;
  stagedRecordCandidateChecksum: string;
  stagedContentManifestVerified: boolean;
  stagedContent: string;
  evaluation: z.infer<typeof SkillCandidateEvaluationSchema>;
  recordedAt: string;
  toolCompatibility: "COMPATIBLE" | "OPTIONAL_ONLY" | "INCOMPATIBLE";
  overlapStatus: "JUSTIFIED" | "NOT_JUSTIFIED";
  roleFit: "VALID" | "MISMATCH";
};

export function buildExternalAdvanceEvidenceRecord(
  input: ExternalAdvanceBuildInput,
): ExternalAdvanceEvidenceRecord {
  const metadata = extractMetadataEvidence(input.stagedContent);
  const licenseEvidence = createHumanLicenseEvidence({
    externalSkillId: input.externalSkillId,
    candidateChecksum: input.candidateChecksum,
    sourceRepository: input.normalizedRepository,
    recordedAt: input.recordedAt,
    licenseId: input.licenseId,
    licenseScope: input.licenseScope,
    licensePolicyStatus: input.licensePolicyStatus,
    attributionObligations: input.attributionObligations,
  });
  const status = assessCandidateEvidence({
    externalSkillId: input.externalSkillId,
    expectedExternalSkillId: input.externalSkillId,
    expectedChecksum: input.candidateChecksum,
    expectedSourceRepository: input.normalizedRepository,
    expectedSourceRef: licenseEvidence.sourceRef,
    stagedExternalSkillId: input.externalSkillId,
    stagedChecksum: input.stagedRecordCandidateChecksum,
    evaluationChecksum: input.evaluation.candidateChecksum,
    upstreamExternalSkillId: input.externalSkillId,
    upstreamChecksum: input.candidateChecksum,
    metadataUnresolved: metadata.unresolved,
    metadataEvidence: metadata,
    licenseEvidence,
    hasApprovalBlockingFinding: input.evaluation.localSecurityAssessment !== "pass",
    externalAuditStatus: input.evaluation.externalAuditStatus,
    toolCompatibility: input.toolCompatibility,
    roleFit: input.roleFit,
    overlapStatus: input.overlapStatus,
  });
  const audit = input.evaluation.externalAudit;
  const auditRecords = audit.response?.audits ?? [];
  return ExternalAdvanceEvidenceRecordSchema.parse({
    externalSkillId: input.externalSkillId,
    targetAgent: input.targetAgent,
    targetCapability: input.targetCapability,
    coverageKeys: input.coverageKeys,
    sourceId: "skills-sh",
    source: input.source,
    slug: input.slug,
    stagedSkillId: input.stagedSkillId,
    candidateChecksum: input.candidateChecksum,
    normalizedContentChecksum: input.candidateChecksum,
    retrievedContentChecksum: input.retrievedContentChecksum,
    retrievedContent: "LOCAL_STAGED_CONTENT",
    evaluation: {
      policyVersion: input.evaluation.policyVersion,
      procedureFit: input.evaluation.procedureFit,
      roleFit: input.evaluation.roleFit,
      toolAssumptionCompatibility: input.evaluation.toolAssumptionCompatibility,
      overlapAssessment: input.evaluation.overlapAssessment,
      localSecurityAssessment: input.evaluation.localSecurityAssessment,
      recommendedDisposition: input.evaluation.recommendedDisposition,
    },
    provenance: {
      canonicalSource: input.canonicalSource,
      sourceRepository: input.source,
      sourceCommit: input.sourceCommit,
      sourceRef: `https://github.com/${input.source}`,
      targetRole: input.targetAgent,
    },
    licenseEvidence,
    canonicalLicenseSource: {
      canonicalRepository: input.canonicalLicenseSource,
      normalizedRepository: input.normalizedRepository,
      suppliedBy: "HUMAN",
    },
    licenseId: input.licenseId,
    licenseEvidenceType: "CANONICAL_SOURCE_LICENSE",
    licenseScope: input.licenseScope,
    licensePolicyStatus: input.licensePolicyStatus,
    attributionObligations: input.attributionObligations,
    purposeEvidence: {
      status: metadata.purpose ? "COMPLETE" : "INCOMPLETE",
      reference: metadata.purpose,
    },
    stepsEvidence: metadata.steps,
    toolAssumptions: input.evaluation.toolAssumptions,
    toolCompatibility: input.toolCompatibility,
    staticSecurity: {
      status: status.localSecurityStatus,
      approvalBlockingFinding: status.localSecurityStatus === "BLOCKED",
    },
    externalAudit: {
      status: status.externalAuditStatus,
      advisory: true,
      source: "existing-checksum-bound-evaluation",
      records: auditRecords.map((record) => ({
        provider: record.provider,
        status: record.status,
        auditedAt: record.auditedAt,
        summary: record.summary,
      })),
    },
    overlapStatus: input.overlapStatus,
    currentness: {
      status:
        input.candidateChecksum === input.stagedRecordCandidateChecksum &&
        input.candidateChecksum === input.evaluation.candidateChecksum
          ? "CURRENT"
          : "CHANGED",
      expectedCandidateChecksum: input.candidateChecksum,
      evaluationCandidateChecksum: input.evaluation.candidateChecksum,
      stagedRecordCandidateChecksum: input.stagedRecordCandidateChecksum,
      stagedContentManifestVerified: input.stagedContentManifestVerified,
      upstreamNetworkChecked: false,
    },
    approvalReadiness: status.readiness,
    blockers: status.blockers,
    evidencePolicyVersion: CURATION_POLICY_VERSION,
    recordedAt: input.recordedAt,
  });
}

export function buildExternalAdvanceEvidenceArtifact(
  candidates: ExternalAdvanceEvidenceRecord[],
  generatedAt: string,
): ExternalAdvanceEvidenceArtifact {
  return ExternalAdvanceEvidenceArtifactSchema.parse({
    schemaVersion: 1,
    phase: "4D2",
    generatedAt,
    discoverySearches: 0,
    githubRequests: 0,
    approvalCalled: false,
    assignmentsChanged: false,
    approvedExternalSkillCount: 3,
    assignedExternalSkillCount: 3,
    approvedInternalSkillCount: 0,
    assignedInternalSkillCount: 0,
    candidates,
  });
}
