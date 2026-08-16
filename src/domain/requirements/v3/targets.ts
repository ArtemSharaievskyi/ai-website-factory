import { createHash } from "node:crypto";
import {
  AnalyticsModeSchema,
  AuthModeSchema,
  BrandReferenceStrategySchema,
  CanonicalAssetValueSchema,
  CanonicalPageValueSchema,
  CanonicalRequirementValueSchema,
  DatabaseModeSchema,
  ImageSourceStrategySchema,
  InventedFactsPolicySchema,
  PlaceholderPolicySchema,
  RoutePolicySchema,
} from "./schema";
import { z } from "zod";

export const SEMANTIC_TARGETS = {
  FORM_SUCCESS_MODE: "FORM_SUCCESS_MODE",
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
export type SemanticTargetId = FixedSemanticTargetId | DynamicRequirementTargetId | DynamicAssetTargetId | DynamicPageTargetId;

export const SEMANTIC_TARGET_ID_PATTERN = /^(?:FORM_[A-Z_]+|DATABASE_MODE|AUTH_MODE|ANALYTICS_MODE|ROUTE_POLICY|BRAND_REFERENCE_STRATEGY|IMAGE_SOURCE_STRATEGY|SEO_TITLE|SEO_META_DESCRIPTION|LEGAL_[A-Z_]+|ASSET_COMPANY_LOGO|REQUIREMENT:[A-Za-z0-9_.:-]{1,180}|ASSET:[A-Za-z0-9_.:-]{1,180}|PAGE:[^\r\n]{1,180})$/;

export const isSemanticTargetId = (value: string): value is SemanticTargetId => SEMANTIC_TARGET_ID_PATTERN.test(value);
export const isRequirementTarget = (value: string): value is DynamicRequirementTargetId => value.startsWith("REQUIREMENT:") && isSemanticTargetId(value);
export const isAssetTarget = (value: string): value is DynamicAssetTargetId | typeof SEMANTIC_TARGETS.ASSET_COMPANY_LOGO => (value.startsWith("ASSET:") || value === SEMANTIC_TARGETS.ASSET_COMPANY_LOGO) && isSemanticTargetId(value);
export const isPageTarget = (value: string): value is DynamicPageTargetId => value.startsWith("PAGE:") && isSemanticTargetId(value);
export const pageTargetForSlug = (slug: string): DynamicPageTargetId => {
  const encoded = encodeURIComponent(slug);
  return `PAGE:${encoded.length <= 180 ? encoded : createHash("sha256").update(slug).digest("hex")}`;
};

export const SuccessModeSchema = z.enum(["NONE", "SIMULATED", "REAL", "UNRESOLVED"]);
export const FormTransmissionModeSchema = z.enum(["NONE", "EMAIL", "API", "OTHER", "UNRESOLVED"]);
export const FormPersistenceModeSchema = z.enum(["NONE", "DATABASE", "OTHER", "UNRESOLVED"]);
export const FormServerProcessingModeSchema = z.enum(["NONE", "SERVER", "UNRESOLVED"]);
export const FormExternalProviderModeSchema = z.enum(["NONE", "APPROVED_PROVIDER", "OTHER", "UNRESOLVED"]);
export const FormPrivacyConsentModeSchema = z.enum(["REQUIRED", "OPTIONAL", "NOT_APPLICABLE", "UNRESOLVED"]);

export const TargetCatalogEntrySchema = z.object({
  id: z.string(),
  operation: z.enum(["SET", "UPSERT", "REMOVE"]),
  valueType: z.enum(["successMode", "transmissionMode", "persistenceMode", "serverProcessingMode", "externalProviderMode", "privacyConsentMode", "databaseMode", "authMode", "analyticsMode", "routePolicy", "brandStrategy", "imageStrategy", "title", "metaDescription", "placeholderPolicy", "inventedFactsPolicy", "requirement", "asset", "page"]),
}).strict();
export type TargetCatalogEntry = z.infer<typeof TargetCatalogEntrySchema>;

const fixed = (id: FixedSemanticTargetId, valueType: TargetCatalogEntry["valueType"]): TargetCatalogEntry => ({ id, operation: "SET", valueType });

export const TARGET_CATALOG: readonly TargetCatalogEntry[] = [
  fixed(SEMANTIC_TARGETS.FORM_SUCCESS_MODE, "successMode"),
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
  if (!isSemanticTargetId(target) || !getTargetCatalogEntry(target)) throw new Error(`Unknown V3 target: ${target}`);
  return target;
}

export const targetSortKey = (target: string) => target;
