import { z } from "zod";
import { LocaleSchema, NonEmptyStringSchema } from "@/domain/shared/schemas";

export const V3_SCHEMA_VERSION = 3 as const;

const SourceRefSchema = NonEmptyStringSchema.max(200);
export const SemanticRequirementIdSchema = z.string().regex(/^REQUIREMENT:[A-Za-z0-9_.:-]{1,180}$/);
export const SemanticAssetIdSchema = z.string().regex(/^ASSET(?::[A-Za-z0-9_.:-]{1,180}|_COMPANY_LOGO)$/);
export const SemanticPageIdSchema = z.string().regex(/^PAGE:[^\r\n]{1,180}$/);

export const RequirementCategorySchema = z.enum([
  "BUSINESS_GOAL",
  "AUDIENCE",
  "USER_ROLE",
  "FEATURE",
  "FORM",
  "CONTENT",
  "BACKEND",
  "DATABASE",
  "SEO",
  "TECHNICAL",
  "EXCLUSION",
  "ACCEPTANCE",
  "CONTACT_FACT",
  "LEGAL_FACT",
  "BRAND_FACT",
  "LOGO_METADATA",
  "IMAGE_NOTE",
  "RECOMMENDATION",
  "BRAND_VISUAL",
  "UX_RESPONSIVE",
  "LEGAL_CONSTRAINT",
  "PROHIBITED",
  "DEFERRED_INTEGRATION",
  "DECISION",
  "ADMINISTRATION",
  "FORM_INTERACTION",
  "OTHER",
]);
export type RequirementCategory = z.infer<typeof RequirementCategorySchema>;

export const CanonicalRequirementValueSchema = z.object({
  category: RequirementCategorySchema,
  statement: NonEmptyStringSchema.max(4000),
  sourceRefs: z.array(SourceRefSchema).min(1),
}).strict();
export type CanonicalRequirementValue = z.infer<typeof CanonicalRequirementValueSchema>;

export const CanonicalRequirementSchema = CanonicalRequirementValueSchema.extend({
  id: SemanticRequirementIdSchema,
}).strict();
export type CanonicalRequirement = z.infer<typeof CanonicalRequirementSchema>;

export const CanonicalPageValueSchema = z.object({
  slug: NonEmptyStringSchema.max(160),
  purpose: NonEmptyStringSchema.max(2000),
  sourceRefs: z.array(SourceRefSchema).min(1),
}).strict();
export type CanonicalPageValue = z.infer<typeof CanonicalPageValueSchema>;

export const CanonicalPageSchema = CanonicalPageValueSchema.extend({
  id: SemanticPageIdSchema,
}).strict();
export type CanonicalPage = z.infer<typeof CanonicalPageSchema>;

export const AssetRoleSchema = z.enum(["logo", "brand-reference", "photography", "illustration", "document", "other"]);
export const AssetReplacementPolicySchema = z.enum(["FORBIDDEN", "ALLOWED", "UNRESOLVED"]);
export const CanonicalAssetValueSchema = z.object({
  reference: NonEmptyStringSchema.max(200).refine((value) => !/[\\/]/.test(value), "Asset references must not expose storage paths"),
  role: AssetRoleSchema,
  usage: NonEmptyStringSchema.max(2000),
  replacementPolicy: AssetReplacementPolicySchema,
  sourceRefs: z.array(SourceRefSchema).min(1),
}).strict();
export type CanonicalAssetValue = z.infer<typeof CanonicalAssetValueSchema>;

export const CanonicalAssetSchema = CanonicalAssetValueSchema.extend({
  id: SemanticAssetIdSchema,
}).strict();
export type CanonicalAsset = z.infer<typeof CanonicalAssetSchema>;

/** Lifecycle stages that may own an unresolved canonical requirement. */
export const CanonicalUnresolvedStageSchema = z.enum([
  "BRIEF_APPROVAL",
  "PLANNING",
  "ARCHITECTURE_REVIEW",
  "DESIGN",
  "ASSET_REVIEW",
  "PUBLICATION",
]);
export type CanonicalUnresolvedStage = z.infer<typeof CanonicalUnresolvedStageSchema>;

