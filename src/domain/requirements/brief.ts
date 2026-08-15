import { z } from "zod";
import { NonEmptyStringSchema, UuidSchema } from "@/domain/shared/schemas";

/** A bounded, typed requirement statement with source traceability. */
export const BriefRequirementEntrySchema = z.object({
  id: NonEmptyStringSchema.max(160),
  statement: NonEmptyStringSchema,
  sourceRefs: z.array(NonEmptyStringSchema).min(1),
}).strict();
export type BriefRequirementEntry = z.infer<typeof BriefRequirementEntrySchema>;

export const BriefBrandVisualRequirementsSchema = z.object({
  colorDirection: z.array(BriefRequirementEntrySchema),
  typographyDirection: z.array(BriefRequirementEntrySchema),
  spacingLayoutDirection: z.array(BriefRequirementEntrySchema),
  cardSurfaceStyling: z.array(BriefRequirementEntrySchema),
  iconDirection: z.array(BriefRequirementEntrySchema),
  imageryDirection: z.array(BriefRequirementEntrySchema),
  brandReferenceUsage: z.array(BriefRequirementEntrySchema),
  visualAntiPatterns: z.array(BriefRequirementEntrySchema),
}).strict();
export type BriefBrandVisualRequirements = z.infer<typeof BriefBrandVisualRequirementsSchema>;

const CanonicalAssetReferenceSchema = z.string().min(1).max(160).refine(
  (value) => !/[\\/]/.test(value),
  "Asset references must not expose storage paths.",
);

export const BriefAssetRequirementSchema = z.object({
  reference: CanonicalAssetReferenceSchema,
  role: z.enum(["logo", "brand-reference", "photography", "illustration", "document", "other"]),
  usage: NonEmptyStringSchema,
  replacementForbidden: z.boolean(),
  sourceRefs: z.array(NonEmptyStringSchema).min(1),
}).strict();
export type BriefAssetRequirement = z.infer<typeof BriefAssetRequirementSchema>;

export const BriefAssetRequirementsSchema = z.object({
  requiredAssets: z.array(BriefAssetRequirementSchema),
  additionalImagery: z.object({
    allowed: z.boolean(),
    sourcingPolicy: z.array(BriefRequirementEntrySchema),
    realisticProfessional: z.boolean(),
    avoidArtificialLook: z.boolean(),
  }).strict(),
}).strict();
export type BriefAssetRequirements = z.infer<typeof BriefAssetRequirementsSchema>;

export const BriefFormBehaviorRequirementsSchema = z.object({
  formPresent: z.boolean(),
  validation: z.enum(["ACTIVE", "NOT_REQUIRED"]),
  successUx: z.enum(["SIMULATED", "REAL", "NONE"]),
  dataTransmission: z.enum(["NONE", "EMAIL", "API", "OTHER"]),
  persistence: z.enum(["NONE", "DATABASE", "OTHER"]),
  thirdParty: z.enum(["NONE", "APPROVED_PROVIDER", "OTHER"]),
  privacyCheckbox: z.enum(["REQUIRED", "OPTIONAL", "NOT_APPLICABLE"]),
  interactionStates: z.array(BriefRequirementEntrySchema),
}).strict();
export type BriefFormBehaviorRequirements = z.infer<typeof BriefFormBehaviorRequirementsSchema>;

export const BriefUxResponsiveRequirementsSchema = z.object({
  mobileFirst: z.boolean(),
  responsiveBehavior: z.array(BriefRequirementEntrySchema),
  stickyMobileCta: z.boolean(),
  smoothScroll: z.boolean(),
  reducedMotion: z.boolean(),
  interactionRequirements: z.array(BriefRequirementEntrySchema),
}).strict();
export type BriefUxResponsiveRequirements = z.infer<typeof BriefUxResponsiveRequirementsSchema>;

export const BriefSeoRequirementsSchema = z.object({
  primaryKeywords: z.array(NonEmptyStringSchema),
  exactTitle: NonEmptyStringSchema.optional(),
  exactMetaDescription: NonEmptyStringSchema.optional(),
  locationTargeting: z.array(BriefRequirementEntrySchema),
  pageMetadata: z.array(z.object({
    route: NonEmptyStringSchema,
    title: NonEmptyStringSchema.optional(),
    metaDescription: NonEmptyStringSchema.optional(),
    keywords: z.array(NonEmptyStringSchema),
    sourceRefs: z.array(NonEmptyStringSchema).min(1),
  }).strict()),
}).strict();
export type BriefSeoRequirements = z.infer<typeof BriefSeoRequirementsSchema>;

