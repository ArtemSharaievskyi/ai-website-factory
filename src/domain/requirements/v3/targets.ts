import { createHash } from "node:crypto";
import {
  AnalyticsModeSchema,
  AuthModeSchema,
  BrandReferenceStrategySchema,
  CanonicalAssetValueSchema,
  CanonicalEvidenceSchema,
  CanonicalRequirementSchema,
  CanonicalSeoSchema,
  CanonicalPublicEmailSchema,
  CanonicalPublicPhoneSchema,
  CanonicalServiceAddressSchema,
  CanonicalBusinessEntityTypeSchema,
  CanonicalCommercialRegisterStatusSchema,
  CanonicalTaxIdentifierStatusSchema,
  ConfirmedProprietorSchema,
  CanonicalUnresolvedSchema,
  CanonicalPublicationInputsSchema,
  CanonicalPageValueSchema,
  CanonicalRequirementValueSchema,
  DatabaseModeSchema,
  FormSimulationPolicySchema,
  FormExternalProviderModeSchema,
  FormPersistenceModeSchema,
  FormPrivacyConsentModeSchema,
  FormServerProcessingModeSchema,
  FormTransmissionModeSchema,
  ImageSourceStrategySchema,
  InventedFactsPolicySchema,
  PlaceholderPolicySchema,
  RoutePolicySchema,
  CustomerUxDirectionSchema,
} from "./schema";
import { z } from "zod";
import { BriefV3Error } from "./errors";

export const SEMANTIC_TARGETS = {
  FORM_SUCCESS_MODE: "FORM_SUCCESS_MODE",
  FORM_SIMULATED_SUCCESS_POLICY: "FORM_SIMULATED_SUCCESS_POLICY",
  FORM_TRANSMISSION_MODE: "FORM_TRANSMISSION_MODE",
  FORM_PERSISTENCE_MODE: "FORM_PERSISTENCE_MODE",
  FORM_SERVER_PROCESSING_MODE: "FORM_SERVER_PROCESSING_MODE",
  FORM_EXTERNAL_PROVIDER_MODE: "FORM_EXTERNAL_PROVIDER_MODE",
  FORM_PRIVACY_CONSENT_MODE: "FORM_PRIVACY_CONSENT_MODE",
  DATABASE_MODE: "DATABASE_MODE",
  AUTH_MODE: "AUTH_MODE",
  ANALYTICS_MODE: "ANALYTICS_MODE",
  PROTECTED_FUNCTIONALITY: "PROTECTED_FUNCTIONALITY",
  ROUTE_POLICY: "ROUTE_POLICY",
  BRAND_REFERENCE_STRATEGY: "BRAND_REFERENCE_STRATEGY",
  BRAND_SUPPLIED_INFORMATION: "BRAND_SUPPLIED_INFORMATION",
  BRAND_SUPPLIED_LOGO_DESCRIPTION: "BRAND_SUPPLIED_LOGO_DESCRIPTION",
  IMAGE_SOURCE_STRATEGY: "IMAGE_SOURCE_STRATEGY",
  SEO_TITLE: "SEO_TITLE",
  SEO_META_DESCRIPTION: "SEO_META_DESCRIPTION",
  LEGAL_PLACEHOLDER_POLICY: "LEGAL_PLACEHOLDER_POLICY",
  LEGAL_INVENTED_FACTS_POLICY: "LEGAL_INVENTED_FACTS_POLICY",
  BRAND_MARKETING_NAME: "BRAND_MARKETING_NAME",
  LEGAL_CONFIRMED_PROPRIETOR: "LEGAL_CONFIRMED_PROPRIETOR",
  LEGAL_PUBLICATION_INPUTS: "LEGAL_PUBLICATION_INPUTS",
  PUBLIC_CONTACT_EMAIL: "PUBLIC_CONTACT_EMAIL",
  PUBLICATION_SERVICE_ADDRESS: "PUBLICATION_SERVICE_ADDRESS",
  PUBLIC_CONTACT_PHONE: "PUBLIC_CONTACT_PHONE",
  BUSINESS_ENTITY_TYPE: "BUSINESS_ENTITY_TYPE",
  COMMERCIAL_REGISTER_STATUS: "COMMERCIAL_REGISTER_STATUS",
  UST_ID_STATUS: "UST_ID_STATUS",
  W_ID_STATUS: "W_ID_STATUS",
  BRIEF_TITLE: "BRIEF_TITLE",
  BRIEF_EVIDENCE: "BRIEF_EVIDENCE",
  BRIEF_UNRESOLVED: "BRIEF_UNRESOLVED",
  SEO_PRIMARY_KEYWORDS: "SEO_PRIMARY_KEYWORDS",
  SEO_LOCATION_TARGETING: "SEO_LOCATION_TARGETING",
  SEO_PAGE_METADATA: "SEO_PAGE_METADATA",
  CUSTOMER_UX_DIRECTION: "CUSTOMER_UX_DIRECTION",
  ASSET_COMPANY_LOGO: "ASSET_COMPANY_LOGO",
} as const;