const InteractionStatesSchema = z.array(CanonicalRequirementSchema);
export const FormSimulationPolicySchema = z.enum(["ALLOWED", "FORBIDDEN", "UNRESOLVED"]);
export const FormTransmissionModeSchema = z.enum(["NONE", "EMAIL", "API", "OTHER", "UNRESOLVED"]);
export const FormPersistenceModeSchema = z.enum(["NONE", "DATABASE", "OTHER", "UNRESOLVED"]);
export const FormServerProcessingModeSchema = z.enum(["NONE", "SERVER", "UNRESOLVED"]);
export const FormExternalProviderModeSchema = z.enum(["NONE", "APPROVED_PROVIDER", "OTHER", "UNRESOLVED"]);
export const FormPrivacyConsentModeSchema = z.enum(["REQUIRED", "OPTIONAL", "NOT_APPLICABLE", "UNRESOLVED"]);
const FormSharedSchema = {
  formPresent: z.literal(true),
  validation: z.literal("ACTIVE"),
  persistenceMode: FormPersistenceModeSchema,
  serverProcessingMode: FormServerProcessingModeSchema,
  externalProviderMode: FormExternalProviderModeSchema,
  privacyConsentMode: FormPrivacyConsentModeSchema,
  interactionStates: InteractionStatesSchema,
} as const;

export const FormBehaviorStateSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("NONE"),
    formPresent: z.literal(false),
    validation: z.literal("NOT_REQUIRED"),
    simulatedSuccessPolicy: z.literal("NOT_APPLICABLE"),
    transmissionMode: z.literal("NONE"),
    persistenceMode: z.literal("NONE"),
    serverProcessingMode: z.literal("NONE"),
    externalProviderMode: z.literal("NONE"),
    privacyConsentMode: z.literal("NOT_APPLICABLE"),
    interactionStates: z.array(CanonicalRequirementSchema).length(0),
  }).strict(),
  z.object({
    mode: z.literal("SIMULATED"),
    ...FormSharedSchema,
    simulatedSuccessPolicy: z.literal("ALLOWED"),
    transmissionMode: FormTransmissionModeSchema,
  }).strict(),
  z.object({
    mode: z.literal("REAL"),
    ...FormSharedSchema,
    simulatedSuccessPolicy: FormSimulationPolicySchema,
    transmissionMode: FormTransmissionModeSchema.exclude(["NONE"]),
  }).strict(),
  z.object({
    mode: z.literal("UNRESOLVED"),
    ...FormSharedSchema,
    simulatedSuccessPolicy: FormSimulationPolicySchema,
    transmissionMode: FormTransmissionModeSchema,
  }).strict(),
]);
export type FormBehaviorState = z.infer<typeof FormBehaviorStateSchema>;

export const DatabaseModeSchema = z.enum(["NONE", "SUPABASE", "POSTGRES", "OTHER", "UNRESOLVED"]);
export const AuthModeSchema = z.enum(["NONE", "REQUIRED", "OPTIONAL", "UNRESOLVED"]);
export const AnalyticsModeSchema = z.enum(["NONE", "APPROVED_PROVIDER", "OTHER", "UNRESOLVED"]);
export const RoutePolicySchema = z.enum(["SINGLE_PAGE", "MULTI_PAGE", "UNRESOLVED"]);
export const BrandReferenceStrategySchema = z.enum(["NONE", "USER_SUPPLIED", "USER_SUPPLIED_AND_AI_ALLOWED", "AI_GENERATED", "PLACEHOLDERS", "UNRESOLVED"]);
export const ImageSourceStrategySchema = z.enum(["NONE", "AI_GENERATED", "USER_SUPPLIED", "USER_AND_AI", "PLACEHOLDERS", "CUSTOM", "UNRESOLVED"]);
export const PlaceholderPolicySchema = z.enum(["USE_EXPLICIT_PLACEHOLDERS", "NO_PLACEHOLDERS", "UNRESOLVED"]);
export const InventedFactsPolicySchema = z.enum(["FORBIDDEN", "ALLOWED", "UNRESOLVED"]);

const ModeDecisionSchema = <T extends z.ZodType>(mode: T) => z.object({ mode }).strict();

export const ImageRequirementsSchema = z.discriminatedUnion("required", [
  z.object({ required: z.literal(false), sourceStrategy: z.literal("NONE") }).strict(),
  z.object({ required: z.literal(true), sourceStrategy: ImageSourceStrategySchema.exclude(["NONE"]) }).strict(),
]);
export type ImageRequirements = z.infer<typeof ImageRequirementsSchema>;

