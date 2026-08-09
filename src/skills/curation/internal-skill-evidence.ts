import { createHash } from "node:crypto";
import { z } from "zod";
import { CurationReviewerSchema, CURATION_POLICY_VERSION } from "./contracts";

export const InternalSkillIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const InternalSkillSourceTypeSchema = z.literal("internal");
export const InternalSkillReadinessSchema = z.enum([
  "APPROVAL_ELIGIBLE",
  "BLOCKED",
]);
export const InternalSkillStatusSchema = z.enum([
  "under-review",
  "approved",
]);
export const InternalSkillEvidenceRecordSchema = z
  .object({
    skillId: InternalSkillIdSchema,
    title: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    sourceType: InternalSkillSourceTypeSchema,
    provenance: z.literal("ai-website-factory-project-owned"),
    targets: z.array(CurationReviewerSchema).min(1),
    capabilities: z.array(z.string().min(1)).min(1),
    coverageKeys: z.array(z.string().min(1)).min(1),
    contentPath: z.string().regex(/^skills\/internal\/[a-z0-9-]+\/SKILL\.md$/),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    actualBytes: z.number().int().positive(),
    targetContextRange: z.string().min(1),
    purposeStatus: z.literal("COMPLETE"),
    procedureStatus: z.literal("COMPLETE"),
    securityStatus: z.literal("PASS"),
    authorityStatus: z.literal("PASS"),
    overlapStatus: z.literal("JUSTIFIED"),
    conflictStatus: z.literal("PASS"),
    semanticReviewStatus: z.literal("NOT_USED_DETERMINISTIC_SUFFICIENT"),
    approvalReadiness: InternalSkillReadinessSchema,
    blockers: z.array(z.string().min(1)),
    stagedSkillId: InternalSkillIdSchema,
    stagedStatus: InternalSkillStatusSchema,
    licenseStrategy: z.literal("internal-project-owned-no-third-party-license-assertion"),
    evidencePolicyVersion: z.literal(CURATION_POLICY_VERSION),
    reviewEvidence: z
      .object({
        parser: z
          .object({
            purpose: z.literal("resolved"),
            steps: z.literal("resolved"),
          })
          .strict(),
        deterministicChecks: z.array(z.string().min(1)).min(1),
        authorityChecks: z.array(z.string().min(1)).min(1),
      })
      .strict(),
  })
  .strict();
export type InternalSkillEvidenceRecord = z.infer<
  typeof InternalSkillEvidenceRecordSchema
>;

export const InternalSkillOverlapAuditSchema = z
  .object({
    left: InternalSkillIdSchema,
    right: z.string().min(1),
    status: z.literal("JUSTIFIED"),
    note: z.string().min(1),
  })
  .strict();

export const InternalSkillEvidenceArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    phase: z.literal("4D3"),
    specImplementationNote: z.literal(
      "Phase 4D1 version 0.1.0 retained as history; Phase 4D3 authored artifacts use initial version 1.0.0.",
    ),
    generatedAt: z.string().datetime(),
    sourceOfTruth: z.literal("docs/admin/skill-curation/agent-skill-portfolio-plan-2026-08-09.json"),
    authoredInternalSkillCount: z.literal(13),
    approvedInternalSkillCount: z.literal(0),
    assignedInternalSkillCount: z.literal(0),
    approvedExternalSkillCount: z.literal(3),
    assignedExternalSkillCount: z.literal(3),
    approvalCalled: z.literal(false),
    assignmentsChanged: z.literal(false),
    semanticReviewUsed: z.literal(false),
    networkCalls: z.literal(0),
    candidates: z.array(InternalSkillEvidenceRecordSchema).length(13),
    overlapAudit: z.array(InternalSkillOverlapAuditSchema),
    conflictAudit: z.array(
      z
        .object({
          skillId: InternalSkillIdSchema,
          status: z.literal("PASS"),
          note: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type InternalSkillEvidenceArtifact = z.infer<
  typeof InternalSkillEvidenceArtifactSchema
>;

export function canonicalInternalSkillChecksum(
  skillId: string,
  version: string,
  normalizedContent: string,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        descriptor: {
          sourceType: "internal",
          source: "ai-website-factory",
          skillId,
          version,
        },
        files: [{ path: "SKILL.md", contents: normalizedContent }],
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildInternalSkillEvidenceArtifact(
  candidates: InternalSkillEvidenceRecord[],
  overlapAudit: z.input<typeof InternalSkillOverlapAuditSchema>[],
  conflictAudit: z.input<
    typeof InternalSkillEvidenceArtifactSchema
  >["conflictAudit"],
  generatedAt: string,
) {
  return InternalSkillEvidenceArtifactSchema.parse({
    schemaVersion: 1,
    phase: "4D3",
    specImplementationNote:
      "Phase 4D1 version 0.1.0 retained as history; Phase 4D3 authored artifacts use initial version 1.0.0.",
    generatedAt,
    sourceOfTruth:
      "docs/admin/skill-curation/agent-skill-portfolio-plan-2026-08-09.json",
    authoredInternalSkillCount: 13,
    approvedInternalSkillCount: 0,
    assignedInternalSkillCount: 0,
    approvedExternalSkillCount: 3,
    assignedExternalSkillCount: 3,
    approvalCalled: false,
    assignmentsChanged: false,
    semanticReviewUsed: false,
    networkCalls: 0,
    candidates,
    overlapAudit,
    conflictAudit,
  });
}
