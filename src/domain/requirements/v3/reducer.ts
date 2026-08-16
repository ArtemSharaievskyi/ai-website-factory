import { BriefV3Error } from "./errors";
import { normalizeBriefChangeSet, normalizeCanonicalBrief, stableSerialize } from "./normalize";
import { validateCanonicalBriefV3, validateReductionInvariants } from "./invariants";
import { emptyFormBehaviorState, type CanonicalAssetValue, type CanonicalBriefV3, type CanonicalPageValue, type CanonicalRequirementValue, type FormBehaviorState } from "./schema";
import { SEMANTIC_TARGETS, isAssetTarget, isPageTarget, isRequirementTarget } from "./targets";
import type { BriefChange, BriefChangeSet } from "./changeset";

type ActiveForm = Exclude<FormBehaviorState, { mode: "NONE" }>;

const activeFormDefaults = (mode: ActiveForm["mode"]): ActiveForm => {
  const base = {
    formPresent: true as const,
    validation: "ACTIVE" as const,
    persistenceMode: "UNRESOLVED" as const,
    serverProcessingMode: "UNRESOLVED" as const,
    externalProviderMode: "UNRESOLVED" as const,
    privacyConsentMode: "UNRESOLVED" as const,
    interactionStates: [],
  };
  if (mode === "SIMULATED") return { ...base, mode: "SIMULATED", transmissionMode: "NONE" } as Extract<ActiveForm, { mode: "SIMULATED" }>;
  if (mode === "REAL") return { ...base, mode: "REAL", transmissionMode: "UNRESOLVED" } as Extract<ActiveForm, { mode: "REAL" }>;
  return { ...base, mode: "UNRESOLVED", transmissionMode: "UNRESOLVED" } as Extract<ActiveForm, { mode: "UNRESOLVED" }>;
};

const ensureActiveForm = (form: FormBehaviorState): ActiveForm => form.mode === "NONE" ? activeFormDefaults("UNRESOLVED") : form;

function setFormTarget(form: FormBehaviorState, target: string, value: string): FormBehaviorState {
  if (target === SEMANTIC_TARGETS.FORM_SUCCESS_MODE) {
    if (value === "NONE") return emptyFormBehaviorState();
    const next = form.mode === "NONE" ? activeFormDefaults(value as ActiveForm["mode"]) : { ...form, mode: value as ActiveForm["mode"] } as FormBehaviorState;
    if (next.mode === "REAL" && (next as { transmissionMode: string }).transmissionMode === "NONE") return { ...next, transmissionMode: "UNRESOLVED" } as FormBehaviorState;
    return next as FormBehaviorState;
  }
  if (form.mode === "NONE" && value === "NONE") return form;
  const next = ensureActiveForm(form);
  switch (target) {
    case SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE: return { ...next, transmissionMode: value as ActiveForm["transmissionMode"] } as FormBehaviorState;
    case SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE: return { ...next, persistenceMode: value as ActiveForm["persistenceMode"] } as FormBehaviorState;
    case SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE: return { ...next, serverProcessingMode: value as ActiveForm["serverProcessingMode"] } as FormBehaviorState;
    case SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE: return { ...next, externalProviderMode: value as ActiveForm["externalProviderMode"] } as FormBehaviorState;
    case SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE: return { ...next, privacyConsentMode: value as ActiveForm["privacyConsentMode"] } as FormBehaviorState;
    default: throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET", { target });
  }
}