export const CanonicalEvidenceSchema = z.object({
  field: NonEmptyStringSchema.max(300),
  source: NonEmptyStringSchema.max(1000),
  excerpt: NonEmptyStringSchema.max(4000),
  sourceRefs: z.array(SourceRefSchema).min(1),
}).strict();
export type CanonicalEvidence = z.infer<typeof CanonicalEvidenceSchema>;

export const ConfirmedProprietorSchema = z.object({
  name: NonEmptyStringSchema.max(300),
  sourceRefs: z.array(SourceRefSchema).min(1),
}).strict();
export type ConfirmedProprietor = z.infer<typeof ConfirmedProprietorSchema>;

export const PublicationIdentityScopeSchema = z.enum(["CONTACT", "IMPRESSUM"]);
export type PublicationIdentityScope = z.infer<typeof PublicationIdentityScopeSchema>;
export const PublicEmailPublicationScopeSchema = PublicationIdentityScopeSchema;
export type PublicEmailPublicationScope = PublicationIdentityScope;

const publicationIdentityText = (max: number) => z.string().min(1).max(max).superRefine((value, context) => {
  if (value !== value.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Publication identity text must not have surrounding whitespace." });
  }
  if (/[\x00-\x1F\x7F]/u.test(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Publication identity text must not contain control characters or line breaks." });
  }
  if (/[<>]/u.test(value) || /[a-z][a-z0-9+.-]*:\/\//iu.test(value) || /(?:^|\s)[a-z][a-z0-9+.-]*:[^\s]/iu.test(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Publication identity text must not contain HTML or URI schemes." });
  }
});

const PublicationIdentityAuthorizationShape = {
  confirmation: z.literal("CUSTOMER_CONFIRMED"),
  source: z.literal("CUSTOMER_CONFIRMATION"),
  publicationAuthorized: z.literal(true),
  publicationScopes: z.array(PublicationIdentityScopeSchema).min(1).max(2).transform((scopes) => [...new Set(scopes)].sort()),
} as const;

export const CanonicalPublicationIdentityAuthorizationSchema = z.object(PublicationIdentityAuthorizationShape).strict();
export type CanonicalPublicationIdentityAuthorization = z.infer<typeof CanonicalPublicationIdentityAuthorizationSchema>;

export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
export const CanonicalServiceAddressSchema = z.object({
  street: publicationIdentityText(160),
  houseNumber: publicationIdentityText(30),
  postalCode: publicationIdentityText(20),
  city: publicationIdentityText(120),
  countryCode: CountryCodeSchema,
  countryDisplayName: publicationIdentityText(120),
  display: publicationIdentityText(500).optional(),
  ...PublicationIdentityAuthorizationShape,
}).strict().superRefine((value, context) => {
  if (value.countryCode === "DE" && !/^\d{5}$/u.test(value.postalCode)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["postalCode"], message: "German postal codes must contain exactly five digits." });
  }
  const expectedDisplay = deriveServiceAddressDisplay(value);
  if (value.display !== undefined && value.display !== expectedDisplay) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["display"], message: "Address display must be deterministically derived from the structured fields." });
  }
});
export type CanonicalServiceAddress = z.infer<typeof CanonicalServiceAddressSchema>;

export function deriveServiceAddressDisplay(input: Pick<CanonicalServiceAddress, "street" | "houseNumber" | "postalCode" | "city" | "countryDisplayName">): string {
  return `${input.street} ${input.houseNumber}, ${input.postalCode} ${input.city}, ${input.countryDisplayName}`;
}

export function canonicalizeServiceAddress(input: unknown): CanonicalServiceAddress {
  const parsed = CanonicalServiceAddressSchema.parse(input);
  return CanonicalServiceAddressSchema.parse({ ...parsed, display: deriveServiceAddressDisplay(parsed) });
}

