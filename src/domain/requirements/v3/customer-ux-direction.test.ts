import { describe, expect, it } from "vitest";
import { applyBriefChangeSet, reduceBriefChangeSet } from "./reducer";
import { cleanBriefV3, representativeV1Brief } from "./fixtures";
import { assertProviderChangesDoNotOverwriteConfirmedCorrections, createBriefConsistencyCorrectionChangeSet } from "./consistency";
import { parseBriefChangeSet } from "./changeset";
import {
  CUSTOMER_UX_DIRECTION_REQUIREMENT_KEYS,
  CustomerUxDirectionCorrectionInputSchema,
  customerUxDirectionDigest,
  deriveCustomerUxDirectionRequirements,
  normalizeCustomerUxDirection,
} from "./customer-ux-direction";
import { CanonicalBriefV3Schema, CustomerUxDirectionSchema } from "./schema";
import { targetValueSchemas } from "./targets";
import { createPlanningOwnedRequirementManifest } from "@/agents/planner/recovery-manifests";
import { buildPlanningPackage, validatePlanningPackageAgainstBrief } from "@/agents/planner/deterministic";
import { canonicalBriefToPlannerBrief } from "@/agents/planner/brief-context";

const projectId = "99999999-9999-4999-8999-999999999999";

const direction = (overrides: Record<string, unknown> = {}) => CustomerUxDirectionSchema.parse({
  metadata: {
    schemaVersion: 1,
    source: "CUSTOMER_CONFIRMATION",
    confirmation: "CUSTOMER_CONFIRMED",
    status: "ACTIVE",
    recordedRevisionId: "synthetic-ux-revision-1",
    evidenceRefs: ["synthetic:customer-confirmation"],
  },
  visual: {
    concept: "CLEAN_INDUSTRIAL_PREMIUM",
    presentationAttributes: ["Clear hierarchy", "Tactile restraint"],
    dominantSurfaceDirection: "Light neutral surfaces with grounded contrast",
    contrastDirection: "Strong readable text contrast",
    accentTreatment: "One restrained accent used for emphasis",
    typographyDirection: "Confident display hierarchy with readable body text",
    brandAssetAuthority: "CUSTOMER_SUPPLIED_AUTHORITATIVE",
    avoidedPatterns: ["Decorative noise", "Generic template styling"],
  },
  audienceAndPositioning: {
    primaryAudienceOrientation: "Local customers seeking a clear service explanation",
    audienceSegments: ["Local homeowners", "Property managers"],
    desiredPerception: ["Trustworthy", "Capable"],
    copyDirection: "Direct, factual, service-oriented guidance",
    prohibitedUnsupportedClaims: ["Invented awards", "Unsupported guarantees"],
  },
  informationArchitecture: {
    onePage: true,
    sections: [
      { id: "HEADER", order: 1, state: "REQUIRED" },
      { id: "HERO", order: 2, state: "REQUIRED" },
      { id: "SERVICE_ORIENTATION", order: 3, state: "REQUIRED" },
      { id: "DETAILED_SERVICES", order: 4, state: "REQUIRED" },
      { id: "CUSTOMER_SITUATIONS", order: 5, state: "OPTIONAL" },
      { id: "PROCESS", order: 6, state: "REQUIRED" },
      { id: "TRUST", order: 7, state: "REQUIRED" },
      { id: "SERVICE_AREA", order: 8, state: "OPTIONAL" },
      { id: "FAQ", order: 9, state: "OPTIONAL" },
      { id: "FINAL_CTA", order: 10, state: "REQUIRED" },
      { id: "FOOTER", order: 11, state: "REQUIRED" },
      { id: "BEFORE_AFTER", order: 12, state: "OMITTED" },
      { id: "REAL_PROJECT_GALLERY", order: 13, state: "OMITTED" },
    ],
  },
  conversionPolicy: {
    allowedChannels: ["DIRECT_PHONE", "DIRECT_EMAIL"],
    forbiddenChannels: ["CONTACT_FORM"],
    primaryCtaIntent: "Start a direct conversation",
    secondaryCtaIntent: "Read the service orientation",
    dataCollectionForm: "FORBIDDEN",
  },
  imageEvidencePolicy: {
    realProjectPhotography: "UNAVAILABLE",
    beforeAfter: "OMITTED",
    aiSupportingImagery: "ALLOWED_NON_EVIDENTIARY",
    stockImagery: "FORBIDDEN",
    aiOrStockEmployeeRepresentation: "FORBIDDEN",
    protectedLogo: "AUTHORITATIVE_NON_REPLACEABLE",
    missingImagery: "NON_BLOCKER",
  },
  trustPolicy: {
    allowedTrustSignals: ["Confirmed service scope", "Clear contact route"],
    forbiddenUnsupportedTrustSignals: ["Fake reviews", "Fabricated project counts"],
  },
  motionAndInteraction: {
    allowedInteractionPatterns: ["Purposeful reveal"],
    avoidedInteractionPatterns: ["Auto-rotating content"],
    reducedMotion: "REQUIRED",
    keyboardOperability: "REQUIRED",
    noHoverOnlyCriticalActions: true,
  },
  mobileAccessibility: {
    mobileFirst: true,
    directTelephoneEmailActions: true,
    minimumTargetSizeDirection: "Use comfortably tappable controls",
    overflowAvoidance: "REQUIRED",
    focusVisibility: "REQUIRED",
    semanticHtml: "REQUIRED",
    accessibilityTarget: "WCAG_2_2_AA",
    altText: "REQUIRED",
    screenReaderKeyboardConsiderations: ["Preserve reading order", "Announce state changes"],
  },
  performance: {
    coreWebVitalsOrientation: "TARGET_ORIENTED",
    lcpTargetMs: 2500,
    clsTarget: 0.1,
    inpTargetMs: 200,
    minimalUnnecessaryClientJavascript: true,
    responsiveImages: "REQUIRED",
    thirdPartyScriptPolicy: "FORBID_UNAPPROVED",
    targetsAreNonContractual: true,
  },
  seoAndLocalDirection: {
    contentLanguage: "en",
    headingHierarchy: "SEMANTIC_ORDER",
    localRelevance: "USE_CONFIRMED_GEOGRAPHY",
    structuredData: "CONFIRMED_FACTS_ONLY",
    metadataPolicy: "CONFIRMED_CONTENT_ONLY",
    sitemapRobotsCanonical: "MAINTAIN_CANONICAL_METADATA",
    keywordStuffing: "FORBIDDEN",
  },
  creativeFreedom: {
    hardCustomerInvariants: ["Preserve the protected logo", "Do not invent evidence"],
    creativeDirections: ["Use deliberate rhythm", "Compose a distinctive hero"],
    implementationFreedom: ["Choose compatible UI libraries", "Create custom components"],
    allowedUiLibrarySelection: "UNRESTRICTED_COMPATIBLE_LIBRARIES",
    allowedCustomComponents: true,
    boundedBy: ["Brand", "Accessibility", "Performance", "Privacy", "Maintainability"],
  },
  ...overrides,
});

