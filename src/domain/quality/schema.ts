import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema } from "../shared/schemas";

export const QualityCheckNameSchema = z.enum(["npm-ci", "lint", "typecheck", "unit-tests", "build", "e2e", "npm-audit", "secret-scan", "Supabase-migrations", "Supabase-RLS", "forms", "database", "auth", "storage", "email", "Git", "GitHub"]);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const QualityCheckEvidenceSchema = z.object({ projectId: z.string().uuid(), projectVersion: z.number().int().positive(), taskGraphChecksum: HashSchema, sourceDocumentChecksums: z.record(z.string(), HashSchema), runtimeValidationRunId: z.string().uuid().optional(), qaRunId: z.string().uuid().optional(), sourceChecksum: HashSchema.optional(), validationPlanChecksum: HashSchema.optional() }).strict();
export const QualityCheckSchema = z.object({ name: QualityCheckNameSchema, status: z.enum(["pending", "running", "passed", "failed", "skipped"]), startedAt: IsoDateTimeSchema.optional(), completedAt: IsoDateTimeSchema.optional(), resultSummary: NonEmptyStringSchema.optional(), safeFailureCode: z.string().regex(/^[A-Z0-9_]+$/).optional(), attempt: z.number().int().nonnegative(), required: z.boolean(), command: NonEmptyStringSchema.optional(), exitCode: z.number().int().optional(), skippedReason: NonEmptyStringSchema.optional(), evidence: QualityCheckEvidenceSchema.optional() }).strict().superRefine((check, context) => { if (check.status === "skipped" && check.required && !check.skippedReason) context.addIssue({ code: "custom", path: ["skippedReason"], message: "Required skipped checks need an approved reason" }); });
export const QualityReportSchema = DocumentBaseSchema.extend({ documentType: z.literal("quality-report"), checks: z.array(QualityCheckSchema), knownErrors: z.array(NonEmptyStringSchema) }).strict();
export type QualityCheck = z.infer<typeof QualityCheckSchema>;
export type QualityReport = z.infer<typeof QualityReportSchema>;