const PublicTelephoneE164Schema = z.string().max(16).superRefine((value, context) => {
  if (!/^\+[1-9]\d{7,14}$/u.test(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Public telephone must be a canonical E.164 number without extensions or URI schemes." });
  }
});

export function derivePublicTelephoneDisplay(e164: string): string {
  const value = e164;
  if (value.startsWith("+49") && value.length > 6) return `+49 ${value.slice(3, 6)} ${value.slice(6)}`;
  const generic = value.match(/^(\+\d{1,3})(\d+)$/u);
  return generic ? `${generic[1]} ${generic[2]}` : value;
}

export function derivePublicTelephoneUri(e164: string): string {
  return `tel:${e164}`;
}

export const CanonicalPublicPhoneSchema = z.object({
  e164: PublicTelephoneE164Schema,
  display: publicationIdentityText(40),
  telUri: z.string().max(40),
  ...PublicationIdentityAuthorizationShape,
}).strict().superRefine((value, context) => {
  if (value.display !== derivePublicTelephoneDisplay(value.e164)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["display"], message: "Telephone display must be deterministically derived from e164." });
  }
  if (value.telUri !== derivePublicTelephoneUri(value.e164)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["telUri"], message: "Telephone URI must be the deterministic tel URI for e164." });
  }
});
export type CanonicalPublicPhone = z.infer<typeof CanonicalPublicPhoneSchema>;

export const CanonicalPublicPhoneInputSchema = z.object({
  e164: PublicTelephoneE164Schema,
  display: publicationIdentityText(40).optional(),
  telUri: z.string().max(40).optional(),
  ...PublicationIdentityAuthorizationShape,
}).strict().superRefine((value, context) => {
  if (value.display !== undefined && value.display !== derivePublicTelephoneDisplay(value.e164)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["display"], message: "Telephone display must be deterministically derived from e164." });
  }
  if (value.telUri !== undefined && value.telUri !== derivePublicTelephoneUri(value.e164)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["telUri"], message: "Telephone URI must be the deterministic tel URI for e164." });
  }
});
export type CanonicalPublicPhoneInput = z.infer<typeof CanonicalPublicPhoneInputSchema>;

export function canonicalizePublicPhone(input: unknown): CanonicalPublicPhone {
  const parsed = CanonicalPublicPhoneInputSchema.parse(input);
  return CanonicalPublicPhoneSchema.parse({ ...parsed, display: derivePublicTelephoneDisplay(parsed.e164), telUri: derivePublicTelephoneUri(parsed.e164) });
}

export const BusinessEntityTypeSchema = z.literal("SOLE_PROPRIETORSHIP");
export const BusinessLegalDescriptionSchema = z.literal("Einzelunternehmen");
export const CanonicalBusinessEntityTypeSchema = z.object({
  entityType: BusinessEntityTypeSchema,
  legalDescription: BusinessLegalDescriptionSchema,
  ...PublicationIdentityAuthorizationShape,
}).strict();
export type CanonicalBusinessEntityType = z.infer<typeof CanonicalBusinessEntityTypeSchema>;

export const CommercialRegisterStatusSchema = z.literal("NOT_REGISTERED");
export const CanonicalCommercialRegisterStatusSchema = z.object({
  status: CommercialRegisterStatusSchema,
  ...PublicationIdentityAuthorizationShape,
}).strict();
export type CanonicalCommercialRegisterStatus = z.infer<typeof CanonicalCommercialRegisterStatusSchema>;

export const TaxIdentifierStatusSchema = z.literal("NOT_YET_ASSIGNED");
export const CanonicalTaxIdentifierStatusSchema = z.object({
  status: TaxIdentifierStatusSchema,
  ...PublicationIdentityAuthorizationShape,
}).strict();
export type CanonicalTaxIdentifierStatus = z.infer<typeof CanonicalTaxIdentifierStatusSchema>;

const PublicEmailAddressSchema = z.string().max(320).superRefine((rawValue, context) => {
  if (/[\u0000-\u001F\u007F]/u.test(rawValue)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Public email must not contain control characters." });
    return;
  }
  const value = rawValue.trim();
  if (value.length < 3) {
    context.addIssue({ code: z.ZodIssueCode.too_small, minimum: 3, inclusive: true, origin: "string", message: "Public email is required." });
    return;
  }
  if (/^mailto:/iu.test(value) || /^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Public email must be a plain address, not a URL or mailto link." });
    return;
  }
  if (/[<>(),;:"\s]/u.test(value) || (value.match(/@/gu) ?? []).length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Public email must be one syntactically valid address." });
    return;
  }
  const [localPart, domain] = value.split("@");
  if (!localPart || !domain || localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Public email has an invalid local part or domain." });
  }
}).transform((value) => value.trim());

