import { BriefV3Error } from "@/domain/requirements/v3/errors";
import { normalizeBriefChangeSet } from "@/domain/requirements/v3/normalize";
import { parseBriefChangeSet, type BriefChange, type BriefChangeSet, type BriefSetChange } from "@/domain/requirements/v3/changeset";
import { getTargetCatalogEntry, isAssetTarget, isPageTarget, isRequirementTarget, SEMANTIC_TARGETS } from "@/domain/requirements/v3/targets";
import { BriefV3ProviderError } from "./errors";
import {
  ProviderBriefChangeSetSchema,
  ProviderBriefDynamicUpsertChange,
  ProviderAssetValueSchema,
  ProviderPageValueSchema,
  ProviderRequirementValueSchema,
  ProviderBriefRemoveChange,
  ProviderBriefSetChange,
  type ProviderBriefChange,
} from "./changeset";

const PROVIDER_SOURCE_REF = "provider:brief-v3";

function invalidOutput(fieldPath?: string): never {
  throw new BriefV3ProviderError("BRIEF_V3_PROVIDER_INVALID_OUTPUT", fieldPath ? { fieldPath } : {});
}

function invalidTargetValue(fieldPath = "changes[].value"): never {
  throw new BriefV3ProviderError("BRIEF_V3_PROVIDER_TARGET_VALUE_INVALID", { fieldPath });
}

function assertKnownProviderTarget(value: unknown, fieldPath: string): void {
  if (typeof value !== "string") return;
  if (!getTargetCatalogEntry(value)) throw new BriefV3ProviderError("BRIEF_V3_PROVIDER_UNKNOWN_TARGET", { fieldPath });
}

function inspectUnknownTargets(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const changes = (input as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return;
  changes.forEach((change, index) => {
    if (!change || typeof change !== "object" || Array.isArray(change)) return;
    assertKnownProviderTarget((change as { target?: unknown }).target, `changes[${index}].target`);
  });
}

function mapFixedSetChange(change: ProviderBriefSetChange): BriefSetChange {
  switch (change.target) {
    case SEMANTIC_TARGETS.FORM_SUCCESS_MODE:
    case SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY:
    case SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE:
    case SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE:
    case SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE:
    case SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE:
    case SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE:
    case SEMANTIC_TARGETS.DATABASE_MODE:
    case SEMANTIC_TARGETS.AUTH_MODE:
    case SEMANTIC_TARGETS.ANALYTICS_MODE:
    case SEMANTIC_TARGETS.ROUTE_POLICY:
    case SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY:
    case SEMANTIC_TARGETS.BRAND_SUPPLIED_INFORMATION:
    case SEMANTIC_TARGETS.BRAND_SUPPLIED_LOGO_DESCRIPTION:
    case SEMANTIC_TARGETS.BRAND_MARKETING_NAME:
    case SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY:
    case SEMANTIC_TARGETS.SEO_TITLE:
    case SEMANTIC_TARGETS.SEO_META_DESCRIPTION:
    case SEMANTIC_TARGETS.SEO_PRIMARY_KEYWORDS:
    case SEMANTIC_TARGETS.SEO_LOCATION_TARGETING:
    case SEMANTIC_TARGETS.SEO_PAGE_METADATA:
    case SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY:
    case SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY:
    case SEMANTIC_TARGETS.LEGAL_CONFIRMED_PROPRIETOR:
    case SEMANTIC_TARGETS.BRIEF_TITLE:
    case SEMANTIC_TARGETS.BRIEF_EVIDENCE:
      return change;
    case SEMANTIC_TARGETS.BRIEF_UNRESOLVED:
      return {
        ...change,
        value: change.value.map((item) => {
          if (item.blockingStages === null) {
            return { target: item.target, reason: item.reason, sourceRefs: item.sourceRefs };
          }
          return item;
        }),
      } as BriefSetChange;
  }
  return invalidOutput("changes[].target");
}

function mapDynamicUpsertChange(change: ProviderBriefDynamicUpsertChange): BriefChange {
  if (isRequirementTarget(change.target)) return { operation: "UPSERT", target: change.target, value: { ...ProviderRequirementValueSchema.parse(change.value), sourceRefs: [PROVIDER_SOURCE_REF] } };
  if (isAssetTarget(change.target)) return { operation: "UPSERT", target: change.target, value: { ...ProviderAssetValueSchema.parse(change.value), sourceRefs: [PROVIDER_SOURCE_REF] } };
  if (isPageTarget(change.target)) return { operation: "UPSERT", target: change.target, value: { ...ProviderPageValueSchema.parse(change.value), sourceRefs: [PROVIDER_SOURCE_REF] } };
  return invalidOutput("changes[].target");
}

function mapRemoveChange(change: ProviderBriefRemoveChange): BriefChange {
  if (isRequirementTarget(change.target)) return { operation: "REMOVE", target: change.target };
  if (isAssetTarget(change.target)) return { operation: "REMOVE", target: change.target };
  if (isPageTarget(change.target)) return { operation: "REMOVE", target: change.target };
  return invalidOutput("changes[].target");
}

function mapChange(change: ProviderBriefChange): BriefChange {
  if (change.operation === "SET") return mapFixedSetChange(change);
  if (change.operation === "UPSERT") return mapDynamicUpsertChange(change);
  return mapRemoveChange(change);
}

/** Parse, exhaustively map, and normalize provider intent before it reaches reduction. */
export function mapProviderBriefChangeSet(input: unknown): BriefChangeSet {
  inspectUnknownTargets(input);
  const parsed = ProviderBriefChangeSetSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path.at(-1) === "value") invalidTargetValue(issue.path.map(String).join("."));
    invalidOutput(issue?.path.map(String).join("."));
  }
  const mapped = parseBriefChangeSet({ contractVersion: 1, changes: parsed.data.changes.map(mapChange), unresolved: [] });
  try {
    return normalizeBriefChangeSet(mapped);
  } catch (error) {
    if (error instanceof BriefV3Error) throw error;
    throw new BriefV3ProviderError("BRIEF_V3_PROVIDER_INVALID_OUTPUT");
  }
}
