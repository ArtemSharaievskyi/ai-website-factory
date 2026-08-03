import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema } from "../shared/schemas";
import { QualityReportSchema } from "../quality/schema";

export const ReleaseReportSchema = DocumentBaseSchema.extend({ documentType: z.literal("release-report"), versionLabel: z.string().regex(/^v[1-9]\d*$/), qualityReport: QualityReportSchema, knownErrors: z.array(NonEmptyStringSchema), ready: z.boolean(), releasedAt: IsoDateTimeSchema.optional(), releasedBy: NonEmptyStringSchema.optional() }).strict().superRefine((report, context) => {
  const invalidRequired = report.qualityReport.checks.some((check) => check.required && check.status !== "passed" && (check.status !== "skipped" || !check.skippedReason));
  if (report.ready && (invalidRequired || report.knownErrors.length > 0 || report.qualityReport.knownErrors.length > 0)) context.addIssue({ code: "custom", path: ["ready"], message: "Release cannot be ready while required checks are incomplete or known errors remain" });
});
export type ReleaseReport = z.infer<typeof ReleaseReportSchema>;