export const BriefLegalComplianceRequirementsSchema = z.object({
  constraints: z.array(BriefRequirementEntrySchema),
  placeholderPolicy: z.enum(["USE_EXPLICIT_PLACEHOLDERS", "NO_PLACEHOLDERS", "UNRESOLVED"]),
  inventedFactsForbidden: z.boolean(),
}).strict();
export type BriefLegalComplianceRequirements = z.infer<typeof BriefLegalComplianceRequirementsSchema>;

export const BriefDeferredIntegrationSchema = z.object({
  integration: NonEmptyStringSchema,
  status: z.enum(["DEFERRED", "APPROVED", "PROHIBITED"]),
  rationale: NonEmptyStringSchema,
  sourceRefs: z.array(NonEmptyStringSchema).min(1),
}).strict();
export type BriefDeferredIntegration = z.infer<typeof BriefDeferredIntegrationSchema>;

export const BriefDecisionSchema = z.object({
  key: NonEmptyStringSchema,
  value: NonEmptyStringSchema,
  status: z.enum(["CONFIRMED", "DEFERRED", "UNRESOLVED"]),
  sourceRefs: z.array(NonEmptyStringSchema).min(1),
}).strict();
export type BriefDecision = z.infer<typeof BriefDecisionSchema>;

export const BriefV2FieldsSchema = z.object({
  briefSchemaVersion: z.literal(2),
  content: z.array(BriefRequirementEntrySchema),
  technical: z.array(BriefRequirementEntrySchema),
  brandVisualRequirements: BriefBrandVisualRequirementsSchema,
  assetRequirements: BriefAssetRequirementsSchema,
  formBehaviorRequirements: BriefFormBehaviorRequirementsSchema,
  uxResponsiveRequirements: BriefUxResponsiveRequirementsSchema,
  seoMetadata: BriefSeoRequirementsSchema,
  legalComplianceConstraints: BriefLegalComplianceRequirementsSchema,
  prohibitedRequirements: z.array(BriefRequirementEntrySchema),
  deferredIntegrations: z.array(BriefDeferredIntegrationSchema),
  decisions: z.array(BriefDecisionSchema),
}).strict();
export type BriefV2Fields = z.infer<typeof BriefV2FieldsSchema>;

export const emptyBriefV2Fields = (): BriefV2Fields => ({
  briefSchemaVersion: 2,
  content: [],
  technical: [],
  brandVisualRequirements: {
    colorDirection: [],
    typographyDirection: [],
    spacingLayoutDirection: [],
    cardSurfaceStyling: [],
    iconDirection: [],
    imageryDirection: [],
    brandReferenceUsage: [],
    visualAntiPatterns: [],
  },
  assetRequirements: {
    requiredAssets: [],
    additionalImagery: {
      allowed: false,
      sourcingPolicy: [],
      realisticProfessional: false,
      avoidArtificialLook: false,
    },
  },
  formBehaviorRequirements: {
    formPresent: false,
    validation: "NOT_REQUIRED",
    successUx: "NONE",
    dataTransmission: "NONE",
    persistence: "NONE",
    thirdParty: "NONE",
    privacyCheckbox: "NOT_APPLICABLE",
    interactionStates: [],
  },
  uxResponsiveRequirements: {
    mobileFirst: false,
    responsiveBehavior: [],
    stickyMobileCta: false,
    smoothScroll: false,
    reducedMotion: false,
    interactionRequirements: [],
  },
  seoMetadata: {
    primaryKeywords: [],
    locationTargeting: [],
    pageMetadata: [],
  },
  legalComplianceConstraints: {
    constraints: [],
    placeholderPolicy: "UNRESOLVED",
    inventedFactsForbidden: false,
  },
  prohibitedRequirements: [],
  deferredIntegrations: [],
  decisions: [],
});

export const canonicalAssetReference = (assetId: string) => {
  if (UuidSchema.safeParse(assetId).success) return assetId;
  return `requirement:${assetId.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 140)}`;
};
