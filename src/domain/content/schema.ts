import { z } from "zod";
import { DocumentBaseSchema, NonEmptyStringSchema, UserValueSchema } from "../shared/schemas";

export const ContentPlanSchema = DocumentBaseSchema.extend({ documentType: z.literal("content-plan"), userProvidedFacts: z.array(NonEmptyStringSchema), approvedGeneratedCopy: z.array(z.object({ location: NonEmptyStringSchema, copy: NonEmptyStringSchema, approved: z.boolean() }).strict()), missingFactualContent: z.array(NonEmptyStringSchema), legalContentRequiringConfirmation: z.array(NonEmptyStringSchema), approvedPlaceholders: z.array(NonEmptyStringSchema), suppliedContentNotes: z.array(UserValueSchema) }).strict();
export type ContentPlan = z.infer<typeof ContentPlanSchema>;
