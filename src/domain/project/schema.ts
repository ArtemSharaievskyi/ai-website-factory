import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema, ProjectSlugSchema, ProjectVersionSchema, UuidSchema } from "../shared/schemas";
import { ProjectOriginSchema } from "./provenance";
import { SiteLanguageDecisionSchema } from "@/domain/language/schema";

export const WorkflowStateSchema = z.enum(["DRAFT", "CLARIFYING", "AWAITING_BRIEF_APPROVAL", "AWAITING_PLANNING_GENERATION", "AWAITING_PLANNING_APPROVAL", "AWAITING_DESIGN_SELECTION", "ARCHITECTURE_REVIEW", "READY_FOR_IMPLEMENTATION", "CONTRACT_AUDIT", "IMPLEMENTING", "CODE_INTEGRATION_REVIEW", "SECURITY_REVIEW", "VALIDATING", "TEST_QUALITY_REVIEW", "REPAIRING", "PROJECT_READY", "FAILED"]);

export const FactoryProjectSchema = DocumentBaseSchema.extend({
  documentType: z.literal("factory-project"),
  id: UuidSchema,
  slug: ProjectSlugSchema,
  origin: ProjectOriginSchema.default("USER"),
  siteLanguage: SiteLanguageDecisionSchema.default("UNRESOLVED"),
  title: NonEmptyStringSchema.optional(),
  originalPrompt: z.string(),
  currentVersion: ProjectVersionSchema,
  workflowState: WorkflowStateSchema,
  implementationStartedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
}).strict().superRefine((project, context) => {
  const beforeImplementation = ["DRAFT", "CLARIFYING", "AWAITING_BRIEF_APPROVAL", "AWAITING_PLANNING_GENERATION", "AWAITING_PLANNING_APPROVAL", "AWAITING_DESIGN_SELECTION", "ARCHITECTURE_REVIEW", "READY_FOR_IMPLEMENTATION", "CONTRACT_AUDIT"].includes(project.workflowState);
  if (beforeImplementation && project.implementationStartedAt) context.addIssue({ code: "custom", path: ["implementationStartedAt"], message: "Implementation timestamp is not allowed before implementation" });
  if (project.workflowState === "PROJECT_READY" && !project.completedAt) context.addIssue({ code: "custom", path: ["completedAt"], message: "PROJECT_READY requires completedAt" });
  if (project.workflowState !== "PROJECT_READY" && project.completedAt) context.addIssue({ code: "custom", path: ["completedAt"], message: "completedAt is only allowed for PROJECT_READY" });
});

export type FactoryProject = z.infer<typeof FactoryProjectSchema>;
