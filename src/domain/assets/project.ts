import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "@/domain/shared/schemas";

export const ProjectAssetCategorySchema = z.enum(["LOGO", "IMAGE", "REFERENCE", "DOCUMENT"]);
export const ProjectAssetSourceSchema = z.literal("USER_SUPPLIED");
export const ProjectAssetMediaTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
export const ProjectAssetStatusSchema = z.enum(["UPLOADING", "READY", "REJECTED", "REMOVED", "SUPERSEDED"]);
export const ProjectAssetCurrentnessSchema = z.enum(["CURRENT", "SUPERSEDED"]);

const ProjectAssetFieldsSchema = z.object({
  schemaVersion: z.literal(1),
  assetId: UuidSchema,
  projectId: UuidSchema,
  projectVersion: z.number().int().positive(),
  category: ProjectAssetCategorySchema,
  source: ProjectAssetSourceSchema,
  safeDisplayName: z.string().min(1).max(160),
  mediaType: ProjectAssetMediaTypeSchema,
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storageIdentity: z.string().regex(/^projects\/[0-9a-f-]+\/assets\/[0-9a-f-]+\/(?:png|jpg|webp|pdf)$/),
  status: ProjectAssetStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  version: z.number().int().positive(),
  currentness: ProjectAssetCurrentnessSchema,
  supersedesAssetId: UuidSchema.optional(),
  rejectionReason: z.string().max(240).optional(),
}).strict();

export const ProjectAssetSchema = ProjectAssetFieldsSchema.superRefine((asset, context) => {
  if (asset.status === "READY" && asset.currentness !== "CURRENT") context.addIssue({ code: "custom", path: ["currentness"], message: "A ready asset must be current." });
  if (asset.status === "REJECTED" && !asset.rejectionReason) context.addIssue({ code: "custom", path: ["rejectionReason"], message: "A rejected asset requires a safe rejection reason." });
});

export const ProjectAssetReferenceSchema = ProjectAssetFieldsSchema.pick({ assetId: true, projectId: true, projectVersion: true, category: true, source: true, safeDisplayName: true, mediaType: true, byteSize: true, sha256: true, status: true, version: true, currentness: true });

export type ProjectAsset = z.infer<typeof ProjectAssetSchema>;
export type ProjectAssetReference = z.infer<typeof ProjectAssetReferenceSchema>;
export type ProjectAssetCategory = z.infer<typeof ProjectAssetCategorySchema>;
