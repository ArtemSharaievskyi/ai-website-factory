import { z } from "zod";

export const SkillStatusSchema = z.enum([
  "staged",
  "under-review",
  "approved",
  "rejected",
  "revoked",
  "superseded",
]);
export const SkillRiskSchema = z.enum(["low", "medium", "high", "critical"]);
export const SkillSourceTypeSchema = z.enum([
  "skills-sh",
  "git-repository",
  "local-manual-import",
]);
export const SkillRoleSchema = z.enum([
  "lead",
  "planner-architect",
  "design",
  "implementation",
  "qa-release",
  "review",
]);
export const SkillTaskTypeSchema = z.enum([
  "clarify-requirements",
  "create-requirements-spec",
  "create-design-directions",
  "create-technical-architecture",
  "plan-content",
  "plan-assets",
  "implement-foundation",
  "implement-frontend",
  "implement-backend",
  "implement-database",
  "implement-integrations",
  "validate-code",
  "validate-security",
  "run-functional-tests",
  "prepare-release",
  "review-architecture",
  "review-contracts",
  "review-code-integration",
  "review-security",
  "review-test-quality",
]);
export const SkillFormatVersionSchema = z.literal(1);
export const SkillFileSchema = z
  .object({
    relativePath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().nonnegative(),
    kind: z.enum(["entry", "reference", "script", "template", "other"]),
    executable: z.boolean(),
  })
  .strict();
export const SkillManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    skillId: z.string().min(1),
    sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    files: z.array(SkillFileSchema),
    totalBytes: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
  })
  .strict();