export type FixedSemanticTargetId = typeof SEMANTIC_TARGETS[keyof typeof SEMANTIC_TARGETS];
export type DynamicRequirementTargetId = `REQUIREMENT:${string}`;
export type DynamicAssetTargetId = `ASSET:${string}`;
export type DynamicPageTargetId = `PAGE:${string}`;
export type AssetTargetId = DynamicAssetTargetId | typeof SEMANTIC_TARGETS.ASSET_COMPANY_LOGO;
export type SemanticTargetId = FixedSemanticTargetId | DynamicRequirementTargetId | DynamicAssetTargetId | DynamicPageTargetId;

export const SEMANTIC_TARGET_ID_PATTERN = /^(?:FORM_[A-Z_]+|DATABASE_MODE|AUTH_MODE|ANALYTICS_MODE|PROTECTED_FUNCTIONALITY|ROUTE_POLICY|BRAND_REFERENCE_STRATEGY|BRAND_SUPPLIED_INFORMATION|BRAND_SUPPLIED_LOGO_DESCRIPTION|BRAND_MARKETING_NAME|IMAGE_SOURCE_STRATEGY|SEO_TITLE|SEO_META_DESCRIPTION|SEO_PRIMARY_KEYWORDS|SEO_LOCATION_TARGETING|SEO_PAGE_METADATA|CUSTOMER_UX_DIRECTION|LEGAL_[A-Z_]+|PUBLIC_CONTACT_EMAIL|PUBLICATION_SERVICE_ADDRESS|PUBLIC_CONTACT_PHONE|BUSINESS_ENTITY_TYPE|COMMERCIAL_REGISTER_STATUS|UST_ID_STATUS|W_ID_STATUS|BRIEF_TITLE|BRIEF_EVIDENCE|BRIEF_UNRESOLVED|ASSET_COMPANY_LOGO|REQUIREMENT:[A-Za-z0-9_.:-]{1,180}|ASSET:[A-Za-z0-9_.:-]{1,180}|PAGE:[^\r\n]{1,180})$/;

export const isSemanticTargetId = (value: string): value is SemanticTargetId => SEMANTIC_TARGET_ID_PATTERN.test(value);
export const isRequirementTarget = (value: string): value is DynamicRequirementTargetId => value.startsWith("REQUIREMENT:") && isSemanticTargetId(value);
export const isAssetTarget = (value: string): value is DynamicAssetTargetId | typeof SEMANTIC_TARGETS.ASSET_COMPANY_LOGO => (value.startsWith("ASSET:") || value === SEMANTIC_TARGETS.ASSET_COMPANY_LOGO) && isSemanticTargetId(value);
export const isPageTarget = (value: string): value is DynamicPageTargetId => value.startsWith("PAGE:") && isSemanticTargetId(value);
export const pageTargetForSlug = (slug: string): DynamicPageTargetId => {
  const encoded = encodeURIComponent(slug);
  return `PAGE:${encoded.length <= 180 ? encoded : createHash("sha256").update(slug).digest("hex")}`;
};

