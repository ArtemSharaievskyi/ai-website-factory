import { z } from "zod";
import { DocumentBaseSchema, NonEmptyStringSchema, RelativePathSchema } from "../shared/schemas";

export const AssetManifestEntrySchema = z.object({ id: z.string().uuid(), purpose: NonEmptyStringSchema, targetPage: NonEmptyStringSchema, sourceDecision: z.enum(["ai-generated", "user-supplied", "ai-plus-user-supplied", "placeholders", "custom"]), subject: NonEmptyStringSchema, styleDirection: NonEmptyStringSchema, aspectRatio: NonEmptyStringSchema, targetDimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(), format: z.enum(["png", "jpg", "webp", "svg", "avif"]), filename: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/), relativeOutputPath: RelativePathSchema, consistencyGroup: NonEmptyStringSchema.optional(), altText: z.string(), generationStatus: z.enum(["planned", "pending-approval", "approved", "generated", "rejected"]), userApprovalRequired: z.boolean(), isLogo: z.boolean() }).strict().superRefine((value, context) => {
  if (value.isLogo && value.sourceDecision !== "user-supplied") context.addIssue({ code: "custom", path: ["sourceDecision"], message: "Logos must be user-supplied" });
});
export const AssetManifestSchema = DocumentBaseSchema.extend({ documentType: z.literal("asset-manifest"), entries: z.array(AssetManifestEntrySchema) }).strict();
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
