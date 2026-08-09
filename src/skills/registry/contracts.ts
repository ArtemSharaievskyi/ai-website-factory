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
  })
  .strict();
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
export const SkillApprovalRecordSchema = z
  .object({
    id: z.string().min(1),
    skillId: z.string().min(1),
    sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
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
  })
  .strict();
export type SkillSourceRecord = z.infer<typeof SkillSourceRecordSchema>;
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