/**
 * Canonical policy trims surrounding whitespace only; it preserves the email
 * local part and domain spelling exactly as confirmed by the customer.
 */
export const CanonicalPublicEmailSchema = z.object({
  email: PublicEmailAddressSchema,
  confirmation: z.literal("CUSTOMER_CONFIRMED"),
  source: z.literal("CUSTOMER_CONFIRMATION"),
  publicationAuthorized: z.literal(true),
  publicationScopes: z.array(PublicEmailPublicationScopeSchema).min(1).max(4).transform((scopes) => [...new Set(scopes)].sort()),
}).strict();
export type CanonicalPublicEmail = z.infer<typeof CanonicalPublicEmailSchema>;

export const CanonicalContactSchema = z.object({
  publicEmail: CanonicalPublicEmailSchema.optional(),
  publicPhone: CanonicalPublicPhoneSchema.optional(),
}).strict();
export type CanonicalContact = z.infer<typeof CanonicalContactSchema>;

/** Host-owned publication status; values are deliberately not legal conclusions. */
export const PublicationInputStatusSchema = z.enum([
  "REQUIRED_BEFORE_PUBLICATION",
  "REVIEW_REQUIRED",
  "CONDITIONAL_IF_APPLICABLE",
  "RESOLVED",
  "NOT_APPLICABLE",
]);
export type PublicationInputStatus = z.infer<typeof PublicationInputStatusSchema>;

export const CanonicalPublicationInputSchema = z.object({
  status: PublicationInputStatusSchema,
  sourceRefs: z.array(SourceRefSchema).min(1),
}).strict();
export type CanonicalPublicationInput = z.infer<typeof CanonicalPublicationInputSchema>;

export const CanonicalPublicationInputsSchema = z.object({
  address: CanonicalPublicationInputSchema,
  rapidContact: CanonicalPublicationInputSchema,
  taxIdentifiers: CanonicalPublicationInputSchema,
  registerInformation: CanonicalPublicationInputSchema,
  regulatoryAuthority: CanonicalPublicationInputSchema,
}).strict();
export type CanonicalPublicationInputs = z.infer<typeof CanonicalPublicationInputsSchema>;

/** Status metadata is optional so historical unresolved entries retain their checksums. */
export const CanonicalUnresolvedStatusSchema = PublicationInputStatusSchema;
export type CanonicalUnresolvedStatus = z.infer<typeof CanonicalUnresolvedStatusSchema>;

export const CanonicalUnresolvedSchema = z.object({
  target: NonEmptyStringSchema.max(300),
  reason: NonEmptyStringSchema.max(2000),
  sourceRefs: z.array(SourceRefSchema).min(1),
  status: CanonicalUnresolvedStatusSchema.optional(),
  // Optional by design: omitting it keeps historical canonical checksums
  // valid. Host compatibility logic classifies such items conservatively.
  blockingStages: z.array(CanonicalUnresolvedStageSchema).min(0).refine((items) => new Set(items).size === items.length, "blockingStages must not contain duplicates.").optional(),
}).strict();
export type CanonicalUnresolved = z.infer<typeof CanonicalUnresolvedSchema>;

export const CanonicalSeoSchema = z.object({
  primaryKeywords: z.array(NonEmptyStringSchema.max(300)),
  exactTitle: z.string().trim().max(300).nullable(),
  exactMetaDescription: z.string().trim().max(1000).nullable(),
  locationTargeting: z.array(CanonicalRequirementSchema),
  pageMetadata: z.array(z.object({
    route: NonEmptyStringSchema.max(160),
    title: z.string().trim().max(300).nullable(),
    metaDescription: z.string().trim().max(1000).nullable(),
    keywords: z.array(NonEmptyStringSchema.max(300)),
    sourceRefs: z.array(SourceRefSchema).min(1),
  }).strict()),
}).strict();
export type CanonicalSeo = z.infer<typeof CanonicalSeoSchema>;

