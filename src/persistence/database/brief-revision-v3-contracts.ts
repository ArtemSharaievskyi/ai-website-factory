import { z } from "zod";
import { UuidSchema, ProjectVersionSchema, IsoDateTimeSchema, NonEmptyStringSchema } from "@/domain/shared/schemas";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { canonicalBriefChecksum, normalizeCanonicalBrief } from "@/domain/requirements/v3/normalize";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { assertCurrentV3RequirementNamespace } from "@/domain/requirements/v3/identity";

export const BRIEF_V3_DOCUMENT_TYPE = "brief-v3" as const;
export const BRIEF_V3_DOCUMENT_SCHEMA_VERSION = 3 as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** Host-owned lifecycle metadata; never part of the canonical V3 semantic Brief. */
export const BriefV3ApprovalSchema = z.object({
  approved: z.literal(true),
  approvedAt: IsoDateTimeSchema,
  approvedBy: NonEmptyStringSchema,
  approvedCanonicalChecksum: Sha256Schema,
  approvalNote: z.string().max(4000).optional(),
}).strict();
export type BriefV3Approval = z.infer<typeof BriefV3ApprovalSchema>;

export const BriefV3DocumentSchema = z.object({
  schemaVersion: z.literal(BRIEF_V3_DOCUMENT_SCHEMA_VERSION),
  documentType: z.literal(BRIEF_V3_DOCUMENT_TYPE),
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  brief: CanonicalBriefV3Schema,
  briefChecksum: Sha256Schema,
  approval: BriefV3ApprovalSchema.optional(),
}).strict().superRefine((document, context) => {
  if (canonicalBriefChecksum(document.brief) !== document.briefChecksum) context.addIssue({ code: "custom", path: ["briefChecksum"], message: "Brief checksum does not match canonical V3 state." });
  if (document.approval && document.approval.approvedCanonicalChecksum !== document.briefChecksum) context.addIssue({ code: "custom", path: ["approval", "approvedCanonicalChecksum"], message: "Brief approval is not bound to the current canonical V3 checksum." });
});

export type BriefV3Document = z.infer<typeof BriefV3DocumentSchema>;

export function canonicalBriefChecksumForDocument(document: unknown): string {
  const v3 = BriefV3DocumentSchema.safeParse(document);
  return canonicalBriefChecksum(v3.success ? v3.data.brief : migrateLegacyBriefToCanonicalBriefV3(document));
}

export function createBriefV3Document(input: { projectId: string; projectVersion: number; brief: CanonicalBriefV3; createdAt: string; updatedAt: string }): BriefV3Document {
  const brief = assertCurrentV3RequirementNamespace(normalizeCanonicalBrief(input.brief));
  return BriefV3DocumentSchema.parse({
    schemaVersion: BRIEF_V3_DOCUMENT_SCHEMA_VERSION,
    documentType: BRIEF_V3_DOCUMENT_TYPE,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    brief,
    briefChecksum: canonicalBriefChecksum(brief),
  });
}
