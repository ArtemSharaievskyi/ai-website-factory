import { BriefV3Error } from "./errors";
import { normalizeBriefChangeSet, normalizeCanonicalBrief } from "./normalize";
import { stableSerialize } from "./serialization";
import { validateCanonicalBriefV3, validateReductionInvariants } from "./invariants";
import {
  emptyFormBehaviorState,
  type CanonicalAsset,
  type CanonicalBriefV3,
  type CanonicalPage,
  type CanonicalRequirement,
  type FormBehaviorState,
} from "./schema";
import {
  type BriefChange,
  type BriefChangeSet,
  type BriefSetChange,
} from "./changeset";
import { SEMANTIC_TARGETS, isAssetTarget, isPageTarget, isRequirementTarget } from "./targets";

type FormTarget =
  | typeof SEMANTIC_TARGETS.FORM_SUCCESS_MODE
  | typeof SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY
  | typeof SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE
  | typeof SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE
  | typeof SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE
  | typeof SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE
  | typeof SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE;

type FormSetChange = Extract<BriefSetChange, { target: FormTarget }>;
type ActiveForm = Exclude<FormBehaviorState, { mode: "NONE" }>;
const unreachableTarget = (value: never): never => {
  throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET", { target: String(value) });
};

const FORM_TARGETS: ReadonlySet<FormTarget> = new Set([
  SEMANTIC_TARGETS.FORM_SUCCESS_MODE,
  SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY,
  SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE,
  SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE,
  SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE,
  SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE,
  SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE,
]);

const isFormSetChange = (change: BriefSetChange): change is FormSetChange => FORM_TARGETS.has(change.target as FormTarget);

const activeFormDefaults = (mode: Exclude<ActiveForm["mode"], "NONE">): ActiveForm => {
  const common = {
    formPresent: true as const,
    validation: "ACTIVE" as const,
    persistenceMode: "UNRESOLVED" as const,
    serverProcessingMode: "UNRESOLVED" as const,
    externalProviderMode: "UNRESOLVED" as const,
    privacyConsentMode: "UNRESOLVED" as const,
    interactionStates: [],
  };
  if (mode === "SIMULATED") return { ...common, mode: "SIMULATED", simulatedSuccessPolicy: "ALLOWED", transmissionMode: "NONE" };
  if (mode === "REAL") return { ...common, mode: "REAL", simulatedSuccessPolicy: "UNRESOLVED", transmissionMode: "UNRESOLVED" };
  return { ...common, mode: "UNRESOLVED", simulatedSuccessPolicy: "UNRESOLVED", transmissionMode: "UNRESOLVED" };
};

const asSimulatedForm = (form: ActiveForm): Extract<FormBehaviorState, { mode: "SIMULATED" }> => ({
  mode: "SIMULATED",
  formPresent: true,
  validation: "ACTIVE",
  simulatedSuccessPolicy: "ALLOWED",
  transmissionMode: form.transmissionMode,
  persistenceMode: form.persistenceMode,
  serverProcessingMode: form.serverProcessingMode,
  externalProviderMode: form.externalProviderMode,
  privacyConsentMode: form.privacyConsentMode,
  interactionStates: form.interactionStates,
});

const asUnresolvedForm = (form: ActiveForm): Extract<FormBehaviorState, { mode: "UNRESOLVED" }> => ({
  mode: "UNRESOLVED",
  formPresent: true,
  validation: "ACTIVE",
  simulatedSuccessPolicy: form.simulatedSuccessPolicy,
  transmissionMode: form.transmissionMode,
  persistenceMode: form.persistenceMode,
  serverProcessingMode: form.serverProcessingMode,
  externalProviderMode: form.externalProviderMode,
  privacyConsentMode: form.privacyConsentMode,
  interactionStates: form.interactionStates,
});

const asUnresolvedFormWithPolicy = (policy: Extract<ActiveForm, { mode: "UNRESOLVED" }>["simulatedSuccessPolicy"]): Extract<FormBehaviorState, { mode: "UNRESOLVED" }> => ({
  ...asUnresolvedForm(activeFormDefaults("UNRESOLVED")),
  simulatedSuccessPolicy: policy,
});

const asRealForm = (form: ActiveForm): Extract<FormBehaviorState, { mode: "REAL" }> => ({
  mode: "REAL",
  formPresent: true,
  validation: "ACTIVE",
  simulatedSuccessPolicy: form.simulatedSuccessPolicy,
  transmissionMode: form.transmissionMode === "NONE" ? "UNRESOLVED" : form.transmissionMode,
  persistenceMode: form.persistenceMode,
  serverProcessingMode: form.serverProcessingMode,
  externalProviderMode: form.externalProviderMode,
  privacyConsentMode: form.privacyConsentMode,
  interactionStates: form.interactionStates,
});

const ensureActiveForm = (form: FormBehaviorState): ActiveForm => form.mode === "NONE" ? activeFormDefaults("UNRESOLVED") : form;

