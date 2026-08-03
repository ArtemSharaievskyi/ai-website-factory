import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, LocaleSchema, NonEmptyStringSchema, UrlSchema, UserValueSchema } from "../shared/schemas";

export const ClarificationCategorySchema = z.enum(["business", "audience", "pages", "functionality", "content", "contact", "legal", "design", "brand", "images", "authentication", "forms", "email", "database", "storage", "administration", "GitHub", "constraints"]);
export const AnswerStatusSchema = z.enum(["answered", "not-applicable", "deferred", "unresolved"]);
export const ClarificationQuestionSchema = z.object({ id: z.string().uuid(), category: ClarificationCategorySchema, question: NonEmptyStringSchema, reason: NonEmptyStringSchema, required: z.boolean(), blocking: z.boolean(), askedAt: IsoDateTimeSchema, answerStatus: AnswerStatusSchema }).strict();
export const ClarificationAnswerSchema = z.object({ questionId: z.string().uuid(), status: AnswerStatusSchema, answer: z.string().optional(), answeredAt: IsoDateTimeSchema, answeredBy: NonEmptyStringSchema }).strict().superRefine((value, context) => {
  if (value.status === "answered" && !value.answer?.trim()) context.addIssue({ code: "custom", path: ["answer"], message: "Answered questions require an answer" });
});
export const ClarificationSessionSchema = DocumentBaseSchema.extend({ documentType: z.literal("clarification-log"), questions: z.array(ClarificationQuestionSchema), answers: z.array(ClarificationAnswerSchema) }).strict();

const DecisionSchema = z.enum(["no-authentication-guest-first", "authentication-required", "pending"]);
const ImageSourceSchema = z.enum(["ai-generated", "user-supplied", "ai-plus-user-supplied", "placeholders", "custom", "pending"]);
export const RequirementSpecificationSchema = DocumentBaseSchema.extend({
  documentType: z.literal("requirements"),
  projectSummary: NonEmptyStringSchema,
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
  localization: z.object({ locales: z.array(LocaleSchema), defaultLocale: LocaleSchema }).strict(),
  imageSourceDecision: ImageSourceSchema,
  suppliedBrandInformation: UserValueSchema,
  suppliedLogoLocation: UserValueSchema,
  technicalConstraints: z.array(NonEmptyStringSchema),
  explicitExclusions: z.array(NonEmptyStringSchema),
  userAcceptanceCriteria: z.array(NonEmptyStringSchema),
  unresolvedItems: z.array(z.object({ id: z.string().uuid(), description: NonEmptyStringSchema, blocking: z.boolean() }).strict()),
  approval: z.object({ approved: z.boolean(), approvedAt: IsoDateTimeSchema.optional(), approvedBy: NonEmptyStringSchema.optional(), approvedRequirementsChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
}).strict();
export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;
export type ClarificationAnswer = z.infer<typeof ClarificationAnswerSchema>;
export type ClarificationSession = z.infer<typeof ClarificationSessionSchema>;
export type RequirementSpecification = z.infer<typeof RequirementSpecificationSchema>;
