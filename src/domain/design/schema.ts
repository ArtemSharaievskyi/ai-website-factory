import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema, UuidSchema } from "../shared/schemas";

export const DesignDirectionSchema = z.object({ id: UuidSchema, label: NonEmptyStringSchema, concept: NonEmptyStringSchema, rationale: NonEmptyStringSchema, mood: NonEmptyStringSchema, colorStrategy: NonEmptyStringSchema, typographyStrategy: NonEmptyStringSchema, layoutStrategy: NonEmptyStringSchema, heroStrategy: NonEmptyStringSchema, sectionRhythm: NonEmptyStringSchema, componentCharacter: NonEmptyStringSchema, imageArtDirection: NonEmptyStringSchema, motionPolicy: NonEmptyStringSchema, responsivePrinciples: z.array(NonEmptyStringSchema), antiTemplateRules: z.array(NonEmptyStringSchema), advantages: z.array(NonEmptyStringSchema), risks: z.array(NonEmptyStringSchema), requirementReferences: z.array(UuidSchema) }).strict();
export const DesignDirectionSetSchema = DocumentBaseSchema.extend({ documentType: z.literal("design-directions"), setId: UuidSchema, directions: z.array(DesignDirectionSchema).length(3), generatedAt: IsoDateTimeSchema, generatedBy: NonEmptyStringSchema, readyForSelection: z.boolean() }).strict().superRefine((value, context) => {
  if (new Set(value.directions.map((direction) => direction.id)).size !== 3) context.addIssue({ code: "custom", path: ["directions"], message: "Directions must have unique IDs" });
});
export const SelectedDesignSchema = DocumentBaseSchema.extend({ documentType: z.literal("selected-design"), directionSetId: UuidSchema, selectedDirectionId: UuidSchema, selectedAt: IsoDateTimeSchema, selectedBy: NonEmptyStringSchema, selectionNotes: z.string(), selectedDirectionChecksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type DesignDirection = z.infer<typeof DesignDirectionSchema>;
export type DesignDirectionSet = z.infer<typeof DesignDirectionSetSchema>;
export type SelectedDesign = z.infer<typeof SelectedDesignSchema>;
