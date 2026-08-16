import { z } from "zod";
import {
  AnalyticsModeSchema,
  AuthModeSchema,
  BrandReferenceStrategySchema,
  CanonicalAssetValueSchema,
  CanonicalPageValueSchema,
  CanonicalRequirementValueSchema,
  DatabaseModeSchema,
  FormExternalProviderModeSchema,
  FormPersistenceModeSchema,
  FormPrivacyConsentModeSchema,
  FormServerProcessingModeSchema,
  FormSimulationPolicySchema,
  FormTransmissionModeSchema,
  ImageSourceStrategySchema,
  InventedFactsPolicySchema,
  PlaceholderPolicySchema,
  RoutePolicySchema,
} from "@/domain/requirements/v3/schema";
import {
  FixedSetTargetId,
  SEMANTIC_TARGETS,
  SuccessModeSchema,
  TARGET_CATALOG,
  type TargetCatalogEntry,
} from "@/domain/requirements/v3/targets";

export const ProviderRequirementValueSchema = CanonicalRequirementValueSchema.omit({ sourceRefs: true }).strict();
export const ProviderAssetValueSchema = CanonicalAssetValueSchema.omit({ sourceRefs: true }).strict();
export const ProviderPageValueSchema = CanonicalPageValueSchema.omit({ sourceRefs: true }).strict();

type ProviderFixedTargetBinding = { valueType: TargetCatalogEntry["valueType"] };
type ProviderFixedTargetBindings = { [Target in FixedSetTargetId]: ProviderFixedTargetBinding };

/**
 * Exhaustive provider mapping metadata. The key type is derived from the V3
 * target map, so a new fixed SET target cannot compile without a provider decision.
 */
export const PROVIDER_FIXED_TARGET_BINDINGS = {
  [SEMANTIC_TARGETS.FORM_SUCCESS_MODE]: { valueType: "successMode" },
  [SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY]: { valueType: "successPolicy" },
  [SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE]: { valueType: "transmissionMode" },
  [SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE]: { valueType: "persistenceMode" },
  [SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE]: { valueType: "serverProcessingMode" },
  [SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE]: { valueType: "externalProviderMode" },
  [SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE]: { valueType: "privacyConsentMode" },
  [SEMANTIC_TARGETS.DATABASE_MODE]: { valueType: "databaseMode" },
  [SEMANTIC_TARGETS.AUTH_MODE]: { valueType: "authMode" },
  [SEMANTIC_TARGETS.ANALYTICS_MODE]: { valueType: "analyticsMode" },
  [SEMANTIC_TARGETS.ROUTE_POLICY]: { valueType: "routePolicy" },
  [SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY]: { valueType: "brandStrategy" },
  [SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY]: { valueType: "imageStrategy" },
  [SEMANTIC_TARGETS.SEO_TITLE]: { valueType: "title" },
  [SEMANTIC_TARGETS.SEO_META_DESCRIPTION]: { valueType: "metaDescription" },
  [SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY]: { valueType: "placeholderPolicy" },
  [SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY]: { valueType: "inventedFactsPolicy" },
} satisfies ProviderFixedTargetBindings;

/** Explicit support decision for every non-fixed V3 target catalog entry. */
export const PROVIDER_DYNAMIC_TARGET_BINDINGS = [
  "ASSET_COMPANY_LOGO",
  "REQUIREMENT:*",
  "ASSET:*",
  "PAGE:*",
] as const;

const setVariant = <Target extends FixedSetTargetId, Schema extends z.ZodTypeAny>(target: Target, value: Schema) => z.object({
  operation: z.literal("SET"),
  target: z.literal(target),
  value,
}).strict();

const ProviderFixedSetChangeSchema = z.union([
  setVariant(SEMANTIC_TARGETS.FORM_SUCCESS_MODE, SuccessModeSchema),
  setVariant(SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY, FormSimulationPolicySchema.or(z.literal("NOT_APPLICABLE"))),
  setVariant(SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE, FormTransmissionModeSchema),
  setVariant(SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE, FormPersistenceModeSchema),
  setVariant(SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE, FormServerProcessingModeSchema),
  setVariant(SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE, FormExternalProviderModeSchema),
  setVariant(SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE, FormPrivacyConsentModeSchema),
  setVariant(SEMANTIC_TARGETS.DATABASE_MODE, DatabaseModeSchema),
  setVariant(SEMANTIC_TARGETS.AUTH_MODE, AuthModeSchema),
  setVariant(SEMANTIC_TARGETS.ANALYTICS_MODE, AnalyticsModeSchema),
  setVariant(SEMANTIC_TARGETS.ROUTE_POLICY, RoutePolicySchema),
  setVariant(SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY, BrandReferenceStrategySchema),
  setVariant(SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY, ImageSourceStrategySchema),
  setVariant(SEMANTIC_TARGETS.SEO_TITLE, z.string().trim().max(300).nullable()),
  setVariant(SEMANTIC_TARGETS.SEO_META_DESCRIPTION, z.string().trim().max(1000).nullable()),
  setVariant(SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY, PlaceholderPolicySchema),
  setVariant(SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY, InventedFactsPolicySchema),
]);

const ProviderDynamicUpsertChangeSchema = z.union([
  z.object({ operation: z.literal("UPSERT"), target: z.string().regex(/^REQUIREMENT:[A-Za-z0-9_.:-]{1,180}$/), value: ProviderRequirementValueSchema }).strict(),
  z.object({ operation: z.literal("UPSERT"), target: z.string().regex(/^ASSET(?::[A-Za-z0-9_.:-]{1,180}|_COMPANY_LOGO)$/), value: ProviderAssetValueSchema }).strict(),
  z.object({ operation: z.literal("UPSERT"), target: z.string().regex(/^PAGE:[^\r\n]{1,180}$/), value: ProviderPageValueSchema }).strict(),
]);

const ProviderRemoveChangeSchema = z.object({
  operation: z.literal("REMOVE"),
  target: z.string().regex(/^(?:REQUIREMENT:[A-Za-z0-9_.:-]{1,180}|ASSET(?::[A-Za-z0-9_.:-]{1,180}|_COMPANY_LOGO)|PAGE:[^\r\n]{1,180})$/),
}).strict();

export const ProviderBriefChangeSchema = z.union([
  ProviderFixedSetChangeSchema,
  ProviderDynamicUpsertChangeSchema,
  ProviderRemoveChangeSchema,
]);

/** Provider authority is limited to a version marker and semantic operations. */
export const ProviderBriefChangeSetSchema = z.object({
  contractVersion: z.literal(1),
  changes: z.array(ProviderBriefChangeSchema).max(128),
}).strict();

export type ProviderBriefSetChange = z.infer<typeof ProviderFixedSetChangeSchema>;
export type ProviderBriefDynamicUpsertChange = z.infer<typeof ProviderDynamicUpsertChangeSchema>;
export type ProviderBriefRemoveChange = z.infer<typeof ProviderRemoveChangeSchema>;
export type ProviderBriefChange = z.infer<typeof ProviderBriefChangeSchema>;
export type ProviderBriefChangeSet = z.infer<typeof ProviderBriefChangeSetSchema>;

/** Stable supporting context for the model; the schemas remain the executable authority. */
export function providerTargetContract() {
  return TARGET_CATALOG.map((entry) => ({ target: entry.id, operation: entry.operation, valueType: entry.valueType }));
}
