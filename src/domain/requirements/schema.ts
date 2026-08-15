import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, LocaleSchema, NonEmptyStringSchema, UserValueSchema } from "../shared/schemas";
import { LanguageResolutionSchema, OperatorLanguageSchema } from "../language/schema";
import { BriefV2FieldsSchema } from "./brief";

export const ClarificationCategorySchema = z.enum(["business", "audience", "pages", "functionality", "content", "contact", "legal", "design", "brand", "images", "authentication", "forms", "email", "database", "storage", "administration", "GitHub", "languages", "localization", "constraints"]);
export const AnswerStatusSchema = z.enum(["answered", "not-applicable", "deferred", "unresolved"]);
/** Host-owned clarification identity. This accepts the persisted UUID format without treating it as a project ID. */
export const ClarificationQuestionIdSchema = z.string().uuid();
export type ClarificationQuestionId = z.infer<typeof ClarificationQuestionIdSchema>;
export const ClarificationQuestionSchema = z.object({ id: ClarificationQuestionIdSchema, category: ClarificationCategorySchema, question: NonEmptyStringSchema, reason: NonEmptyStringSchema, required: z.boolean(), blocking: z.boolean(), askedAt: IsoDateTimeSchema, answerStatus: AnswerStatusSchema, requirementKey: NonEmptyStringSchema.optional(), fingerprint: NonEmptyStringSchema.optional(), evidence: z.array(NonEmptyStringSchema).optional() }).strict();
export const ClarificationAnswerSchema = z.object({ questionId: ClarificationQuestionIdSchema, status: AnswerStatusSchema, answer: z.string().optional(), answeredAt: IsoDateTimeSchema, answeredBy: NonEmptyStringSchema }).strict().superRefine((value, context) => {
  if (value.status === "answered" && !value.answer?.trim()) context.addIssue({ code: "custom", path: ["answer"], message: "Answered questions require an answer" });
});
export const ClarificationSupersededQuestionSchema = z.object({ question: ClarificationQuestionSchema, supersededAt: IsoDateTimeSchema, reason: NonEmptyStringSchema }).strict();
export const ClarificationSessionSchema = DocumentBaseSchema.extend({ documentType: z.literal("clarification-log"), clarificationPolicyVersion: z.number().int().positive().optional(), clarificationVersion: z.number().int().positive().optional(), operatorLanguage: OperatorLanguageSchema.optional(), languageResolution: LanguageResolutionSchema.optional(), questions: z.array(ClarificationQuestionSchema), answers: z.array(ClarificationAnswerSchema), supersededQuestions: z.array(ClarificationSupersededQuestionSchema).optional() }).strict();

