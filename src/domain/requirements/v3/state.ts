import type { BriefChange } from "./changeset";
import { BriefV3Error } from "./errors";
import type { CanonicalBriefV3 } from "./schema";
import {
  SEMANTIC_TARGETS,
  isAssetTarget,
  isPageTarget,
  isRequirementTarget,
  type SemanticTargetId,
} from "./targets";

const unknownTarget = (target: string): never => {
  throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET", { target });
};

export type CanonicalDomain = "form" | "database" | "auth" | "analytics" | "route" | "brand" | "scope" | "seo" | "legal" | "requirements" | "assets" | "pages";

export function targetDomain(target: SemanticTargetId): CanonicalDomain {
  if (isRequirementTarget(target)) return "requirements";
  if (isAssetTarget(target)) return "assets";
  if (isPageTarget(target)) return "pages";
  switch (target) {
    case SEMANTIC_TARGETS.FORM_SUCCESS_MODE:
    case SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY:
    case SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE:
    case SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE:
    case SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE:
    case SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE:
    case SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE: return "form";
    case SEMANTIC_TARGETS.DATABASE_MODE: return "database";
    case SEMANTIC_TARGETS.AUTH_MODE: return "auth";
    case SEMANTIC_TARGETS.ANALYTICS_MODE: return "analytics";
    case SEMANTIC_TARGETS.ROUTE_POLICY: return "route";
    case SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY: return "brand";
    case SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY: return "scope";
    case SEMANTIC_TARGETS.SEO_TITLE:
    case SEMANTIC_TARGETS.SEO_META_DESCRIPTION: return "seo";
    case SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY:
    case SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY: return "legal";
  }
  return unknownTarget(target);
}

export function readSemanticTarget(brief: CanonicalBriefV3, target: SemanticTargetId): unknown {
  switch (target) {
    case SEMANTIC_TARGETS.FORM_SUCCESS_MODE: return brief.decisions.form.mode;
    case SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY: return brief.decisions.form.simulatedSuccessPolicy;
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
    case SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY: return brief.scope.images.sourceStrategy;
    case SEMANTIC_TARGETS.SEO_TITLE: return brief.seo.exactTitle;
    case SEMANTIC_TARGETS.SEO_META_DESCRIPTION: return brief.seo.exactMetaDescription;
    case SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY: return brief.legal.placeholderPolicy;
    case SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY: return brief.legal.inventedFactsPolicy;
    case SEMANTIC_TARGETS.ASSET_COMPANY_LOGO: return brief.assets.find((entry) => entry.id === target);
    default:
      if (isRequirementTarget(target)) return brief.requirements.find((entry) => entry.id === target);
      if (isAssetTarget(target)) return brief.assets.find((entry) => entry.id === target);
      if (isPageTarget(target)) return brief.pages.find((entry) => entry.id === target);
      return unknownTarget(target);
  }
}

export function changeValueForState(change: BriefChange): unknown {
  if (change.operation === "REMOVE") return undefined;
  if (change.operation === "SET") return change.value;
  return { ...change.value, id: change.target };
}
