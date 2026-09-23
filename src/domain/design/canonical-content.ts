import { z } from "zod";
import { CanonicalBriefV3Schema, CustomerUxDirectionSchema, FormBehaviorStateSchema, RequirementCategorySchema, type CanonicalBriefV3, type CanonicalRequirement } from "@/domain/requirements/v3/schema";
import { NonEmptyStringSchema } from "@/domain/shared/schemas";

const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SourceRefSchema = NonEmptyStringSchema.max(200);

export const DesignCanonicalRequirementRefSchema = z.object({
  id: NonEmptyStringSchema.max(240),
  label: NonEmptyStringSchema.max(4000),
  category: RequirementCategorySchema,
  sourceRefs: z.array(SourceRefSchema).min(1),
}).strict();
export type DesignCanonicalRequirementRef = z.infer<typeof DesignCanonicalRequirementRefSchema>;

export const DesignCanonicalRouteSchema = z.object({
  id: NonEmptyStringSchema.max(240),
  path: NonEmptyStringSchema.max(160),
  pageType: z.enum(["landing", "content", "form", "dashboard", "auth", "legal", "application"]),
  titlePurpose: NonEmptyStringSchema,
  formDependencies: z.array(NonEmptyStringSchema),
  navigationVisible: z.boolean(),
}).strict();
export type DesignCanonicalRoute = z.infer<typeof DesignCanonicalRouteSchema>;

export const DesignCanonicalPageResponsibilitySchema = z.object({
  id: NonEmptyStringSchema.max(240),
  routeId: NonEmptyStringSchema.max(240),
  purpose: NonEmptyStringSchema,
  contentBlocks: z.array(NonEmptyStringSchema),
  functionalComponents: z.array(NonEmptyStringSchema),
  forms: z.array(NonEmptyStringSchema),
}).strict();
export type DesignCanonicalPageResponsibility = z.infer<typeof DesignCanonicalPageResponsibilitySchema>;

const DesignCanonicalNavigationSchema = z.object({
  primary: z.array(NonEmptyStringSchema),
  secondary: z.array(NonEmptyStringSchema),
  footer: z.array(NonEmptyStringSchema),
  contextual: z.array(NonEmptyStringSchema),
  protected: z.array(NonEmptyStringSchema),
  mobileBehavior: NonEmptyStringSchema,
  ctaPlacementIntent: z.array(NonEmptyStringSchema),
  routeReferences: z.array(NonEmptyStringSchema),
}).strict();

const DesignCanonicalProductScopeSchema = z.object({
  purpose: NonEmptyStringSchema,
  primaryOutcomes: z.array(NonEmptyStringSchema),
  outOfScopeCapabilities: z.array(NonEmptyStringSchema),
  userRoles: z.array(NonEmptyStringSchema),
  majorWorkflows: z.array(NonEmptyStringSchema),
  constraints: z.array(NonEmptyStringSchema),
}).strict();

const DesignCanonicalUserFlowSchema = z.object({
  id: NonEmptyStringSchema,
  actor: NonEmptyStringSchema,
  trigger: NonEmptyStringSchema,
  startRoute: NonEmptyStringSchema,
  successOutcome: NonEmptyStringSchema,
  failureOutcomes: z.array(NonEmptyStringSchema),
  formRequirements: z.array(NonEmptyStringSchema),
}).strict();

const DesignCanonicalContentPlanSchema = z.object({
  approvedGeneratedCopy: z.array(z.object({ location: NonEmptyStringSchema, copy: NonEmptyStringSchema, approved: z.boolean() }).strict()),
  missingFactualContent: z.array(NonEmptyStringSchema),
  legalContentRequiringConfirmation: z.array(NonEmptyStringSchema),
  approvedPlaceholders: z.array(NonEmptyStringSchema),
  suppliedContentNotes: z.array(z.unknown()),
}).strict();

const DesignCanonicalFormSummarySchema = z.object({
  id: NonEmptyStringSchema.max(240),
  route: NonEmptyStringSchema,
  purpose: NonEmptyStringSchema,
  fields: z.array(z.object({ id: NonEmptyStringSchema, label: NonEmptyStringSchema, type: NonEmptyStringSchema, required: z.boolean(), validation: z.array(NonEmptyStringSchema) }).strict()),
  businessValidation: z.array(NonEmptyStringSchema),
  consentRequirements: z.array(NonEmptyStringSchema),
  submissionMechanism: z.enum(["client-only", "server-action", "route-handler", "pending-decision"]),
  databaseWrite: NonEmptyStringSchema,
  emailBehavior: NonEmptyStringSchema,
  successState: NonEmptyStringSchema,
  errorState: NonEmptyStringSchema,
  rateLimitRequired: z.boolean(),
  spamProtectionRequired: z.boolean(),
}).strict();

const DesignCanonicalPlannedAssetSchema = z.object({
  id: z.string().uuid(),
  purpose: NonEmptyStringSchema,
  targetPage: NonEmptyStringSchema,
  sourceDecision: z.enum(["ai-generated", "user-supplied", "ai-plus-user-supplied", "placeholders", "custom"]),
  subject: NonEmptyStringSchema,
  styleDirection: NonEmptyStringSchema,
  aspectRatio: NonEmptyStringSchema,
  targetDimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  format: z.enum(["png", "jpg", "webp", "svg", "avif"]),
  consistencyGroup: NonEmptyStringSchema.optional(),
  altText: z.string(),
  generationStatus: z.enum(["planned", "pending-approval", "approved", "generated", "rejected"]),
  userApprovalRequired: z.boolean(),
  isLogo: z.boolean(),
}).strict();