const DecisionSchema = z.enum(["no-authentication-guest-first", "authentication-required", "pending"]);
const ImageSourceSchema = z.enum(["ai-generated", "user-supplied", "ai-plus-user-supplied", "placeholders", "custom", "pending"]);
export const RequirementSpecificationSchema = DocumentBaseSchema.extend({
  documentType: z.literal("requirements"),
  projectSummary: NonEmptyStringSchema,
  protectedFunctionalityRequired: z.boolean(),
  imagesRequired: z.boolean(),
  businessGoals: z.array(NonEmptyStringSchema),
  targetAudiences: z.array(NonEmptyStringSchema),
  pages: z.array(z.object({ slug: NonEmptyStringSchema, purpose: NonEmptyStringSchema }).strict()),
  userRoles: z.array(NonEmptyStringSchema),
  features: z.array(NonEmptyStringSchema),
  forms: z.array(NonEmptyStringSchema),
  contentRequirements: z.array(NonEmptyStringSchema),
  backendRequirements: z.array(NonEmptyStringSchema),
  supabaseRequirements: z.array(NonEmptyStringSchema),
  authenticationDecision: DecisionSchema,
  storageDecision: z.enum(["not-needed", "needed", "pending"]),
  emailDecision: z.enum(["not-needed", "needed", "pending"]),
  administrationDecision: z.enum(["not-needed", "needed", "pending"]),
  seoRequirements: z.array(NonEmptyStringSchema),
  operatorLanguage: OperatorLanguageSchema.optional(),
  localization: z.object({ locales: z.array(LocaleSchema), defaultLocale: LocaleSchema }).strict(),
  imageSourceDecision: ImageSourceSchema,
  suppliedBrandInformation: UserValueSchema,
  suppliedLogoLocation: UserValueSchema,
  technicalConstraints: z.array(NonEmptyStringSchema),
  explicitExclusions: z.array(NonEmptyStringSchema),
  userAcceptanceCriteria: z.array(NonEmptyStringSchema),
  unresolvedItems: z.array(z.object({ id: z.string().uuid(), description: NonEmptyStringSchema, blocking: z.boolean() }).strict()),
  approval: z.object({ approved: z.boolean(), approvedAt: IsoDateTimeSchema.optional(), approvedBy: NonEmptyStringSchema.optional(), approvedRequirementsChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  projectTitle: NonEmptyStringSchema.optional(), contactFacts: z.array(NonEmptyStringSchema).default([]), legalFacts: z.array(NonEmptyStringSchema).default([]), brandFacts: z.array(NonEmptyStringSchema).default([]), logoMetadata: z.array(NonEmptyStringSchema).default([]), imageSourcingNotes: z.array(NonEmptyStringSchema).default([]), evidence: z.array(z.object({ field: NonEmptyStringSchema, source: NonEmptyStringSchema, excerpt: NonEmptyStringSchema }).strict()).default([]), recommendations: z.array(NonEmptyStringSchema).default([]), briefRevisionInstructions: z.array(NonEmptyStringSchema).optional(), analysisMetadata: z.object({ provider: z.string(), originalPromptChecksum: z.string().regex(/^[a-f0-9]{64}$/), unsupportedAssumptions: z.array(z.string()), contradictionCount: z.number().int().nonnegative() }).strict().optional(), briefStatus: z.enum(["draft", "approved"]).default("draft"), briefVersion: z.number().int().positive().default(1), briefApprovalNote: z.string().optional(),
  briefSchemaVersion: z.literal(2).optional(), content: z.array(BriefV2FieldsSchema.shape.content.element).optional(), technical: z.array(BriefV2FieldsSchema.shape.technical.element).optional(), brandVisualRequirements: BriefV2FieldsSchema.shape.brandVisualRequirements.optional(), assetRequirements: BriefV2FieldsSchema.shape.assetRequirements.optional(), formBehaviorRequirements: BriefV2FieldsSchema.shape.formBehaviorRequirements.optional(), uxResponsiveRequirements: BriefV2FieldsSchema.shape.uxResponsiveRequirements.optional(), seoMetadata: BriefV2FieldsSchema.shape.seoMetadata.optional(), legalComplianceConstraints: BriefV2FieldsSchema.shape.legalComplianceConstraints.optional(), prohibitedRequirements: z.array(BriefV2FieldsSchema.shape.prohibitedRequirements.element).optional(), deferredIntegrations: z.array(BriefV2FieldsSchema.shape.deferredIntegrations.element).optional(), decisions: z.array(BriefV2FieldsSchema.shape.decisions.element).optional(),
}).strict();
/** A V2 Brief is explicit and fully structured; RequirementSpecificationSchema remains the legacy-compatible reader. */
export const ProjectBriefV2Schema = RequirementSpecificationSchema.extend(BriefV2FieldsSchema.shape).strict();
export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;
export type ClarificationAnswer = z.infer<typeof ClarificationAnswerSchema>;
export type ClarificationSession = z.infer<typeof ClarificationSessionSchema>;
export type RequirementSpecification = z.infer<typeof RequirementSpecificationSchema>;
export type ProjectBriefV2 = z.infer<typeof ProjectBriefV2Schema>;
export type { BriefV2Fields } from "./brief";