describe("deterministic customer UX direction", () => {
  it("accepts bounded structured customer direction and rejects code or URI payloads", () => {
    const value = direction();
    expect(value.visual.concept).toBe("CLEAN_INDUSTRIAL_PREMIUM");
    expect(() => direction({ visual: { ...value.visual, accentTreatment: "<script>alert(1)</script>" } })).toThrow();
    expect(() => direction({ visual: { ...value.visual, accentTreatment: "https://example.invalid/style.css" } })).toThrow();
    expect(() => direction({ visual: { ...value.visual, accentTreatment: "display: grid;" } })).toThrow();
    expect(() => direction({ visual: { ...value.visual, accentTreatment: "const card = createCard;" } })).toThrow();
    expect(() => direction({ visual: { ...value.visual, accentTreatment: "A return on investment message" } })).not.toThrow();
  });

  it("normalizes unordered semantics and derives exactly ten stable Planning requirements", () => {
    const first = direction();
    const second = direction({ visual: { ...first.visual, presentationAttributes: [...first.visual.presentationAttributes].reverse() }, trustPolicy: { ...first.trustPolicy, allowedTrustSignals: [...first.trustPolicy.allowedTrustSignals].reverse() } });
    expect(customerUxDirectionDigest(first)).toBe(customerUxDirectionDigest(second));
    const requirements = deriveCustomerUxDirectionRequirements({ direction: first, projectId, projectVersion: 1 });
    expect(requirements).toHaveLength(10);
    expect(requirements.map((entry) => entry.id)).toHaveLength(new Set(requirements.map((entry) => entry.id)).size);
    expect(requirements.map((entry) => entry.statement).join(" ")).toContain("CLEAN_INDUSTRIAL_PREMIUM");
    const planningManifest = createPlanningOwnedRequirementManifest({ ...cleanBriefV3, requirements: [...cleanBriefV3.requirements, ...requirements] });
    expect(planningManifest.requirements.map((entry) => entry.requirementId)).toEqual(expect.arrayContaining(requirements.map((entry) => entry.id)));
    expect(CUSTOMER_UX_DIRECTION_REQUIREMENT_KEYS).toEqual([
      "UX_VISUAL_DIRECTION", "UX_AUDIENCE_AND_POSITIONING", "UX_INFORMATION_ARCHITECTURE", "UX_CONVERSION_POLICY", "UX_IMAGE_EVIDENCE_POLICY",
      "UX_TRUST_POLICY", "UX_MOTION_AND_INTERACTION", "UX_MOBILE_ACCESSIBILITY", "UX_PERFORMANCE", "UX_CREATIVE_FREEDOM",
    ]);
  });

  it("registers the typed target and carries the structured direction into deterministic Planning", () => {
    expect(targetValueSchemas.customerUxDirection.parse(direction())).toEqual(direction());
    const canonical = { ...cleanBriefV3, customerUxDirection: direction() };
    const compatible = representativeV1Brief;
    const approvedBrief = canonicalBriefToPlannerBrief(canonical, compatible);
    const planning = buildPlanningPackage({
      projectId: compatible.projectId,
      projectVersion: compatible.projectVersion,
      approvedBrief,
      canonicalBrief: canonical,
      approvedBriefChecksum: "a".repeat(64),
      originalPromptReference: "synthetic-prompt",
      clarificationEvidenceReferences: [],
      currentWorkflowState: "AWAITING_PLANNING_GENERATION",
      existingDecisions: [],
      suppliedFiles: [],
      allowedSkills: [],
      idempotencyKey: "synthetic-planning-operation",
      expectedRowVersion: 1,
    });
    expect(planning.customerUxDirection).toEqual(canonical.customerUxDirection);
  });

  it("keeps missing imagery non-blocking and rejects forbidden contact-form expansion", () => {
    const restrictedCanonical = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, customerUxDirection: direction() });
    const restrictedBrief = canonicalBriefToPlannerBrief(restrictedCanonical, representativeV1Brief);
    const restrictedPlanning = buildPlanningPackage({
      projectId: representativeV1Brief.projectId,
      projectVersion: representativeV1Brief.projectVersion,
      approvedBrief: restrictedBrief,
      canonicalBrief: restrictedCanonical,
      approvedBriefChecksum: "b".repeat(64),
      originalPromptReference: "synthetic-prompt",
      clarificationEvidenceReferences: [],
      currentWorkflowState: "AWAITING_PLANNING_GENERATION",
      existingDecisions: [],
      suppliedFiles: [],
      allowedSkills: [],
      idempotencyKey: "synthetic-planning-restricted",
      expectedRowVersion: 1,
    });
    expect(validatePlanningPackageAgainstBrief(restrictedBrief, restrictedPlanning)).toContain("CUSTOMER_UX_CONTACT_FORM_FORBIDDEN");

    const permittedDirection = direction({ conversionPolicy: { ...direction().conversionPolicy, forbiddenChannels: [], dataCollectionForm: "PERMITTED" } });
    const permittedCanonical = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, scope: { ...cleanBriefV3.scope, images: { required: true, sourceStrategy: "UNRESOLVED" } }, customerUxDirection: permittedDirection });
    const permittedBrief = canonicalBriefToPlannerBrief(permittedCanonical, representativeV1Brief);
    const permittedPlanning = buildPlanningPackage({
      projectId: representativeV1Brief.projectId,
      projectVersion: representativeV1Brief.projectVersion,
      approvedBrief: permittedBrief,
      canonicalBrief: permittedCanonical,
      approvedBriefChecksum: "c".repeat(64),
      originalPromptReference: "synthetic-prompt",
      clarificationEvidenceReferences: [],
      currentWorkflowState: "AWAITING_PLANNING_GENERATION",
      existingDecisions: [],
      suppliedFiles: [],
      allowedSkills: [],
      idempotencyKey: "synthetic-planning-non-blocking-images",
      expectedRowVersion: 1,
    });
    expect(permittedPlanning.blockers).not.toContain("IMAGE_SOURCE_PENDING");
  });

  it("persists through the pure reducer, is replay-idempotent, and rejects a stale supersession", () => {
    const firstDirection = normalizeCustomerUxDirection(direction());
    const correction = CustomerUxDirectionCorrectionInputSchema.parse({ kind: "DETERMINISTIC_CUSTOMER_UX_DIRECTION", direction: firstDirection });
    const changeSet = createBriefConsistencyCorrectionChangeSet({ brief: cleanBriefV3, projectId, projectVersion: 1, correction });
    const first = reduceBriefChangeSet(cleanBriefV3, changeSet);
    expect(first.after.customerUxDirection).toEqual(firstDirection);
    expect(first.after.requirements.filter((entry) => entry.sourceRefs.includes("customer-confirmation:ux-direction"))).toHaveLength(10);
    const replay = reduceBriefChangeSet(first.after, createBriefConsistencyCorrectionChangeSet({ brief: first.after, projectId, projectVersion: 1, correction }));
    expect(replay.changed).toBe(false);
    expect(applyBriefChangeSet(first.after, replay.changeSet)).toEqual(first.after);
    const changed = CustomerUxDirectionCorrectionInputSchema.parse({ kind: "DETERMINISTIC_CUSTOMER_UX_DIRECTION", direction: direction({ metadata: { ...firstDirection.metadata, recordedRevisionId: "synthetic-ux-revision-2" }, visual: { ...firstDirection.visual, accentTreatment: "A restrained accent used for action emphasis" } }), expectedPreviousDigest: customerUxDirectionDigest(firstDirection) });
    expect(createBriefConsistencyCorrectionChangeSet({ brief: first.after, projectId, projectVersion: 1, correction: changed }).changes).toHaveLength(2);
    expect(() => createBriefConsistencyCorrectionChangeSet({ brief: first.after, projectId, projectVersion: 1, correction: { ...changed, expectedPreviousDigest: "a".repeat(64) } })).toThrow("BRIEF_V3_INVALID_COMBINATION");
  });

  it("keeps the target outside the provider-authorable contract", () => {
    const confirmed = applyBriefChangeSet(cleanBriefV3, createBriefConsistencyCorrectionChangeSet({ brief: cleanBriefV3, projectId, projectVersion: 1, correction: CustomerUxDirectionCorrectionInputSchema.parse({ kind: "DETERMINISTIC_CUSTOMER_UX_DIRECTION", direction: direction() }) }));
    const derived = confirmed.requirements.find((entry) => entry.sourceRefs.includes("customer-confirmation:ux-direction"))!;
    expect(() => assertProviderChangesDoNotOverwriteConfirmedCorrections({ brief: confirmed, changeSet: parseBriefChangeSet({ contractVersion: 1, changes: [{ operation: "UPSERT", target: derived.id, value: { category: derived.category, statement: "Provider reinterpretation", sourceRefs: ["provider:brief-v3"] } }], unresolved: [] }) })).toThrow("BRIEF_V3_INVALID_COMBINATION");
  });
});
