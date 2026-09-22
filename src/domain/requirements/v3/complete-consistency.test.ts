import { describe, expect, it } from "vitest";
import { cleanBriefV3 } from "./fixtures";
import { applyBriefChangeSet, isReductionNoOp } from "./reducer";
import { parseBriefChangeSet } from "./changeset";
import {
  assertProviderChangesDoNotOverwriteConfirmedCorrections,
  CompleteBriefConsistencyCorrectionInputSchema,
  createBriefConsistencyCorrectionChangeSet,
  validateCanonicalBriefConsistency,
} from "./consistency";
import { CanonicalBriefV3Schema } from "./schema";
import { evaluateBriefReadiness } from "./readiness";

const sourceRefs = ["fixture:customer-confirmation", "fixture:scope-confirmation"];
const publicationInputs = {
  address: { status: "REQUIRED_BEFORE_PUBLICATION" as const, sourceRefs: ["fixture:address"] },
  rapidContact: { status: "REVIEW_REQUIRED" as const, sourceRefs: ["fixture:rapid-contact"] },
  taxIdentifiers: { status: "CONDITIONAL_IF_APPLICABLE" as const, sourceRefs: ["fixture:tax"] },
  registerInformation: { status: "CONDITIONAL_IF_APPLICABLE" as const, sourceRefs: ["fixture:register"] },
  regulatoryAuthority: { status: "CONDITIONAL_IF_APPLICABLE" as const, sourceRefs: ["fixture:authority"] },
};

const correction = {
  kind: "COMPLETE_DETERMINISTIC_BRIEF_CONSISTENCY" as const,
  analyticsMode: "NONE" as const,
  form: { mode: "NONE" as const, formPresent: false as const, transmissionMode: "NONE" as const, persistenceMode: "NONE" as const, serverProcessingMode: "NONE" as const, externalProviderMode: "NONE" as const, privacyConsentMode: "NOT_APPLICABLE" as const },
  protectedFunctionality: false as const,
  classification: { target: "REQUIREMENT:fixture-exclusion", category: "EXCLUSION" as const, sourceRefs },
  serviceScope: { smallWallpaperRepairs: true as const, limitedRaufaserWhitePainting: true as const, disposalPreparation: true as const, regulatedTradeBoundaries: true as const, sourceRefs },
  publicationInputs,
};

function inconsistentBrief() {
  return CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    scope: { ...cleanBriefV3.scope, protectedFunctionality: true },
    decisions: {
      ...cleanBriefV3.decisions,
      form: { mode: "NONE", formPresent: false, validation: "NOT_REQUIRED", simulatedSuccessPolicy: "NOT_APPLICABLE", transmissionMode: "NONE", persistenceMode: "NONE", serverProcessingMode: "NONE", externalProviderMode: "NONE", privacyConsentMode: "NOT_APPLICABLE", interactionStates: [] },
      analytics: { mode: "UNRESOLVED" },
    },
    requirements: [
      ...cleanBriefV3.requirements,
      { id: "REQUIREMENT:fixture-exclusion", category: "BRAND_VISUAL", statement: "Keine Arbeiten an Elektro, Gas, Wasser, Sanitär oder Asbest; preserve the confirmed service scope.", sourceRefs: ["fixture:original"] },
      { id: "REQUIREMENT:fixture-form", category: "DECISION", statement: "form-data-transmission: EMAIL", sourceRefs: ["fixture:stale-form"] },
      { id: "REQUIREMENT:fixture-analytics", category: "DECISION", statement: "analytics: UNRESOLVED", sourceRefs: ["fixture:stale-analytics"] },
      { id: "REQUIREMENT:fixture-no-analytics", category: "PROHIBITED", statement: "No analytics or tracking is enabled.", sourceRefs: ["fixture:no-analytics"] },
    ],
  });
}

