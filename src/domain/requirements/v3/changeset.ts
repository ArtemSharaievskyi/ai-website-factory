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
  FormTransmissionModeSchema,
  ImageSourceStrategySchema,
  InventedFactsPolicySchema,
  PlaceholderPolicySchema,
} from "./schema";
import {
  AssetTargetId,
  DynamicPageTargetId,
  DynamicRequirementTargetId,
  FixedSetTargetId,
  FixedTargetValueMap,
  SEMANTIC_TARGETS,
  SuccessModeSchema,
} from "./targets";
import { BriefV3Error } from "./errors";

const SourceRefsSchema = z.array(z.string().trim().min(1).max(200)).min(1);
const OptionalSourceRefsSchema = z.array(z.string().trim().min(1).max(200)).optional();

/** The target/value relation is explicit for every fixed semantic target. */
export type BriefSetChange = {
  [Target in FixedSetTargetId]: {
    operation: "SET";
    target: Target;
    value: FixedTargetValueMap[Target];
    sourceRefs?: string[];
  };
}[FixedSetTargetId];

export type BriefUpsertChange =
  | { operation: "UPSERT"; target: DynamicRequirementTargetId; value: z.infer<typeof CanonicalRequirementValueSchema>; sourceRefs?: string[] }
  | { operation: "UPSERT"; target: AssetTargetId; value: z.infer<typeof CanonicalAssetValueSchema>; sourceRefs?: string[] }
  | { operation: "UPSERT"; target: DynamicPageTargetId; value: z.infer<typeof CanonicalPageValueSchema>; sourceRefs?: string[] };

export type BriefRemoveChange = { operation: "REMOVE"; target: DynamicRequirementTargetId | AssetTargetId | DynamicPageTargetId; sourceRefs?: string[] };
export type BriefChange = BriefSetChange | BriefUpsertChange | BriefRemoveChange;
export type BriefUnresolved = { target: string; reason: string; sourceRefs: string[] };
export type BriefChangeSet = { contractVersion: 1; changes: BriefChange[]; unresolved: BriefUnresolved[] };

const setVariant = <T extends z.ZodType>(target: string, value: T) => z.object({
  operation: z.literal("SET"),
  target: z.literal(target),
  value,
  sourceRefs: OptionalSourceRefsSchema,
}).strict();

export const BriefChangeSchema = z.union([
  setVariant(SEMANTIC_TARGETS.FORM_SUCCESS_MODE, SuccessModeSchema),
  setVariant(SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY, z.enum(["ALLOWED", "FORBIDDEN", "UNRESOLVED", "NOT_APPLICABLE"])),
  setVariant(SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE, FormTransmissionModeSchema),
  setVariant(SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE, FormPersistenceModeSchema),
  setVariant(SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE, FormServerProcessingModeSchema),
  setVariant(SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE, FormExternalProviderModeSchema),
  setVariant(SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE, FormPrivacyConsentModeSchema),
  setVariant(SEMANTIC_TARGETS.DATABASE_MODE, DatabaseModeSchema),
  setVariant(SEMANTIC_TARGETS.AUTH_MODE, AuthModeSchema),
  setVariant(SEMANTIC_TARGETS.ANALYTICS_MODE, AnalyticsModeSchema),
  setVariant(SEMANTIC_TARGETS.ROUTE_POLICY, z.enum(["SINGLE_PAGE", "MULTI_PAGE", "UNRESOLVED"])),
  setVariant(SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY, BrandReferenceStrategySchema),
  setVariant(SEMANTIC_TARGETS.BRAND_SUPPLIED_INFORMATION, z.string().trim().max(2000).nullable()),
  setVariant(SEMANTIC_TARGETS.BRAND_SUPPLIED_LOGO_DESCRIPTION, z.string().trim().max(2000).nullable()),
  setVariant(SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY, ImageSourceStrategySchema),
  setVariant(SEMANTIC_TARGETS.SEO_TITLE, z.string().trim().max(300).nullable()),
  setVariant(SEMANTIC_TARGETS.SEO_META_DESCRIPTION, z.string().trim().max(1000).nullable()),
  setVariant(SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY, PlaceholderPolicySchema),
  setVariant(SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY, InventedFactsPolicySchema),
  z.object({
    operation: z.literal("UPSERT"),
    target: z.string().regex(/^REQUIREMENT:[A-Za-z0-9_.:-]{1,180}$/),
    value: CanonicalRequirementValueSchema,
    sourceRefs: OptionalSourceRefsSchema,
  }).strict(),
  z.object({
    operation: z.literal("UPSERT"),
    target: z.string().regex(/^ASSET(?::[A-Za-z0-9_.:-]{1,180}|_COMPANY_LOGO)$/),
    value: CanonicalAssetValueSchema,
    sourceRefs: OptionalSourceRefsSchema,
  }).strict(),
  z.object({
    operation: z.literal("UPSERT"),
    target: z.string().regex(/^PAGE:[^\r\n]{1,180}$/),
    value: CanonicalPageValueSchema,
    sourceRefs: OptionalSourceRefsSchema,
  }).strict(),
  z.object({
    operation: z.literal("REMOVE"),
    target: z.string().regex(/^(?:REQUIREMENT:[A-Za-z0-9_.:-]{1,180}|ASSET(?::[A-Za-z0-9_.:-]{1,180}|_COMPANY_LOGO)|PAGE:[^\r\n]{1,180})$/),
    sourceRefs: OptionalSourceRefsSchema,
  }).strict(),
]);

export const BriefChangeSetSchema = z.object({
  contractVersion: z.literal(1),
  changes: z.array(BriefChangeSchema),
  unresolved: z.array(z.object({
    target: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(2000),
    sourceRefs: SourceRefsSchema,
  }).strict()),
}).strict();

export function parseBriefChangeSet(input: unknown): BriefChangeSet {
  const result = BriefChangeSetSchema.safeParse(input);
  if (!result.success) throw new BriefV3Error("BRIEF_V3_CHANGESET_INVALID", { issue: result.error.issues[0]?.message ?? "invalid changeset" });
  return result.data as BriefChangeSet;
}