export const SuccessModeSchema = z.enum(["NONE", "SIMULATED", "REAL", "UNRESOLVED"]);
export type FixedSetTargetId = Exclude<FixedSemanticTargetId, typeof SEMANTIC_TARGETS.ASSET_COMPANY_LOGO>;
export type FixedTargetValueMap = {
  [SEMANTIC_TARGETS.FORM_SUCCESS_MODE]: z.infer<typeof SuccessModeSchema>;
  [SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY]: z.infer<typeof FormSimulationPolicySchema> | "NOT_APPLICABLE";
  [SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE]: z.infer<typeof FormTransmissionModeSchema>;
  [SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE]: z.infer<typeof FormPersistenceModeSchema>;
  [SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE]: z.infer<typeof FormServerProcessingModeSchema>;
  [SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE]: z.infer<typeof FormExternalProviderModeSchema>;
  [SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE]: z.infer<typeof FormPrivacyConsentModeSchema>;
  [SEMANTIC_TARGETS.DATABASE_MODE]: z.infer<typeof DatabaseModeSchema>;
  [SEMANTIC_TARGETS.AUTH_MODE]: z.infer<typeof AuthModeSchema>;
  [SEMANTIC_TARGETS.ANALYTICS_MODE]: z.infer<typeof AnalyticsModeSchema>;
  [SEMANTIC_TARGETS.PROTECTED_FUNCTIONALITY]: boolean;
  [SEMANTIC_TARGETS.ROUTE_POLICY]: z.infer<typeof RoutePolicySchema>;
  [SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY]: z.infer<typeof BrandReferenceStrategySchema>;
  [SEMANTIC_TARGETS.BRAND_SUPPLIED_INFORMATION]: string | null;
  [SEMANTIC_TARGETS.BRAND_SUPPLIED_LOGO_DESCRIPTION]: string | null;
  [SEMANTIC_TARGETS.BRAND_MARKETING_NAME]: string | null;
  [SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY]: z.infer<typeof ImageSourceStrategySchema>;
  [SEMANTIC_TARGETS.SEO_TITLE]: string | null;
  [SEMANTIC_TARGETS.SEO_META_DESCRIPTION]: string | null;
  [SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY]: z.infer<typeof PlaceholderPolicySchema>;
  [SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY]: z.infer<typeof InventedFactsPolicySchema>;
  [SEMANTIC_TARGETS.LEGAL_CONFIRMED_PROPRIETOR]: z.infer<typeof ConfirmedProprietorSchema> | null;
  [SEMANTIC_TARGETS.LEGAL_PUBLICATION_INPUTS]: z.infer<typeof CanonicalPublicationInputsSchema>;
  [SEMANTIC_TARGETS.PUBLIC_CONTACT_EMAIL]: z.infer<typeof CanonicalPublicEmailSchema>;
  [SEMANTIC_TARGETS.PUBLICATION_SERVICE_ADDRESS]: z.infer<typeof CanonicalServiceAddressSchema>;
  [SEMANTIC_TARGETS.PUBLIC_CONTACT_PHONE]: z.infer<typeof CanonicalPublicPhoneSchema>;
  [SEMANTIC_TARGETS.BUSINESS_ENTITY_TYPE]: z.infer<typeof CanonicalBusinessEntityTypeSchema>;
  [SEMANTIC_TARGETS.COMMERCIAL_REGISTER_STATUS]: z.infer<typeof CanonicalCommercialRegisterStatusSchema>;
  [SEMANTIC_TARGETS.UST_ID_STATUS]: z.infer<typeof CanonicalTaxIdentifierStatusSchema>;
  [SEMANTIC_TARGETS.W_ID_STATUS]: z.infer<typeof CanonicalTaxIdentifierStatusSchema>;
  [SEMANTIC_TARGETS.BRIEF_TITLE]: string | null;
  [SEMANTIC_TARGETS.BRIEF_EVIDENCE]: z.infer<typeof CanonicalEvidenceSchema>[];
  [SEMANTIC_TARGETS.BRIEF_UNRESOLVED]: z.infer<typeof CanonicalUnresolvedSchema>[];
  [SEMANTIC_TARGETS.SEO_PRIMARY_KEYWORDS]: string[];
  [SEMANTIC_TARGETS.SEO_LOCATION_TARGETING]: z.infer<typeof CanonicalRequirementSchema>[];
  [SEMANTIC_TARGETS.SEO_PAGE_METADATA]: z.infer<typeof CanonicalSeoSchema>["pageMetadata"];
  [SEMANTIC_TARGETS.CUSTOMER_UX_DIRECTION]: z.infer<typeof CustomerUxDirectionSchema>;
};

export type TargetValueFor<T extends SemanticTargetId> =
  T extends FixedSetTargetId ? FixedTargetValueMap[T] :
  T extends DynamicRequirementTargetId ? z.infer<typeof CanonicalRequirementValueSchema> :
  T extends AssetTargetId ? z.infer<typeof CanonicalAssetValueSchema> :
  T extends DynamicPageTargetId ? z.infer<typeof CanonicalPageValueSchema> :
  never;