export const SkillDefinitionSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    displayName: z.string().min(1),
    description: z.string(),
    version: z.string().min(1),
    formatVersion: SkillFormatVersionSchema,
    sourceType: SkillSourceTypeSchema,
    sourceRepository: z.string().optional(),
    sourceSubdirectory: z.string().optional(),
    sourceCommit: z.string().optional(),
    sourceTag: z.string().optional(),
    sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    license: z.string().optional(),
    importedAt: z.string().datetime(),
    reviewedAt: z.string().datetime().optional(),
    approvedAt: z.string().datetime().optional(),
    status: SkillStatusSchema,
    riskLevel: SkillRiskSchema,
    allowedRoles: z.array(SkillRoleSchema),
    allowedTaskTypes: z.array(SkillTaskTypeSchema),
    requiredTools: z.array(z.string()),
    forbiddenTools: z.array(z.string()),
    entryFile: z.literal("SKILL.md"),
    referenceFiles: z.array(z.string()),
    scriptFiles: z.array(z.string()),
    templateFiles: z.array(z.string()),
    maxContextBytes: z.number().int().positive(),
    maxReferenceFilesPerLoad: z.number().int().positive(),
    approvalRecordId: z.string().optional(),
    reviewer: z.string().optional(),
    notes: z.string().optional(),
    manifest: SkillManifestSchema,
    summary: z.record(z.string(), z.unknown()).optional(),
    review: z.unknown().optional(),
    applicability: z
      .object({
        capability: z.string().min(1),
        taskType: SkillTaskTypeSchema,
        coverageKeys: z.array(z.string().min(1)),
        projectSurfaces: z.array(z.string().min(1)),
        conflictsWithSkillIds: z.array(z.string().min(1)),
        overlapsWithSkillIds: z.array(z.string().min(1)),
        priority: z.number().int(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
export const SkillLicenseIdentifierSchema = z.enum([
  "MIT",
  "Elastic-2.0",
  "CC-BY-4.0",
]);
export type SkillLicenseIdentifier = z.infer<
  typeof SkillLicenseIdentifierSchema
>;
export const SkillLicenseScopeSchema = z.enum([
  "repository",
  "repository-inherited-no-narrower-local-evidence",
  "path-specific",
  "unknown",
]);
export type SkillLicenseScope = z.infer<typeof SkillLicenseScopeSchema>;
export const SkillLicensePolicyStatusSchema = z.enum([
  "LICENSE_ALLOWED_FOR_FACTORY_USE",
  "LICENSE_POLICY_REVIEW_REQUIRED",
  "LICENSE_SCOPE_REVIEW_REQUIRED",
]);
export type SkillLicensePolicyStatus = z.infer<
  typeof SkillLicensePolicyStatusSchema
>;
export const SkillLicenseEvidenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    evidenceType: z.literal("CANONICAL_SOURCE_LICENSE"),
    externalSkillId: z.string().min(1),
    candidateChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRepository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    sourceRef: z.string().url(),
    assertedValue: SkillLicenseIdentifierSchema,
    licenseScope: SkillLicenseScopeSchema.default("repository"),
    licensePolicyStatus: SkillLicensePolicyStatusSchema.default(
      "LICENSE_ALLOWED_FOR_FACTORY_USE",
    ),
    attributionObligations: z
      .array(z.literal("ATTRIBUTION_REQUIRED"))
      .default([]),
    suppliedBy: z.literal("HUMAN"),
    recordedAt: z.string().datetime(),
    policyVersion: z.string().min(1),
  })
  .strict();
export type SkillLicenseEvidence = z.infer<typeof SkillLicenseEvidenceSchema>;
export const SkillApplicabilitySchema = z
  .object({
    capability: z.string().min(1),
    taskType: SkillTaskTypeSchema,
    coverageKeys: z.array(z.string().min(1)),
    projectSurfaces: z.array(z.string().min(1)),
    conflictsWithSkillIds: z.array(z.string().min(1)),
    overlapsWithSkillIds: z.array(z.string().min(1)),
    priority: z.number().int(),
  })
  .strict();
export type SkillApplicability = z.infer<typeof SkillApplicabilitySchema>;
export const SkillApprovalRecordSchema = z
  .object({
    id: z.string().min(1),
    skillId: z.string().min(1),
    sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    candidateChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    manifestChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    reviewedBy: z.string().min(1),
    reviewedAt: z.string().datetime(),
    decision: z.enum(["approved", "rejected", "needs-changes", "revoked"]),
    approvedVersion: z.string().optional(),
    approvedCommit: z.string().optional(),
    approvedFiles: z.array(z.string()),
    excludedFiles: z.array(z.string()),
    allowedRoles: z.array(SkillRoleSchema),
    allowedTaskTypes: z.array(SkillTaskTypeSchema),
    allowedTools: z.array(z.string()),
    deniedTools: z.array(z.string()),
    allowedCommandPatterns: z.array(z.string()),
    deniedCommandPatterns: z.array(z.string()),
    maxContextBytes: z.number().int().positive(),
    notes: z.string(),
    expiresAt: z.string().datetime().optional(),
    supersedesApprovalId: z.string().optional(),
    applicability: SkillApplicabilitySchema.optional(),
  })
  .strict();
export type SkillApprovalRecord = z.infer<typeof SkillApprovalRecordSchema>;
export const SkillSourceRecordSchema = z
  .object({
    sourceType: SkillSourceTypeSchema,
    repositoryUrl: z.string().url().optional(),
    owner: z.string().optional(),
    repository: z.string().optional(),
    subdirectory: z.string().optional(),
    commitSha: z.string().optional(),
    tag: z.string().optional(),
    importedAt: z.string().datetime(),
    fetchedBy: z
      .enum(["local-explicit-path", "prepared-archive", "future-downloader"])
      .default("local-explicit-path"),
    sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    fileManifestChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    licenseEvidence: z.string().optional(),
    originalSkillName: z.string().min(1),
    externalSkillId: z.string().optional(),
    canonicalSourceRef: z.string().url().optional(),
    retrievedContentChecksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    normalizedContentChecksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    licenseEvidenceRecord: SkillLicenseEvidenceSchema.optional(),
  })
  .strict();
export type SkillSourceRecord = z.infer<typeof SkillSourceRecordSchema>;
export const SkillMetadataEvidenceReferenceSchema = z
  .object({
    field: z.enum(["purpose", "steps"]),
    source: z.enum([
      "frontmatter-description",
      "purpose-section",
      "overview-section",
      "ordered-procedure",
      "sequenced-heading",
      "checklist",
      "review-process",
    ]),
    heading: z.string().max(160).optional(),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    fragmentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    summary: z.string().min(1).max(500),
  })
  .strict();
export const SkillMetadataEvidenceSchema = z
  .object({
    purpose: SkillMetadataEvidenceReferenceSchema.optional(),
    steps: z.array(SkillMetadataEvidenceReferenceSchema),
    unresolved: z.array(z.enum(["purpose", "steps"])),
  })
  .strict();
export type SkillMetadataEvidence = z.infer<typeof SkillMetadataEvidenceSchema>;
export const SkillCurationEvidenceSchema = z
  .object({
    license: SkillLicenseEvidenceSchema,
    metadata: SkillMetadataEvidenceSchema,
  })
  .strict();
export type SkillCurationEvidence = z.infer<typeof SkillCurationEvidenceSchema>;
export const SkillAuditEventSchema = z
  .object({
    id: z.string().min(1),
    skillId: z.string().min(1),
    sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    actor: z.string().min(1),
    timestamp: z.string().datetime(),
    action: z.enum([
      "import-staged",
      "review-started",
      "finding-recorded",
      "approval-requested",
      "approved",
      "rejected",
      "revoked",
      "superseded",
      "load-permitted",
      "load-denied",
      "integrity-failure",
      "evidence-recorded",
    ]),
    summary: z.string().max(500),
    approvalId: z.string().optional(),
    role: SkillRoleSchema.optional(),
    taskType: SkillTaskTypeSchema.optional(),
  })
  .strict();
export type SkillAuditEvent = z.infer<typeof SkillAuditEventSchema>;
export const SkillLoadRequestSchema = z
  .object({
    skillId: z.string().min(1),
    role: SkillRoleSchema,
    taskType: SkillTaskTypeSchema,
    allowedSkillIds: z.array(z.string().min(1)).optional(),
    requestedFiles: z.array(z.string()).optional().default([]),
    requestedSections: z.array(z.string()).optional().default([]),
    requestedTools: z.array(z.string()).optional().default([]),
    contextBudgetBytes: z.number().int().positive(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.allowedSkillIds?.includes("*"))
      context.addIssue({
        code: "custom",
        path: ["allowedSkillIds"],
        message: "Wildcard skill permissions are forbidden.",
      });
  });
export type SkillLoadRequest = z.input<typeof SkillLoadRequestSchema>;
