import { z } from "zod";
import { CandidateApprovalReadinessSchema } from "./evidence";
import {
  CurationReviewerSchema,
  CURATION_POLICY_VERSION,
} from "./contracts";
import {
  SkillLicenseIdentifierSchema,
  SkillLicensePolicyStatusSchema,
  SkillLicenseScopeSchema,
} from "@/skills/registry/contracts";

export const PortfolioSelectionDecisionSchema = z.enum([
  "SELECTED_FOR_PHASE_4D4_APPROVAL",
  "DEFERRED_FROM_INITIAL_PORTFOLIO",
  "NOT_SELECTED_INITIAL_PORTFOLIO",
]);
export type PortfolioSelectionDecision = z.infer<
  typeof PortfolioSelectionDecisionSchema
>;

export const LicenseEvidenceStatusSchema = z.enum([
  "PRESENT",
  "MISSING",
]);
export const LicenseScopeStatusSchema = z.enum([
  "LICENSE_SCOPE_ACCEPTED",
  "LICENSE_SCOPE_REVIEW_REQUIRED",
]);

export const InitialPortfolioDecisionRecordSchema = z
  .object({
    externalSkillId: z.string().min(1),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    targetAgent: CurationReviewerSchema,
    previousPortfolioDecision: z.literal("EXTERNAL_ADVANCE"),
    licenseId: SkillLicenseIdentifierSchema,
    licenseEvidenceStatus: LicenseEvidenceStatusSchema,
    licensePolicyStatus: SkillLicensePolicyStatusSchema,
    licenseScope: SkillLicenseScopeSchema,
    licenseScopeStatus: LicenseScopeStatusSchema,
    attributionObligations: z.array(z.literal("ATTRIBUTION_REQUIRED")),
    phase4d35Decision: PortfolioSelectionDecisionSchema,
    decisionReason: z.string().min(1),
    initialPortfolioRequired: z.boolean(),
    futureReconsiderationAllowed: z.boolean(),
    currentReadiness: CandidateApprovalReadinessSchema,
  })
  .strict();
export type InitialPortfolioDecisionRecord = z.infer<
  typeof InitialPortfolioDecisionRecordSchema
>;

export const InitialPortfolioCoverageRecordSchema = z
  .object({
    agentId: CurationReviewerSchema,
    existingApprovedSkillIds: z.array(z.string()),
    phase4d4ExternalSkillIds: z.array(z.string()),
    phase4d4InternalSkillIds: z.array(z.string()),
    deferredOptionalExternalSkillIds: z.array(z.string()),
    coverageStatus: z.literal("SUFFICIENT_INITIAL_COVERAGE"),
    coverageBasis: z.string().min(1),
  })
  .strict();
export type InitialPortfolioCoverageRecord = z.infer<
  typeof InitialPortfolioCoverageRecordSchema
>;

export const ExistingApprovedExternalRecordSchema = z
  .object({
    stagedSkillId: z.string().min(1),
    externalSkillId: z.string().min(1),
    targetAgent: CurationReviewerSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const InitialPortfolioLicenseDecisionArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    phase: z.literal("4D3.5"),
    generatedAt: z.string().datetime(),
    policyVersion: z.literal(CURATION_POLICY_VERSION),
    phase4d1SourceOfTruth: z.literal(
      "docs/admin/skill-curation/agent-skill-portfolio-plan-2026-08-09.json",
    ),
    phase4d2SourceOfTruth: z.literal(
      "docs/admin/skill-curation/external-advance-evidence-2026-08-09.json",
    ),
    internalEvidenceSourceOfTruth: z.literal(
      "docs/admin/skill-curation/internal-skill-evidence-2026-08-09.json",
    ),
    approvalCalled: z.literal(false),
    assignmentsChanged: z.literal(false),
    approvedExternalSkillCount: z.literal(3),
    assignedExternalSkillCount: z.literal(3),
    approvedInternalSkillCount: z.literal(0),
    assignedInternalSkillCount: z.literal(0),
    skillCountQuotaIntroduced: z.literal(false),
    candidates: z.array(InitialPortfolioDecisionRecordSchema).length(4),
    existingApprovedExternal: z.array(ExistingApprovedExternalRecordSchema).length(3),
    initialCoverage: z.array(InitialPortfolioCoverageRecordSchema).length(9),
    initialPortfolioGaps: z.array(z.string()),
    phase4d4ApprovalPreview: z
      .object({
        previewOnly: z.literal(true),
        externalSkillIds: z.array(z.string()).length(1),
        internalSkillIds: z.array(z.string()).length(13),
        totalArtifacts: z.literal(14),
      })
      .strict(),
  })
  .strict();
export type InitialPortfolioLicenseDecisionArtifact = z.infer<
  typeof InitialPortfolioLicenseDecisionArtifactSchema
>;

export function buildInitialPortfolioLicenseDecisionArtifact(input: {
  generatedAt: string;
  candidates: InitialPortfolioDecisionRecord[];
  existingApprovedExternal: z.input<typeof ExistingApprovedExternalRecordSchema>[];
  initialCoverage: InitialPortfolioCoverageRecord[];
  phase4d4ExternalSkillIds: string[];
  phase4d4InternalSkillIds: string[];
  initialPortfolioGaps?: string[];
}) {
  return InitialPortfolioLicenseDecisionArtifactSchema.parse({
    schemaVersion: 1,
    phase: "4D3.5",
    generatedAt: input.generatedAt,
    policyVersion: CURATION_POLICY_VERSION,
    phase4d1SourceOfTruth:
      "docs/admin/skill-curation/agent-skill-portfolio-plan-2026-08-09.json",
    phase4d2SourceOfTruth:
      "docs/admin/skill-curation/external-advance-evidence-2026-08-09.json",
    internalEvidenceSourceOfTruth:
      "docs/admin/skill-curation/internal-skill-evidence-2026-08-09.json",
    approvalCalled: false,
    assignmentsChanged: false,
    approvedExternalSkillCount: 3,
    assignedExternalSkillCount: 3,
    approvedInternalSkillCount: 0,
    assignedInternalSkillCount: 0,
    skillCountQuotaIntroduced: false,
    candidates: input.candidates,
    existingApprovedExternal: input.existingApprovedExternal,
    initialCoverage: input.initialCoverage,
    initialPortfolioGaps: input.initialPortfolioGaps ?? [],
    phase4d4ApprovalPreview: {
      previewOnly: true,
      externalSkillIds: input.phase4d4ExternalSkillIds,
      internalSkillIds: input.phase4d4InternalSkillIds,
      totalArtifacts:
        input.phase4d4ExternalSkillIds.length + input.phase4d4InternalSkillIds.length,
    },
  });
}
