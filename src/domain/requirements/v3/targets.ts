import { createHash } from "node:crypto";
import {
  AnalyticsModeSchema,
  AuthModeSchema,
  BrandReferenceStrategySchema,
  CanonicalAssetValueSchema,
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
  ROUTE_POLICY: "ROUTE_POLICY",
  BRAND_REFERENCE_STRATEGY: "BRAND_REFERENCE_STRATEGY",
  BRAND_SUPPLIED_INFORMATION: "BRAND_SUPPLIED_INFORMATION",
  BRAND_SUPPLIED_LOGO_DESCRIPTION: "BRAND_SUPPLIED_LOGO_DESCRIPTION",
  IMAGE_SOURCE_STRATEGY: "IMAGE_SOURCE_STRATEGY",
  SEO_TITLE: "SEO_TITLE",
  SEO_META_DESCRIPTION: "SEO_META_DESCRIPTION",
  LEGAL_PLACEHOLDER_POLICY: "LEGAL_PLACEHOLDER_POLICY",
  LEGAL_INVENTED_FACTS_POLICY: "LEGAL_INVENTED_FACTS_POLICY",
  ASSET_COMPANY_LOGO: "ASSET_COMPANY_LOGO",
} as const;

export type FixedSemanticTargetId = typeof SEMANTIC_TARGETS[keyof typeof SEMANTIC_TARGETS];
export type DynamicRequirementTargetId = `REQUIREMENT:${string}`;
export type DynamicAssetTargetId = `ASSET:${string}`;
export type DynamicPageTargetId = `PAGE:${string}`;
export type AssetTargetId = DynamicAssetTargetId | typeof SEMANTIC_TARGETS.ASSET_COMPANY_LOGO;
export type SemanticTargetId = FixedSemanticTargetId | DynamicRequirementTargetId | DynamicAssetTargetId | DynamicPageTargetId;

export const SEMANTIC_TARGET_ID_PATTERN = /^(?:FORM_[A-Z_]+|DATABASE_MODE|AUTH_MODE|ANALYTICS_MODE|ROUTE_POLICY|BRAND_REFERENCE_STRATEGY|BRAND_SUPPLIED_INFORMATION|BRAND_SUPPLIED_LOGO_DESCRIPTION|IMAGE_SOURCE_STRATEGY|SEO_TITLE|SEO_META_DESCRIPTION|LEGAL_[A-Z_]+|ASSET_COMPANY_LOGO|REQUIREMENT:[A-Za-z0-9_.:-]{1,180}|ASSET:[A-Za-z0-9_.:-]{1,180}|PAGE:[^\r\n]{1,180})$/;

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
  [SEMANTIC_TARGETS.ROUTE_POLICY]: z.infer<typeof RoutePolicySchema>;
  [SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY]: z.infer<typeof BrandReferenceStrategySchema>;
  [SEMANTIC_TARGETS.BRAND_SUPPLIED_INFORMATION]: string | null;
  [SEMANTIC_TARGETS.BRAND_SUPPLIED_LOGO_DESCRIPTION]: string | null;
  [SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY]: z.infer<typeof ImageSourceStrategySchema>;
  [SEMANTIC_TARGETS.SEO_TITLE]: string | null;
  [SEMANTIC_TARGETS.SEO_META_DESCRIPTION]: string | null;
  [SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY]: z.infer<typeof PlaceholderPolicySchema>;
  [SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY]: z.infer<typeof InventedFactsPolicySchema>;
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
  valueType: z.enum(["successMode", "successPolicy", "transmissionMode", "persistenceMode", "serverProcessingMode", "externalProviderMode", "privacyConsentMode", "databaseMode", "authMode", "analyticsMode", "routePolicy", "brandStrategy", "brandSuppliedInformation", "brandSuppliedLogoDescription", "imageStrategy", "title", "metaDescription", "placeholderPolicy", "inventedFactsPolicy", "requirement", "asset", "page"]),
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
  fixed(SEMANTIC_TARGETS.ROUTE_POLICY, "routePolicy"),
  fixed(SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY, "brandStrategy"),
  fixed(SEMANTIC_TARGETS.BRAND_SUPPLIED_INFORMATION, "brandSuppliedInformation"),
  fixed(SEMANTIC_TARGETS.BRAND_SUPPLIED_LOGO_DESCRIPTION, "brandSuppliedLogoDescription"),
  fixed(SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY, "imageStrategy"),
  fixed(SEMANTIC_TARGETS.SEO_TITLE, "title"),
  fixed(SEMANTIC_TARGETS.SEO_META_DESCRIPTION, "metaDescription"),
  fixed(SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY, "placeholderPolicy"),
  fixed(SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY, "inventedFactsPolicy"),
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
  routePolicy: RoutePolicySchema,
  brandStrategy: BrandReferenceStrategySchema,
  brandSuppliedInformation: z.string().trim().max(2000).nullable(),
  brandSuppliedLogoDescription: z.string().trim().max(2000).nullable(),
  imageStrategy: ImageSourceStrategySchema,
  title: z.string().trim().max(300).nullable(),
  metaDescription: z.string().trim().max(1000).nullable(),
  placeholderPolicy: PlaceholderPolicySchema,
  inventedFactsPolicy: InventedFactsPolicySchema,
  requirement: CanonicalRequirementValueSchema,
  asset: CanonicalAssetValueSchema,
  page: CanonicalPageValueSchema,
} as const;

export function assertKnownTarget(target: string): SemanticTargetId {
  if (!isSemanticTargetId(target) || !getTargetCatalogEntry(target)) throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET", { target });
  return target;
}

export const targetSortKey = (target: string) => target;