const DesignCanonicalArchitectureSchema = z.object({
  applicationProfile: z.enum(["marketing-site", "business-site", "web-application"]),
  packageManager: z.literal("npm"),
  routes: z.array(z.object({ path: NonEmptyStringSchema, responsibility: NonEmptyStringSchema }).strict()),
  componentBoundaries: z.array(NonEmptyStringSchema),
  componentDecisions: z.array(z.object({ area: NonEmptyStringSchema, serverOrClient: z.enum(["server", "client"]), rationale: NonEmptyStringSchema }).strict()),
  serverActions: z.array(NonEmptyStringSchema),
  routeHandlers: z.array(NonEmptyStringSchema),
  backendPriority: z.array(z.enum(["server-actions", "route-handlers", "supabase-services"])),
  supabaseDatabaseRequirements: z.array(NonEmptyStringSchema),
  schemaPlan: z.array(NonEmptyStringSchema),
  rlsRequirements: z.array(NonEmptyStringSchema),
  authenticationPlan: NonEmptyStringSchema,
  storagePlan: NonEmptyStringSchema,
  emailPlan: NonEmptyStringSchema,
  environmentVariables: z.array(z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]*$/), required: z.boolean(), public: z.boolean() }).strict()),
  dependencies: z.array(z.object({ name: NonEmptyStringSchema, purpose: NonEmptyStringSchema }).strict()),
  npmScripts: z.record(z.string(), NonEmptyStringSchema),
  testStrategy: z.array(NonEmptyStringSchema),
  securityControls: z.array(NonEmptyStringSchema),
  rejectedInfrastructure: z.array(NonEmptyStringSchema),
}).strict();

export const DesignCanonicalContentSchema = z.object({
  schemaVersion: z.literal(1),
  briefChecksum: ChecksumSchema,
  planningChecksum: ChecksumSchema,
  architectureChecksum: ChecksumSchema,
  businessIdentity: z.object({
    title: z.string().trim().max(300).nullable(),
    summary: NonEmptyStringSchema.max(6000),
    locales: z.array(NonEmptyStringSchema),
    defaultLocale: NonEmptyStringSchema,
    suppliedInformation: z.string().trim().max(2000).nullable(),
    suppliedLogoDescription: z.string().trim().max(2000).nullable(),
  }).strict(),
  customerUxDirection: CustomerUxDirectionSchema.optional(),
  services: z.array(DesignCanonicalRequirementRefSchema),
  businessGoals: z.array(DesignCanonicalRequirementRefSchema),
  contactFacts: z.array(DesignCanonicalRequirementRefSchema),
  legalRequirements: z.array(DesignCanonicalRequirementRefSchema),
  exclusions: z.array(DesignCanonicalRequirementRefSchema),
  otherRequirements: z.array(DesignCanonicalRequirementRefSchema),
  productScope: DesignCanonicalProductScopeSchema,
  navigation: DesignCanonicalNavigationSchema,
  userFlows: z.array(DesignCanonicalUserFlowSchema),
  contentPlan: DesignCanonicalContentPlanSchema,
  routes: z.array(DesignCanonicalRouteSchema),
  pageResponsibilities: z.array(DesignCanonicalPageResponsibilitySchema),
  legalPageRouteIds: z.array(NonEmptyStringSchema.max(240)),
  legalPolicy: z.object({ placeholderPolicy: NonEmptyStringSchema, inventedFactsPolicy: NonEmptyStringSchema }).strict(),
  formPolicy: FormBehaviorStateSchema,
  forms: z.array(DesignCanonicalFormSummarySchema),
  imageSourceStrategy: z.enum(["NONE", "AI_GENERATED", "USER_SUPPLIED", "USER_AND_AI", "PLACEHOLDERS", "CUSTOM", "UNRESOLVED"]),
  assets: z.array(z.object({ reference: NonEmptyStringSchema.max(200), role: z.enum(["logo", "brand-reference", "photography", "illustration", "document", "other"]), usage: NonEmptyStringSchema.max(2000), replacementPolicy: z.enum(["FORBIDDEN", "ALLOWED", "UNRESOLVED"]) }).strict()),
  plannedAssets: z.array(DesignCanonicalPlannedAssetSchema),
  architecture: DesignCanonicalArchitectureSchema,
  unresolved: z.array(z.object({ target: NonEmptyStringSchema.max(300), reason: NonEmptyStringSchema.max(2000), sourceRefs: z.array(SourceRefSchema).min(1), blockingStages: z.array(NonEmptyStringSchema.max(80)).optional() }).strict()),
  contentChecksum: ChecksumSchema,
}).strict();
export type DesignCanonicalContent = z.infer<typeof DesignCanonicalContentSchema>;

export const canonicalRequirementRef = (requirement: CanonicalRequirement): DesignCanonicalRequirementRef => ({
  id: requirement.id,
  label: requirement.statement,
  category: requirement.category,
  sourceRefs: requirement.sourceRefs,
});

export function assertCanonicalBrief(value: unknown): CanonicalBriefV3 {
  return CanonicalBriefV3Schema.parse(value);
}