function invalidFormCombination(target: string, value: string): never {
  throw new BriefV3Error("BRIEF_V3_INVALID_COMBINATION", { target, value });
}

function setFormTarget(form: FormBehaviorState, change: FormSetChange): FormBehaviorState {
  switch (change.target) {
    case SEMANTIC_TARGETS.FORM_SUCCESS_MODE: {
      if (change.value === "NONE") return emptyFormBehaviorState();
      if (change.value === "SIMULATED") {
        if (form.mode === "REAL" && form.simulatedSuccessPolicy === "FORBIDDEN") invalidFormCombination(change.target, change.value);
        return form.mode === "NONE" ? activeFormDefaults("SIMULATED") : asSimulatedForm(form);
      }
      if (change.value === "REAL") {
        const current = form.mode === "NONE" ? activeFormDefaults("REAL") : form;
        return asRealForm(current);
      }
      return form.mode === "NONE" ? activeFormDefaults("UNRESOLVED") : asUnresolvedForm(form);
    }
    case SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY: {
      if (form.mode === "NONE") {
        if (change.value === "NOT_APPLICABLE") return form;
        return asUnresolvedFormWithPolicy(change.value);
      }
      if (change.value === "NOT_APPLICABLE") invalidFormCombination(change.target, change.value);
      if (form.mode === "SIMULATED") {
        if (change.value !== "ALLOWED") invalidFormCombination(change.target, change.value);
        return form;
      }
      if (form.mode === "REAL") return { ...form, simulatedSuccessPolicy: change.value };
      return { ...form, simulatedSuccessPolicy: change.value };
    }
    case SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE: {
      if (form.mode === "NONE" && change.value === "NONE") return form;
      const next = ensureActiveForm(form);
      if (next.mode === "REAL") {
        if (change.value === "NONE") invalidFormCombination(change.target, change.value);
        return { ...next, transmissionMode: change.value };
      }
      return { ...next, transmissionMode: change.value };
    }
    case SEMANTIC_TARGETS.FORM_PERSISTENCE_MODE: {
      if (form.mode === "NONE" && change.value === "NONE") return form;
      return { ...ensureActiveForm(form), persistenceMode: change.value };
    }
    case SEMANTIC_TARGETS.FORM_SERVER_PROCESSING_MODE: {
      if (form.mode === "NONE" && change.value === "NONE") return form;
      return { ...ensureActiveForm(form), serverProcessingMode: change.value };
    }
    case SEMANTIC_TARGETS.FORM_EXTERNAL_PROVIDER_MODE: {
      if (form.mode === "NONE" && change.value === "NONE") return form;
      return { ...ensureActiveForm(form), externalProviderMode: change.value };
    }
    case SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE: {
      if (form.mode === "NONE" && change.value === "NOT_APPLICABLE") return form;
      return { ...ensureActiveForm(form), privacyConsentMode: change.value };
    }
  }
  return unreachableTarget(change);
}

function validateFormChangeSetCompatibility(changes: readonly BriefChange[]): void {
  const formChanges = changes.filter((change): change is FormSetChange => change.operation === "SET" && isFormSetChange(change));
  const success = formChanges.find((change) => change.target === SEMANTIC_TARGETS.FORM_SUCCESS_MODE);
  if (success?.value === "NONE") {
    const contradictory = formChanges.find((change) => {
      if (change.target === SEMANTIC_TARGETS.FORM_SUCCESS_MODE) return false;
      if (change.target === SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY) return change.value !== "NOT_APPLICABLE";
      if (change.target === SEMANTIC_TARGETS.FORM_PRIVACY_CONSENT_MODE) return change.value !== "NOT_APPLICABLE";
      return change.value !== "NONE";
    });
    if (contradictory) throw new BriefV3Error("BRIEF_V3_CONFLICTING_OPERATIONS", { target: contradictory.target });
  }
  const transmission = formChanges.find((change) => change.target === SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE);
  if (success?.value === "REAL" && transmission?.value === "NONE") {
    throw new BriefV3Error("BRIEF_V3_CONFLICTING_OPERATIONS", { target: SEMANTIC_TARGETS.FORM_TRANSMISSION_MODE });
  }
  const policy = formChanges.find((change) => change.target === SEMANTIC_TARGETS.FORM_SIMULATED_SUCCESS_POLICY);
  if (success?.value === "SIMULATED" && policy && policy.value !== "ALLOWED") {
    throw new BriefV3Error("BRIEF_V3_CONFLICTING_OPERATIONS", { target: policy.target });
  }
}

