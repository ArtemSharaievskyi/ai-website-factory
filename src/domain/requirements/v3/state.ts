import type { BriefChange } from "./changeset";
import type { CanonicalBriefV3 } from "./schema";
import { SEMANTIC_TARGETS, isAssetTarget, isPageTarget, isRequirementTarget } from "./targets";

export type CanonicalDomain = "form" | "database" | "auth" | "analytics" | "route" | "brand" | "scope" | "seo" | "legal" | "requirements" | "assets" | "pages";

export function targetDomain(target: string): CanonicalDomain {
  if (target.startsWith("FORM_")) return "form";
  if (target === SEMANTIC_TARGETS.DATABASE_MODE) return "database";
  if (target === SEMANTIC_TARGETS.AUTH_MODE) return "auth";
  if (target === SEMANTIC_TARGETS.ANALYTICS_MODE) return "analytics";
  if (target === SEMANTIC_TARGETS.ROUTE_POLICY) return "route";
  if (target === SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY) return "brand";
  if (target === SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY) return "scope";
  if (target === SEMANTIC_TARGETS.SEO_TITLE || target === SEMANTIC_TARGETS.SEO_META_DESCRIPTION) return "seo";
  if (target === SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY || target === SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY) return "legal";
  if (isRequirementTarget(target)) return "requirements";
  if (isAssetTarget(target)) return "assets";
  if (isPageTarget(target)) return "pages";
  return "requirements";
}

export function readSemanticTarget(brief: CanonicalBriefV3, target: string): unknown {
  switch (target) {
    case SEMANTIC_TARGETS.FORM_SUCCESS_MODE: return brief.decisions.form.mode;
    case SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE: return brief.decisions.form.transmissionMode;
    case SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE: return brief.decisions.form.persistenceMode;
    case SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE: return brief.decisions.form.serverProcessingMode;
    case SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE: return brief.decisions.form.externalProviderMode;
    case SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE: return brief.decisions.form.privacyConsentMode;
    case SEMANTIC_TARGETS.DATABASE_MODE: return brief.decisions.database.mode;
    case SEMANTIC_TARGETS.AUTH_MODE: return brief.decisions.auth.mode;
    case SEMANTIC_TARGETS.ANALYTICS_MODE: return brief.decisions.analytics.mode;
    case SEMANTIC_TARGETS.ROUTE_POLICY: return brief.decisions.routePolicy.mode;
    case SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY: return brief.brand.referenceStrategy;
    case SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY: return brief.scope.imageSourceStrategy;
    case SEMANTIC_TARGETS.SEO_TITLE: return brief.seo.exactTitle;
    case SEMANTIC_TARGETS.SEO_META_DESCRIPTION: return brief.seo.exactMetaDescription;
    case SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY: return brief.legal.placeholderPolicy;
    case SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY: return brief.legal.inventedFactsPolicy;
    default:
      if (isRequirementTarget(target)) return brief.requirements.find((entry) => entry.id === target);
      if (isAssetTarget(target)) return brief.assets.find((entry) => entry.id === target);
      if (isPageTarget(target)) return brief.pages.find((entry) => entry.id === target);
      return undefined;
  }
}

export function changeValueForState(change: BriefChange): unknown {
  if (change.operation === "REMOVE") return undefined;
  if (change.operation === "SET") return change.value;
  return { ...change.value, id: change.target };
}
