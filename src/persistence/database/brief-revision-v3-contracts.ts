import { z } from "zod";
import { UuidSchema, ProjectVersionSchema, IsoDateTimeSchema } from "@/domain/shared/schemas";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { canonicalBriefChecksum, normalizeCanonicalBrief } from "@/domain/requirements/v3/normalize";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";

export const BRIEF_V3_DOCUMENT_TYPE = "brief-v3" as const;
export const BRIEF_V3_DOCUMENT_SCHEMA_VERSION = 3 as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const BriefV3DocumentSchema = z.object({
  schemaVersion: z.literal(BRIEF_V3_DOCUMENT_SCHEMA_VERSION),
  documentType: z.literal(BRIEF_V3_DOCUMENT_TYPE),
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  brief: CanonicalBriefV3Schema,
  briefChecksum: Sha256Schema,
}).strict().superRefine((document, context) => {
  if (canonicalBriefChecksum(document.brief) !== document.briefChecksum) context.addIssue({ code: "custom", path: ["briefChecksum"], message: "Brief checksum does not match canonical V3 state." });
});

export type BriefV3Document = z.infer<typeof BriefV3DocumentSchema>;

export function canonicalBriefChecksumForDocument(document: unknown): string {
  const v3 = BriefV3DocumentSchema.safeParse(document);
  return canonicalBriefChecksum(v3.success ? v3.data.brief : migrateLegacyBriefToCanonicalBriefV3(document));
}

export function createBriefV3Document(input: { projectId: string; projectVersion: number; brief: CanonicalBriefV3; createdAt: string; updatedAt: string }): BriefV3Document {
  const brief = normalizeCanonicalBrief(input.brief);
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