describe("complete deterministic Brief consistency correction", () => {
  it("validates a bounded host-owned payload and reconciles all six domains", () => {
    expect(CompleteBriefConsistencyCorrectionInputSchema.safeParse(correction).success).toBe(true);
    const before = inconsistentBrief();
    expect(validateCanonicalBriefConsistency(before).map((issue) => issue.code)).toEqual(expect.arrayContaining(["ANALYTICS_DECISION_CONTRADICTION", "FORM_TRANSMISSION_CONTRADICTION", "PROTECTED_FUNCTIONALITY_CONTRADICTION", "LEGAL_EXCLUSION_CATEGORY"]));
    const changeSet = createBriefConsistencyCorrectionChangeSet({ brief: before, projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, correction });
    const after = applyBriefChangeSet(before, changeSet);

    expect(after.decisions.analytics.mode).toBe("NONE");
    expect(after.decisions.form).toMatchObject({ mode: "NONE", formPresent: false, transmissionMode: "NONE", persistenceMode: "NONE", serverProcessingMode: "NONE", externalProviderMode: "NONE" });
    expect(after.scope.protectedFunctionality).toBe(false);
    expect(after.contact).toEqual(before.contact);
    expect(after.requirements.find((entry) => entry.id === correction.classification.target)).toMatchObject({ category: "EXCLUSION", sourceRefs: expect.arrayContaining(["fixture:original", ...sourceRefs]) });
    expect(after.requirements.some((entry) => entry.statement === "form-data-transmission: EMAIL")).toBe(false);
    expect(after.requirements.some((entry) => entry.statement === "No analytics or tracking is enabled.")).toBe(true);
    expect(after.requirements.filter((entry) => /wallpaper|Raufasertapete|sort(?:ing|ed)|regulated-trade/iu.test(entry.statement))).toHaveLength(4);
    expect(after.requirements.find((entry) => /waste-disposal authorization/iu.test(entry.statement))?.statement).toMatch(/does not grant/i);
    expect(after.requirements.some((entry) => entry.category === "BRAND_VISUAL" && /Elektro|Gas|Asbest/iu.test(entry.statement))).toBe(false);
    expect(after.legal.publicationInputs).toEqual(publicationInputs);
    expect(after.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "LEGAL:ADDRESS", status: "REQUIRED_BEFORE_PUBLICATION", blockingStages: ["PUBLICATION"] }),
      expect.objectContaining({ target: "CONTACT:RAPID_CHANNEL", status: "REVIEW_REQUIRED", blockingStages: ["PUBLICATION"] }),
      expect.objectContaining({ target: "LEGAL:TAX_IDENTIFIERS", status: "CONDITIONAL_IF_APPLICABLE", blockingStages: [] }),
    ]));
    expect(after.unresolved.some((item) => item.target === "CONTACT:PHONE" || item.target === "CONTACT:WHATSAPP")).toBe(false);
    expect(new Set(after.requirements.map((entry) => entry.id)).size).toBe(after.requirements.length);
    expect(validateCanonicalBriefConsistency(after)).toEqual([]);
  });

  it("keeps publication-only data out of approval readiness and fails closed for deployment", () => {
    const after = applyBriefChangeSet(inconsistentBrief(), createBriefConsistencyCorrectionChangeSet({ brief: inconsistentBrief(), projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, correction }));
    const readiness = evaluateBriefReadiness({ brief: after });
    expect(readiness.readyForApproval).toBe(true);
    expect(readiness.publicationReady).toBe(false);
    expect(readiness.publicationBlockers).toEqual(expect.arrayContaining(["REQUIRED_PUBLICATION_INPUTS_MISSING", "PUBLICATION_REVIEW_REQUIRED"]));
    const resolved = { ...after, legal: { ...after.legal, placeholderPolicy: "NO_PLACEHOLDERS" as const, publicationInputs: { address: { status: "RESOLVED" as const, sourceRefs: ["fixture:address"] }, rapidContact: { status: "RESOLVED" as const, sourceRefs: ["fixture:rapid"] }, taxIdentifiers: { status: "NOT_APPLICABLE" as const, sourceRefs: ["fixture:tax"] }, registerInformation: { status: "NOT_APPLICABLE" as const, sourceRefs: ["fixture:register"] }, regulatoryAuthority: { status: "NOT_APPLICABLE" as const, sourceRefs: ["fixture:authority"] } } } };
    const resolvedReadiness = evaluateBriefReadiness({ brief: CanonicalBriefV3Schema.parse({ ...resolved, unresolved: [] }) });
    expect(resolvedReadiness.publicationReady).toBe(true);
  });

  it("is stable on replay and blocks provider overwrites", () => {
    const before = inconsistentBrief();
    const first = applyBriefChangeSet(before, createBriefConsistencyCorrectionChangeSet({ brief: before, projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, correction }));
    const replay = applyBriefChangeSet(first, createBriefConsistencyCorrectionChangeSet({ brief: first, projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, correction }));
    expect(isReductionNoOp(first, replay)).toBe(true);
    expect(() => assertProviderChangesDoNotOverwriteConfirmedCorrections({ brief: first, changeSet: parseBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "ANALYTICS_MODE", value: "APPROVED_PROVIDER" }], unresolved: [] }) })).toThrow();
    expect(() => assertProviderChangesDoNotOverwriteConfirmedCorrections({ brief: first, changeSet: parseBriefChangeSet({ contractVersion: 1, changes: [{ operation: "UPSERT", target: correction.classification.target, value: { category: "BRAND_VISUAL", statement: "Synthetic reclassification.", sourceRefs: ["provider:brief-v3"] } }], unresolved: [] }) })).toThrow();
  });
});