function applySet(brief: CanonicalBriefV3, change: Extract<BriefChange, { operation: "SET" }>): CanonicalBriefV3 {
  const { target, value } = change;
  if (target.startsWith("FORM_")) return { ...brief, decisions: { ...brief.decisions, form: setFormTarget(brief.decisions.form, target, value as string) } };
  switch (target) {
    case SEMANTIC_TARGETS.DATABASE_MODE: return { ...brief, decisions: { ...brief.decisions, database: { mode: value as CanonicalBriefV3["decisions"]["database"]["mode"] } } };
    case SEMANTIC_TARGETS.AUTH_MODE: return { ...brief, decisions: { ...brief.decisions, auth: { mode: value as CanonicalBriefV3["decisions"]["auth"]["mode"] } } };
    case SEMANTIC_TARGETS.ANALYTICS_MODE: return { ...brief, decisions: { ...brief.decisions, analytics: { mode: value as CanonicalBriefV3["decisions"]["analytics"]["mode"] } } };
    case SEMANTIC_TARGETS.ROUTE_POLICY: return { ...brief, decisions: { ...brief.decisions, routePolicy: { mode: value as CanonicalBriefV3["decisions"]["routePolicy"]["mode"] } } };
    case SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY: return { ...brief, brand: { ...brief.brand, referenceStrategy: value as CanonicalBriefV3["brand"]["referenceStrategy"] } };
    case SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY: return { ...brief, scope: { ...brief.scope, imageSourceStrategy: value as CanonicalBriefV3["scope"]["imageSourceStrategy"] } };
    case SEMANTIC_TARGETS.SEO_TITLE: return { ...brief, seo: { ...brief.seo, exactTitle: value as string | null } };
    case SEMANTIC_TARGETS.SEO_META_DESCRIPTION: return { ...brief, seo: { ...brief.seo, exactMetaDescription: value as string | null } };
    case SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY: return { ...brief, legal: { ...brief.legal, placeholderPolicy: value as CanonicalBriefV3["legal"]["placeholderPolicy"] } };
    case SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY: return { ...brief, legal: { ...brief.legal, inventedFactsPolicy: value as CanonicalBriefV3["legal"]["inventedFactsPolicy"] } };
    default: throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET", { target });
  }
}

function applyUpsert(brief: CanonicalBriefV3, change: Extract<BriefChange, { operation: "UPSERT" }>): CanonicalBriefV3 {
  if (isRequirementTarget(change.target)) {
    const value = { ...(change.value as CanonicalRequirementValue), id: change.target };
    return { ...brief, requirements: [...brief.requirements.filter((entry) => entry.id !== change.target), value] };
  }
  if (isAssetTarget(change.target)) {
    const value = { ...(change.value as CanonicalAssetValue), id: change.target };
    return { ...brief, assets: [...brief.assets.filter((entry) => entry.id !== change.target), value] };
  }
  if (isPageTarget(change.target)) {
    const value = { ...(change.value as CanonicalPageValue), id: change.target };
    return { ...brief, pages: [...brief.pages.filter((entry) => entry.id !== change.target), value] };
  }
  throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET", { target: change.target });
}

function applyRemove(brief: CanonicalBriefV3, change: Extract<BriefChange, { operation: "REMOVE" }>): CanonicalBriefV3 {
  if (isRequirementTarget(change.target)) return { ...brief, requirements: brief.requirements.filter((entry) => entry.id !== change.target) };
  if (isAssetTarget(change.target)) return { ...brief, assets: brief.assets.filter((entry) => entry.id !== change.target) };
  if (isPageTarget(change.target)) return { ...brief, pages: brief.pages.filter((entry) => entry.id !== change.target) };
  throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET", { target: change.target });
}

/** The sole V3 current-state mutation function. It has no persistence, provider, or history dependency. */
export function applyBriefChangeSet(current: CanonicalBriefV3, input: BriefChangeSet): CanonicalBriefV3 {
  const currentCanonical = normalizeCanonicalBrief(current);
  validateCanonicalBriefV3(currentCanonical);
  const changeSet = normalizeBriefChangeSet(input);
  let next = currentCanonical;
  for (const change of changeSet.changes) {
    if (change.operation === "SET") next = applySet(next, change);
    else if (change.operation === "UPSERT") next = applyUpsert(next, change);
    else next = applyRemove(next, change);
  }
  if (changeSet.unresolved.length) {
    next = {
      ...next,
      unresolved: [...next.unresolved, ...changeSet.unresolved],
    };
  }
  next = normalizeCanonicalBrief(next);
  validateCanonicalBriefV3(next);
  validateReductionInvariants(currentCanonical, next, changeSet);
  return next;
}

export function isReductionNoOp(current: CanonicalBriefV3, next: CanonicalBriefV3): boolean {
  return stableSerialize(normalizeCanonicalBrief(current)) === stableSerialize(normalizeCanonicalBrief(next));
}
