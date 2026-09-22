import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "@/domain/shared/schemas";

export const ProjectAssetCategorySchema = z.enum(["LOGO", "IMAGE", "REFERENCE", "DOCUMENT"]);
export const ProjectAssetSourceSchema = z.enum(["USER_SUPPLIED", "AI_GENERATED"]);
export const ProjectAssetMediaTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
export const ProjectAssetStatusSchema = z.enum(["UPLOADING", "READY", "REJECTED", "REMOVED", "SUPERSEDED"]);
export const ProjectAssetCurrentnessSchema = z.enum(["CURRENT", "SUPERSEDED"]);
export const GeneratedAssetUsageSchema = z.object({ inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), totalTokens: z.number().int().nonnegative().optional(), cost: z.number().nonnegative().optional(), costStatus: z.enum(["REPORTED", "UNAVAILABLE"]) }).strict();
export const GeneratedAssetProvenanceSchema = z.object({ provider: z.literal("openai"), projectId: UuidSchema, projectVersion: z.number().int().positive(), assetPurpose: z.string().min(1).max(160), modelFamily: z.string().min(1).max(120), resolvedModel: z.string().min(1).max(160), requestId: z.string().min(1).max(160), promptVersion: z.string().min(1).max(120), requestedQuality: z.enum(["xhigh", "max"]), resolvedQuality: z.enum(["xhigh", "max"]), requestedMimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), actualMimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), requestedWidth: z.number().int().positive().optional(), requestedHeight: z.number().int().positive().optional(), actualWidth: z.number().int().positive(), actualHeight: z.number().int().positive(), byteSize: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), providerStatus: z.literal("completed"), retryCount: z.literal(0), usage: GeneratedAssetUsageSchema }).strict();

const ProjectAssetFieldsSchema = z.object({
  schemaVersion: z.literal(1),
  assetId: UuidSchema,
  projectId: UuidSchema,
  projectVersion: z.number().int().positive(),
  category: ProjectAssetCategorySchema,
  source: ProjectAssetSourceSchema,
  generationProvenance: GeneratedAssetProvenanceSchema.optional(),
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
  if (asset.source === "AI_GENERATED" && !asset.generationProvenance) context.addIssue({ code: "custom", path: ["generationProvenance"], message: "An AI-generated asset requires bounded generation provenance." });
  if (asset.source === "USER_SUPPLIED" && asset.generationProvenance) context.addIssue({ code: "custom", path: ["generationProvenance"], message: "User-supplied assets cannot carry AI generation provenance." });
});

export const ProjectAssetReferenceSchema = ProjectAssetFieldsSchema.pick({ assetId: true, projectId: true, projectVersion: true, category: true, source: true, generationProvenance: true, safeDisplayName: true, mediaType: true, byteSize: true, sha256: true, status: true, version: true, currentness: true });

export type ProjectAsset = z.infer<typeof ProjectAssetSchema>;
export type ProjectAssetReference = z.infer<typeof ProjectAssetReferenceSchema>;
export type ProjectAssetCategory = z.infer<typeof ProjectAssetCategorySchema>;
export type ProjectAssetSource = z.infer<typeof ProjectAssetSourceSchema>;