export const TargetCatalogEntrySchema = z.object({
  id: z.string(),
  operation: z.enum(["SET", "UPSERT", "REMOVE"]),
  valueType: z.enum(["successMode", "successPolicy", "transmissionMode", "persistenceMode", "serverProcessingMode", "externalProviderMode", "privacyConsentMode", "databaseMode", "authMode", "analyticsMode", "protectedFunctionality", "routePolicy", "brandStrategy", "brandSuppliedInformation", "brandSuppliedLogoDescription", "brandMarketingName", "imageStrategy", "title", "metaDescription", "primaryKeywords", "locationTargeting", "pageMetadata", "customerUxDirection", "placeholderPolicy", "inventedFactsPolicy", "confirmedProprietor", "publicationInputs", "publicEmail", "serviceAddress", "publicPhone", "businessEntityType", "commercialRegisterStatus", "taxIdentifierStatus", "evidence", "unresolved", "requirement", "asset", "page"]),
  providerWritable: z.boolean().optional(),
}).strict();
export type TargetCatalogEntry = z.infer<typeof TargetCatalogEntrySchema>;

const fixed = (id: FixedSemanticTargetId, valueType: TargetCatalogEntry["valueType"]): TargetCatalogEntry => ({ id, operation: "SET", valueType });

export const TARGET_CATALOG: readonly TargetCatalogEntry[] = [
  fixed(SEMANTIC_TARGETS.FORM_SUCCESS_MODE, "successMode"),
  fixed(SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY, "successPolicy"),
  fixed(SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE, "transmissionMode"),
  fixed(SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE, "persistenceMode"),
  fixed(SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE, "serverProcessingMode"),
  fixed(SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE, "externalProviderMode"),
  fixed(SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE, "privacyConsentMode"),
  fixed(SEMANTIC_TARGETS.DATABASE_MODE, "databaseMode"),
  fixed(SEMANTIC_TARGETS.AUTH_MODE, "authMode"),
  fixed(SEMANTIC_TARGETS.ANALYTICS_MODE, "analyticsMode"),
  { id: SEMANTIC_TARGETS.PROTECTED_FUNCTIONALITY, operation: "SET", valueType: "protectedFunctionality", providerWritable: false },
  fixed(SEMANTIC_TARGETS.ROUTE_POLICY, "routePolicy"),
  fixed(SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY, "brandStrategy"),
  fixed(SEMANTIC_TARGETS.BRAND_SUPPLIED_INFORMATION, "brandSuppliedInformation"),
  fixed(SEMANTIC_TARGETS.BRAND_SUPPLIED_LOGO_DESCRIPTION, "brandSuppliedLogoDescription"),
  fixed(SEMANTIC_TARGETS.BRAND_MARKETING_NAME, "brandMarketingName"),
  fixed(SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY, "imageStrategy"),
  fixed(SEMANTIC_TARGETS.SEO_TITLE, "title"),
  fixed(SEMANTIC_TARGETS.SEO_META_DESCRIPTION, "metaDescription"),
  fixed(SEMANTIC_TARGETS.SEO_PRIMARY_KEYWORDS, "primaryKeywords"),
  fixed(SEMANTIC_TARGETS.SEO_LOCATION_TARGETING, "locationTargeting"),
  fixed(SEMANTIC_TARGETS.SEO_PAGE_METADATA, "pageMetadata"),
  { id: SEMANTIC_TARGETS.CUSTOMER_UX_DIRECTION, operation: "SET", valueType: "customerUxDirection", providerWritable: false },
  fixed(SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY, "placeholderPolicy"),
  fixed(SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY, "inventedFactsPolicy"),
  fixed(SEMANTIC_TARGETS.LEGAL_CONFIRMED_PROPRIETOR, "confirmedProprietor"),
  { id: SEMANTIC_TARGETS.LEGAL_PUBLICATION_INPUTS, operation: "SET", valueType: "publicationInputs", providerWritable: false },
  { id: SEMANTIC_TARGETS.PUBLIC_CONTACT_EMAIL, operation: "SET", valueType: "publicEmail", providerWritable: false },
  { id: SEMANTIC_TARGETS.PUBLICATION_SERVICE_ADDRESS, operation: "SET", valueType: "serviceAddress", providerWritable: false },
  { id: SEMANTIC_TARGETS.PUBLIC_CONTACT_PHONE, operation: "SET", valueType: "publicPhone", providerWritable: false },
  { id: SEMANTIC_TARGETS.BUSINESS_ENTITY_TYPE, operation: "SET", valueType: "businessEntityType", providerWritable: false },
  { id: SEMANTIC_TARGETS.COMMERCIAL_REGISTER_STATUS, operation: "SET", valueType: "commercialRegisterStatus", providerWritable: false },
  { id: SEMANTIC_TARGETS.UST_ID_STATUS, operation: "SET", valueType: "taxIdentifierStatus", providerWritable: false },
  { id: SEMANTIC_TARGETS.W_ID_STATUS, operation: "SET", valueType: "taxIdentifierStatus", providerWritable: false },
  fixed(SEMANTIC_TARGETS.BRIEF_TITLE, "title"),
  fixed(SEMANTIC_TARGETS.BRIEF_EVIDENCE, "evidence"),
  fixed(SEMANTIC_TARGETS.BRIEF_UNRESOLVED, "unresolved"),
  { id: SEMANTIC_TARGETS.ASSET_COMPANY_LOGO, operation: "UPSERT", valueType: "asset" },
  { id: "REQUIREMENT:*", operation: "UPSERT", valueType: "requirement" },
  { id: "ASSET:*", operation: "UPSERT", valueType: "asset" },
  { id: "PAGE:*", operation: "UPSERT", valueType: "page" },
] as const;