function applySet(brief: CanonicalBriefV3, change: BriefSetChange): CanonicalBriefV3 {
  if (isFormSetChange(change)) return { ...brief, decisions: { ...brief.decisions, form: setFormTarget(brief.decisions.form, change) } };
  switch (change.target) {
    case SEMANTIC_TARGETS.DATABASE_MODE: return { ...brief, decisions: { ...brief.decisions, database: { mode: change.value } } };
    case SEMANTIC_TARGETS.AUTH_MODE: return { ...brief, decisions: { ...brief.decisions, auth: { mode: change.value } } };
    case SEMANTIC_TARGETS.ANALYTICS_MODE: return { ...brief, decisions: { ...brief.decisions, analytics: { mode: change.value } } };
    case SEMANTIC_TARGETS.ROUTE_POLICY: return { ...brief, decisions: { ...brief.decisions, routePolicy: { mode: change.value } } };
    case SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY: return { ...brief, brand: { ...brief.brand, referenceStrategy: change.value } };
    case SEMANTIC_TARGETS.IMAGE_SOURCE_STRATEGY: return {
      ...brief,
      scope: { ...brief.scope, images: change.value === "NONE" ? { required: false, sourceStrategy: "NONE" } : { required: true, sourceStrategy: change.value } },
    };
    case SEMANTIC_TARGETS.SEO_TITLE: return { ...brief, seo: { ...brief.seo, exactTitle: change.value } };
    case SEMANTIC_TARGETS.SEO_META_DESCRIPTION: return { ...brief, seo: { ...brief.seo, exactMetaDescription: change.value } };
    case SEMANTIC_TARGETS.LEGAL_PLACEHOLDER_POLICY: return { ...brief, legal: { ...brief.legal, placeholderPolicy: change.value } };
    case SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY: return { ...brief, legal: { ...brief.legal, inventedFactsPolicy: change.value } };
  }
  return unreachableTarget(change);
}

function applyUpsert(brief: CanonicalBriefV3, change: Extract<BriefChange, { operation: "UPSERT" }>): CanonicalBriefV3 {
  type UpsertChange = Extract<BriefChange, { operation: "UPSERT" }>;
  type RequirementUpsert = Extract<UpsertChange, { target: `REQUIREMENT:${string}` }>;
  type AssetUpsert = Extract<UpsertChange, { target: `ASSET:${string}` | "ASSET_COMPANY_LOGO" }>;
  type PageUpsert = Extract<UpsertChange, { target: `PAGE:${string}` }>;
  const isRequirementUpsert = (value: UpsertChange): value is RequirementUpsert => isRequirementTarget(value.target);
  const isAssetUpsert = (value: UpsertChange): value is AssetUpsert => isAssetTarget(value.target);
  const isPageUpsert = (value: UpsertChange): value is PageUpsert => isPageTarget(value.target);
  if (isRequirementUpsert(change)) {
    const value: CanonicalRequirement = { ...change.value, id: change.target };
    return { ...brief, requirements: [...brief.requirements.filter((entry) => entry.id !== change.target), value] };
  }
  if (isAssetUpsert(change)) {
    const value: CanonicalAsset = { ...change.value, id: change.target };
    return { ...brief, assets: [...brief.assets.filter((entry) => entry.id !== change.target), value] };
  }
  if (isPageUpsert(change)) {
    const value: CanonicalPage = { ...change.value, id: change.target };
    return { ...brief, pages: [...brief.pages.filter((entry) => entry.id !== change.target), value] };
  }
  throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET");
}

function applyRemove(brief: CanonicalBriefV3, change: Extract<BriefChange, { operation: "REMOVE" }>): CanonicalBriefV3 {
  if (isRequirementTarget(change.target)) return { ...brief, requirements: brief.requirements.filter((entry) => entry.id !== change.target) };
  if (isAssetTarget(change.target)) return { ...brief, assets: brief.assets.filter((entry) => entry.id !== change.target) };
  if (isPageTarget(change.target)) return { ...brief, pages: brief.pages.filter((entry) => entry.id !== change.target) };
  throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET", { target: change.target });
}

/** The sole V3 current-state mutation function: pure, deterministic, local, and history-free. */
export function applyBriefChangeSet(current: CanonicalBriefV3, input: BriefChangeSet): CanonicalBriefV3 {
  const validatedCurrent = validateCanonicalBriefV3(current);
  const currentCanonical = normalizeCanonicalBrief(validatedCurrent);
  const changeSet = normalizeBriefChangeSet(input);
  validateFormChangeSetCompatibility(changeSet.changes);
  let next = currentCanonical;
  for (const change of changeSet.changes) {
    if (change.operation === "SET") next = applySet(next, change);
    else if (change.operation === "UPSERT") next = applyUpsert(next, change);
    else next = applyRemove(next, change);
  }
  next = changeSet.unresolved.length
    ? { ...next, unresolved: [...next.unresolved, ...changeSet.unresolved] }
    : next;
  next = normalizeCanonicalBrief(next);
  validateCanonicalBriefV3(next);
  validateReductionInvariants(currentCanonical, next, changeSet);
  return next;
}

export function isReductionNoOp(current: CanonicalBriefV3, next: CanonicalBriefV3): boolean {
  return stableSerialize(normalizeCanonicalBrief(current)) === stableSerialize(normalizeCanonicalBrief(next));
}
