import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema, UuidSchema } from "@/domain/shared/schemas";
import { PlanningPackageSchema } from "./contracts";

const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const PlanningCorrectionHistoryEntrySchema = z.object({
  correctionId: UuidSchema,
  operationKey: NonEmptyStringSchema,
  projectId: UuidSchema,
  projectVersion: z.number().int().positive(),
  baseProjectRowVersion: z.number().int().nonnegative(),
  basePlanningRowVersion: z.number().int().nonnegative(),
  basePlanningSemanticChecksum: ChecksumSchema,
  basePlanningDocumentChecksum: ChecksumSchema,
  briefSemanticChecksum: ChecksumSchema,
  previousPlanningPackage: PlanningPackageSchema,
  nextPlanningSemanticChecksum: ChecksumSchema,
  nextPlanningDocumentChecksum: ChecksumSchema,
  correctionKinds: z.array(NonEmptyStringSchema).min(1),
  providerCalls: z.literal(0),
  appliedAt: IsoDateTimeSchema,
}).strict();

export const PlanningCorrectionHistorySchema = DocumentBaseSchema.extend({
  documentType: z.literal("planning-correction-history"),
  entries: z.array(PlanningCorrectionHistoryEntrySchema).max(32),
}).strict();

export type PlanningCorrectionHistory = z.infer<typeof PlanningCorrectionHistorySchema>;
export type PlanningCorrectionHistoryEntry = z.infer<typeof PlanningCorrectionHistoryEntrySchema>;