const fixedEntry = new Map(TARGET_CATALOG.filter((entry) => !entry.id.endsWith(":*")).map((entry) => [entry.id, entry]));

export function getTargetCatalogEntry(target: string): TargetCatalogEntry | undefined {
  const exact = fixedEntry.get(target);
  if (exact) return exact;
  if (isRequirementTarget(target)) return { id: "REQUIREMENT:*", operation: "UPSERT", valueType: "requirement" };
  if (isAssetTarget(target)) return { id: "ASSET:*", operation: "UPSERT", valueType: "asset" };
  if (isPageTarget(target)) return { id: "PAGE:*", operation: "UPSERT", valueType: "page" };
  return undefined;
}

export const targetValueSchemas = {
  successMode: SuccessModeSchema,
  successPolicy: z.enum(["ALLOWED", "FORBIDDEN", "UNRESOLVED", "NOT_APPLICABLE"]),
  transmissionMode: FormTransmissionModeSchema,
  persistenceMode: FormPersistenceModeSchema,
  serverProcessingMode: FormServerProcessingModeSchema,
  externalProviderMode: FormExternalProviderModeSchema,
  privacyConsentMode: FormPrivacyConsentModeSchema,
  databaseMode: DatabaseModeSchema,
  authMode: AuthModeSchema,
  analyticsMode: AnalyticsModeSchema,
  protectedFunctionality: z.boolean(),
  routePolicy: RoutePolicySchema,
  brandStrategy: BrandReferenceStrategySchema,
  brandSuppliedInformation: z.string().trim().max(2000).nullable(),
  brandSuppliedLogoDescription: z.string().trim().max(2000).nullable(),
  brandMarketingName: z.string().trim().max(300).nullable(),
  imageStrategy: ImageSourceStrategySchema,
  title: z.string().trim().max(300).nullable(),
  metaDescription: z.string().trim().max(1000).nullable(),
  primaryKeywords: z.array(z.string().trim().max(300)),
  locationTargeting: z.array(CanonicalRequirementSchema),
  pageMetadata: CanonicalSeoSchema.shape.pageMetadata,
  customerUxDirection: CustomerUxDirectionSchema,
  placeholderPolicy: PlaceholderPolicySchema,
  inventedFactsPolicy: InventedFactsPolicySchema,
  confirmedProprietor: ConfirmedProprietorSchema.nullable(),
  publicationInputs: CanonicalPublicationInputsSchema,
  publicEmail: CanonicalPublicEmailSchema,
  serviceAddress: CanonicalServiceAddressSchema,
  publicPhone: CanonicalPublicPhoneSchema,
  businessEntityType: CanonicalBusinessEntityTypeSchema,
  commercialRegisterStatus: CanonicalCommercialRegisterStatusSchema,
  taxIdentifierStatus: CanonicalTaxIdentifierStatusSchema,
  evidence: z.array(CanonicalEvidenceSchema),
  unresolved: z.array(CanonicalUnresolvedSchema),
  requirement: CanonicalRequirementValueSchema,
  asset: CanonicalAssetValueSchema,
  page: CanonicalPageValueSchema,
} as const;

export function assertKnownTarget(target: string): SemanticTargetId {
  if (!isSemanticTargetId(target) || !getTargetCatalogEntry(target)) throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET", { target });
  return target;
}

export const targetSortKey = (target: string) => target;