const UxTextSchema = z.string().trim().min(1).max(240).superRefine((value, context) => {
  if (/[\u0000-\u001F\u007F<>`{}]/u.test(value)
    || /(?:javascript|data|https?|mailto):/iu.test(value)
    || /(?:^|\s)(?:www\.)/iu.test(value)
    || /(?:className|style\s*=|<\/?script\b|<\/?[a-z][^>]*>|\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=|\bfunction\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(|\b(?:import|export)\s+(?:\{|[A-Za-z_$])|\bclass\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\{|\breturn\s+[A-Za-z_$][A-Za-z0-9_$]*\s*;|=>|@(?:media|import)\b|--[a-z-]+\s*:|(?:display|position|color|background|font(?:-family|-size)?|margin|padding)\s*:[^,;]+;)/iu.test(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Customer UX direction text must be bounded semantic guidance, not markup, code, or a URI." });
  }
});
const UxTextListSchema = z.array(UxTextSchema).max(16).superRefine((values, context) => {
  if (new Set(values.map((value) => value.toLocaleLowerCase())).size !== values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Customer UX direction lists must not contain duplicates." });
  }
});
const UxSourceRefsSchema = z.array(SourceRefSchema).max(8).transform((values) => [...new Set(values)].sort());
const UxIdentitySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

export const CustomerUxDirectionMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal("CUSTOMER_CONFIRMATION"),
  confirmation: z.literal("CUSTOMER_CONFIRMED"),
  status: z.enum(["ACTIVE", "SUPERSEDED"]),
  recordedRevisionId: UxIdentitySchema,
  rationale: UxTextSchema.max(600).optional(),
  evidenceRefs: UxSourceRefsSchema.optional(),
}).strict();

export const CustomerUxSectionIdSchema = z.enum([
  "HEADER", "HERO", "SERVICE_ORIENTATION", "DETAILED_SERVICES", "CUSTOMER_SITUATIONS",
  "PROCESS", "TRUST", "SERVICE_AREA", "FAQ", "FINAL_CTA", "FOOTER",
  "BEFORE_AFTER", "REAL_PROJECT_GALLERY",
]);
export const CustomerUxSectionStateSchema = z.enum(["REQUIRED", "OPTIONAL", "OMITTED", "FUTURE_ONLY"]);
export const CustomerUxSectionPolicySchema = z.object({
  id: CustomerUxSectionIdSchema,
  order: z.number().int().positive().max(32),
  state: CustomerUxSectionStateSchema,
}).strict();

export const CustomerUxDirectionSchema = z.object({
  metadata: CustomerUxDirectionMetadataSchema,
  visual: z.object({
    concept: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    presentationAttributes: UxTextListSchema,
    dominantSurfaceDirection: UxTextSchema,
    contrastDirection: UxTextSchema,
    accentTreatment: UxTextSchema,
    typographyDirection: UxTextSchema,
    brandAssetAuthority: z.enum(["AUTHORITATIVE_PROTECTED", "CUSTOMER_SUPPLIED_AUTHORITATIVE", "NONE"]),
    avoidedPatterns: UxTextListSchema,
  }).strict(),
  audienceAndPositioning: z.object({
    primaryAudienceOrientation: UxTextSchema,
    audienceSegments: UxTextListSchema,
    desiredPerception: UxTextListSchema,
    copyDirection: UxTextSchema.optional(),
    prohibitedUnsupportedClaims: UxTextListSchema,
  }).strict(),
  informationArchitecture: z.object({
    onePage: z.literal(true),
    sections: z.array(CustomerUxSectionPolicySchema).min(1).max(13),
  }).strict(),
  conversionPolicy: z.object({
    allowedChannels: z.array(z.enum(["DIRECT_PHONE", "DIRECT_EMAIL", "CONTACT_FORM"])).max(3),
    forbiddenChannels: z.array(z.enum(["DIRECT_PHONE", "DIRECT_EMAIL", "CONTACT_FORM"])).max(3),
    primaryCtaIntent: UxTextSchema,
    secondaryCtaIntent: UxTextSchema.optional(),
    dataCollectionForm: z.enum(["PERMITTED", "FORBIDDEN", "UNRESOLVED"]),
  }).strict(),
  imageEvidencePolicy: z.object({
    realProjectPhotography: z.enum(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]),
    beforeAfter: CustomerUxSectionStateSchema,
    aiSupportingImagery: z.enum(["FORBIDDEN", "ALLOWED_NON_EVIDENTIARY"]),
    stockImagery: z.enum(["ALLOWED", "FORBIDDEN"]),
    aiOrStockEmployeeRepresentation: z.enum(["FORBIDDEN", "ALLOWED_NON_EVIDENTIARY"]),
    protectedLogo: z.literal("AUTHORITATIVE_NON_REPLACEABLE"),
    missingImagery: z.enum(["BLOCKER", "NON_BLOCKER", "UNKNOWN"]),
  }).strict(),
  trustPolicy: z.object({
    allowedTrustSignals: UxTextListSchema,
    forbiddenUnsupportedTrustSignals: UxTextListSchema,
  }).strict(),
  motionAndInteraction: z.object({
    allowedInteractionPatterns: UxTextListSchema,
    avoidedInteractionPatterns: UxTextListSchema,
    reducedMotion: z.enum(["REQUIRED", "PREFERRED", "NOT_REQUIRED"]),
    keyboardOperability: z.literal("REQUIRED"),
    noHoverOnlyCriticalActions: z.literal(true),
  }).strict(),
  mobileAccessibility: z.object({
    mobileFirst: z.boolean(),
    directTelephoneEmailActions: z.boolean(),
    minimumTargetSizeDirection: UxTextSchema,
    overflowAvoidance: z.literal("REQUIRED"),
    focusVisibility: z.literal("REQUIRED"),
    semanticHtml: z.literal("REQUIRED"),
    accessibilityTarget: z.enum(["WCAG_2_2_AA", "WCAG_2_1_AA", "UNSPECIFIED"]),
    altText: z.enum(["REQUIRED", "WHEN_APPLICABLE"]),
    screenReaderKeyboardConsiderations: UxTextListSchema,
  }).strict(),
  performance: z.object({
    coreWebVitalsOrientation: z.enum(["TARGET_ORIENTED", "OPTIMIZE", "UNSPECIFIED"]),
    lcpTargetMs: z.number().int().positive().max(10000).optional(),
    clsTarget: z.number().nonnegative().max(1).optional(),
    inpTargetMs: z.number().int().positive().max(5000).optional(),
    minimalUnnecessaryClientJavascript: z.literal(true),
    responsiveImages: z.literal("REQUIRED"),
    thirdPartyScriptPolicy: z.enum(["MINIMIZE", "FORBID_UNAPPROVED", "UNSPECIFIED"]),
    targetsAreNonContractual: z.literal(true),
  }).strict(),
  seoAndLocalDirection: z.object({
    contentLanguage: LocaleSchema,
    headingHierarchy: z.enum(["SEMANTIC_ORDER", "UNSPECIFIED"]),
    localRelevance: z.enum(["USE_CONFIRMED_GEOGRAPHY", "UNSPECIFIED"]),
    structuredData: z.enum(["CONFIRMED_FACTS_ONLY", "FORBIDDEN", "UNSPECIFIED"]),
    metadataPolicy: z.enum(["CONFIRMED_CONTENT_ONLY", "UNSPECIFIED"]),
    sitemapRobotsCanonical: z.enum(["MAINTAIN_CANONICAL_METADATA", "UNSPECIFIED"]),
    keywordStuffing: z.literal("FORBIDDEN"),
  }).strict(),
  creativeFreedom: z.object({
    hardCustomerInvariants: UxTextListSchema,
    creativeDirections: UxTextListSchema,
    implementationFreedom: UxTextListSchema,
    allowedUiLibrarySelection: z.literal("UNRESTRICTED_COMPATIBLE_LIBRARIES"),
    allowedCustomComponents: z.literal(true),
    boundedBy: UxTextListSchema,
  }).strict(),
}).strict().superRefine((value, context) => {
  const sectionIds = value.informationArchitecture.sections.map((section) => section.id);
  const orders = value.informationArchitecture.sections.map((section) => section.order);
  if (new Set(sectionIds).size !== sectionIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["informationArchitecture", "sections"], message: "Section identities must be unique." });
  if (new Set(orders).size !== orders.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["informationArchitecture", "sections"], message: "Section order values must be unique." });
  const allowed = new Set(value.conversionPolicy.allowedChannels);
  if (value.conversionPolicy.forbiddenChannels.some((channel) => allowed.has(channel))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversionPolicy"], message: "A conversion channel cannot be both allowed and forbidden." });
  if (value.imageEvidencePolicy.beforeAfter !== "OMITTED" && value.imageEvidencePolicy.beforeAfter !== "FUTURE_ONLY" && value.imageEvidencePolicy.realProjectPhotography === "UNAVAILABLE") context.addIssue({ code: z.ZodIssueCode.custom, path: ["imageEvidencePolicy"], message: "Unavailable real project photography cannot require current Before/After evidence." });
});
export type CustomerUxDirection = z.infer<typeof CustomerUxDirectionSchema>;

export const CanonicalBriefV3Schema = z.object({
  schemaVersion: z.literal(V3_SCHEMA_VERSION),
  summary: NonEmptyStringSchema.max(6000),
  title: z.string().trim().max(300).nullable(),
  scope: z.object({
    protectedFunctionality: z.boolean(),
    images: ImageRequirementsSchema,
  }).strict(),
  pages: z.array(CanonicalPageSchema),
  requirements: z.array(CanonicalRequirementSchema),
  decisions: z.object({
    form: FormBehaviorStateSchema,
    database: ModeDecisionSchema(DatabaseModeSchema),
    auth: ModeDecisionSchema(AuthModeSchema),
    analytics: ModeDecisionSchema(AnalyticsModeSchema),
    routePolicy: ModeDecisionSchema(RoutePolicySchema),
  }).strict(),
  assets: z.array(CanonicalAssetSchema),
  brand: z.object({
    referenceStrategy: BrandReferenceStrategySchema,
    suppliedInformation: z.string().trim().max(2000).nullable(),
    suppliedLogoDescription: z.string().trim().max(2000).nullable(),
    marketingName: NonEmptyStringSchema.max(300).optional(),
  }).strict(),
  customerUxDirection: CustomerUxDirectionSchema.optional(),
  seo: CanonicalSeoSchema,
  legal: z.object({
    placeholderPolicy: PlaceholderPolicySchema,
    inventedFactsPolicy: InventedFactsPolicySchema,
    confirmedProprietor: ConfirmedProprietorSchema.optional(),
    serviceAddress: CanonicalServiceAddressSchema.optional(),
    businessEntityType: CanonicalBusinessEntityTypeSchema.optional(),
    commercialRegisterStatus: CanonicalCommercialRegisterStatusSchema.optional(),
    ustIdStatus: CanonicalTaxIdentifierStatusSchema.optional(),
    wIdStatus: CanonicalTaxIdentifierStatusSchema.optional(),
    publicationInputs: CanonicalPublicationInputsSchema.optional(),
  }).strict(),
  contact: CanonicalContactSchema.optional(),
  localization: z.object({
    locales: z.array(LocaleSchema),
    defaultLocale: LocaleSchema,
  }).strict(),
  evidence: z.array(CanonicalEvidenceSchema),
  unresolved: z.array(CanonicalUnresolvedSchema),
}).strict();
export type CanonicalBriefV3 = z.infer<typeof CanonicalBriefV3Schema>;

export const emptyFormBehaviorState = (): FormBehaviorState => ({
  mode: "NONE",
  formPresent: false,
  validation: "NOT_REQUIRED",
  simulatedSuccessPolicy: "NOT_APPLICABLE",
  transmissionMode: "NONE",
  persistenceMode: "NONE",
  serverProcessingMode: "NONE",
  externalProviderMode: "NONE",
  privacyConsentMode: "NOT_APPLICABLE",
  interactionStates: [],
});

export const unresolvedFormBehaviorState = (overrides: Partial<Extract<FormBehaviorState, { mode: "UNRESOLVED" }>> = {}): Extract<FormBehaviorState, { mode: "UNRESOLVED" }> => ({
  mode: "UNRESOLVED",
  formPresent: true,
  validation: "ACTIVE",
  simulatedSuccessPolicy: "UNRESOLVED",
  transmissionMode: "UNRESOLVED",
  persistenceMode: "UNRESOLVED",
  serverProcessingMode: "UNRESOLVED",
  externalProviderMode: "UNRESOLVED",
  privacyConsentMode: "UNRESOLVED",
  interactionStates: [],
  ...overrides,
});
