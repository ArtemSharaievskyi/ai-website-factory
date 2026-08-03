import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema, ProjectSlugSchema, ProjectVersionSchema, UuidSchema } from "../shared/schemas";

export const WorkflowStateSchema = z.enum(["DRAFT", "CLARIFYING", "AWAITING_BRIEF_APPROVAL", "AWAITING_DESIGN_SELECTION", "READY_FOR_IMPLEMENTATION", "IMPLEMENTING", "VALIDATING", "REPAIRING", "PROJECT_READY", "FAILED"]);

export const FactoryProjectSchema = DocumentBaseSchema.extend({
  documentType: z.literal("factory-project"),
  id: UuidSchema,
  slug: ProjectSlugSchema,
  title: NonEmptyStringSchema.optional(),
  originalPrompt: z.string(),
  currentVersion: ProjectVersionSchema,
  workflowState: WorkflowStateSchema,
  implementationStartedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
}).strict();

export type FactoryProject = z.infer<typeof FactoryProjectSchema>;
