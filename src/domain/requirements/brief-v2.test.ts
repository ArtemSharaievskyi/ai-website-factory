import { describe, expect, it } from "vitest";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { applyBriefRevisionSemantics, extractBriefRevisionIntent, validateBriefRevisionSemantics } from "./revision";
import { briefApprovalBlockers, validateBriefContradictions } from "./brief-validation";
import { getEffectiveBriefRequirements, isSimulationProhibitionRequirement } from "./effective";
import { emptyBriefV2Fields } from "./brief";
import { ProjectBriefV2Schema, RequirementSpecificationSchema } from "./schema";

const entry = (id: string, statement: string) => ({ id, statement, sourceRefs: [`synthetic:${id}`] });
const legacyRaw = {
  schemaVersion: 1 as const,
  documentType: "requirements" as const,
  projectId: "11111111-1111-4111-8111-111111111111",
  projectVersion: 1,
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
  projectSummary: "Present a local workshop.",
  protectedFunctionalityRequired: false,
  imagesRequired: true,
  businessGoals: ["Reach local customers."],
  targetAudiences: ["Local visitors."],
  pages: [{ slug: "home", purpose: "Explain the offer." }],
  userRoles: [],
  features: ["Service overview."],
  forms: ["Contact form."],
  contentRequirements: ["Use supplied business facts."],
  backendRequirements: [],
  supabaseRequirements: [],
  authenticationDecision: "no-authentication-guest-first" as const,
  storageDecision: "not-needed" as const,
  emailDecision: "not-needed" as const,
  administrationDecision: "not-needed" as const,
  seoRequirements: ["Local workshop."],
  localization: { locales: ["de" as const], defaultLocale: "de" as const },
  imageSourceDecision: "user-supplied" as const,
  suppliedBrandInformation: { status: "provided" as const, value: "Supplied identity." },
  suppliedLogoLocation: { status: "provided" as const, value: "Primary logo asset." },
  technicalConstraints: ["No invented facts."],
  explicitExclusions: [],
  userAcceptanceCriteria: ["Visitor can contact the workshop."],
  unresolvedItems: [],
  approval: { approved: false },
  contactFacts: [],
  legalFacts: [],
  brandFacts: ["Supplied identity."],
  logoMetadata: ["Primary logo asset."],
  imageSourcingNotes: [],
  evidence: [],
  recommendations: [],
  briefStatus: "draft" as const,
  briefVersion: 1,
};

const v2Brief = () => ProjectBriefV2Schema.parse({
  ...RequirementSpecificationSchema.parse(legacyRaw),
  ...emptyBriefV2Fields(),
  brandVisualRequirements: {
    colorDirection: [entry("color", "Deep navy with warm copper accents.")],
    typographyDirection: [entry("type", "Readable editorial sans serif.")],
    spacingLayoutDirection: [entry("layout", "Generous spacing and a calm grid.")],
    cardSurfaceStyling: [entry("surface", "Quiet surfaces with restrained borders.")],
    iconDirection: [entry("icons", "Use a simple line icon family.")],
    imageryDirection: [entry("imagery", "Use realistic professional workshop photography.")],
    brandReferenceUsage: [entry("brand-reference", "The supplied logo is authoritative.")],
    visualAntiPatterns: [entry("anti-template", "Avoid generic template styling.")],
  },
  content: [entry("content", "Use concise, factual service copy.")],
  technical: [entry("technical", "Keep the solution static and bounded.")],
  assetRequirements: {
    requiredAssets: [{ reference: "asset:primary-logo", role: "logo", usage: "Use the supplied primary logo.", replacementForbidden: true, sourceRefs: ["synthetic:logo"] }],
    additionalImagery: { allowed: true, sourcingPolicy: [entry("image-source", "Use realistic professional photography." )], realisticProfessional: true, avoidArtificialLook: true },
  },
  formBehaviorRequirements: {
    formPresent: true,
    validation: "ACTIVE",
    successUx: "SIMULATED",
    dataTransmission: "NONE",
    persistence: "NONE",
    thirdParty: "NONE",
    privacyCheckbox: "OPTIONAL",
    interactionStates: [entry("form-state", "Show local validation and a simulated success state.")],
  },
  uxResponsiveRequirements: {
    mobileFirst: true,
    responsiveBehavior: [entry("responsive", "Reflow content cleanly on narrow screens.")],
    stickyMobileCta: true,
    smoothScroll: true,
    reducedMotion: true,
    interactionRequirements: [entry("interaction", "Keep the primary contact action obvious.")],
  },
  seoMetadata: {
    primaryKeywords: ["Fahrradwerkstatt Gießen", "Fahrradreparatur Gießen"],
    exactTitle: "Fahrradwerkstatt Gießen | VeloFix",
    exactMetaDescription: "Lokale Fahrradreparatur in Gießen mit persönlicher Beratung.",
    locationTargeting: [entry("location", "Target Gießen and the surrounding region.")],
    pageMetadata: [{ route: "/", title: "Fahrradwerkstatt Gießen | VeloFix", metaDescription: "Lokale Fahrradreparatur in Gießen.", keywords: ["Fahrradwerkstatt Gießen"], sourceRefs: ["synthetic:seo"] }],
  },
  legalComplianceConstraints: { constraints: [entry("legal", "Keep legal routes explicit and use marked placeholders." )], placeholderPolicy: "USE_EXPLICIT_PLACEHOLDERS", inventedFactsForbidden: true },
  prohibitedRequirements: [entry("prohibited-facts", "Do not invent business facts.")],
  deferredIntegrations: [
    { integration: "email", status: "DEFERRED", rationale: "No real transmission is approved.", sourceRefs: ["synthetic:deferred-email"] },
    { integration: "database", status: "DEFERRED", rationale: "Persistence remains out of scope.", sourceRefs: ["synthetic:deferred-database"] },
  ],
  decisions: [
    { key: "dependency-authority", value: "Use the approved factory dependency policy.", status: "CONFIRMED", sourceRefs: ["synthetic:decision"] },
    { key: "form-transmission", value: "NONE", status: "CONFIRMED", sourceRefs: ["synthetic:decision"] },
  ],
});

describe("Project Brief V2 canonical contract", () => {
  it("BCV1-BCV12: keeps legacy V1 parsing and checksum stable while exposing V2 explicitly", () => {
    const legacy = RequirementSpecificationSchema.parse(legacyRaw);
    const reparsed = RequirementSpecificationSchema.parse(legacy);
    expect(legacy.briefSchemaVersion).toBeUndefined();
    expect(reparsed).toEqual(legacy);
    expect(checksumPersistedDocument(reparsed)).toBe(checksumPersistedDocument(legacy));
    expect(v2Brief().briefSchemaVersion).toBe(2);
  });

  it("BCV13-BCV32: carries first-class visual, asset, UX, SEO, legal, prohibited, deferred, decision, and form behavior data", () => {
    const brief = v2Brief();
    expect(brief.brandVisualRequirements.colorDirection[0]?.statement).toContain("navy");
    expect(brief.content[0]?.statement).toContain("factual");
    expect(brief.technical[0]?.statement).toContain("bounded");
    expect(brief.assetRequirements.requiredAssets[0]?.reference).toBe("asset:primary-logo");
    expect(brief.formBehaviorRequirements).toMatchObject({ successUx: "SIMULATED", dataTransmission: "NONE", persistence: "NONE" });
    expect(brief.uxResponsiveRequirements.mobileFirst).toBe(true);
    expect(brief.seoMetadata.exactTitle).toBe("Fahrradwerkstatt Gießen | VeloFix");
    expect(brief.seoMetadata.exactMetaDescription).toContain("Gießen");
    expect(brief.seoMetadata.primaryKeywords).toContain("Fahrradwerkstatt Gießen");
    expect(brief.legalComplianceConstraints.placeholderPolicy).toBe("USE_EXPLICIT_PLACEHOLDERS");
    expect(brief.prohibitedRequirements[0]?.statement).toContain("Do not invent");
    expect(brief.deferredIntegrations.map((item) => item.integration)).toEqual(["email", "database"]);
    expect(brief.decisions).toHaveLength(2);
  });

  it("BCV33-BCV48: binds asset traceability without storage paths or binary payloads and changes checksum when V2 changes", () => {
    const brief = v2Brief();
    expect(() => ProjectBriefV2Schema.parse({ ...brief, assetRequirements: { ...brief.assetRequirements, requiredAssets: [{ ...brief.assetRequirements.requiredAssets[0]!, reference: "public/uploads/logo.svg" }] } })).toThrow();
    expect(JSON.stringify(brief.assetRequirements)).not.toMatch(/base64|data:image|public\//i);
    const changed = ProjectBriefV2Schema.parse({ ...brief, seoMetadata: { ...brief.seoMetadata, exactTitle: "Different title" } });
    expect(checksumPersistedDocument(changed)).not.toBe(checksumPersistedDocument(brief));
  });

  it("BRO1-BRO20 and BCD1-BCD8: detects typed simulation/prohibition contradictions with a safe approval blocker", () => {
    const contradictory = ProjectBriefV2Schema.parse({ ...v2Brief(), prohibitedRequirements: [entry("fake-success", "No successful submission may be faked.")] });
    expect(validateBriefContradictions(contradictory).map((item) => item.code)).toContain("FORM_SUCCESS_SIMULATION_CONFLICT");
    expect(briefApprovalBlockers(contradictory)).toContain("BRIEF_CONTRADICTION_DETECTED:FORM_SUCCESS_SIMULATION_CONFLICT");
    expect(contradictory.approval.approved).toBe(false);
  });

  it("BRO21-BRO40 and BCD9-BCD20: applies ADD/UPDATE/REPLACE/REMOVE/PRESERVE semantics as a complete candidate", () => {
    const existing = ProjectBriefV2Schema.parse({ ...v2Brief(), prohibitedRequirements: [entry("fake-success", "No successful submission may be faked.")], briefRevisionInstructions: ["Historical instruction remains recorded."] });
    const instruction = 'Replace "No successful submission may be faked." with "Frontend success is simulated after local validation."; preserve all confirmed requirements.';
    const candidate = ProjectBriefV2Schema.parse({ ...existing, prohibitedRequirements: [entry("simulated-success", "Frontend success is simulated after local validation.")], briefRevisionInstructions: [] });
    const intent = extractBriefRevisionIntent(instruction);
    expect(intent.operations.map((operation) => operation.kind)).toEqual(expect.arrayContaining(["REPLACE", "PRESERVE"]));
    const applied = ProjectBriefV2Schema.parse(applyBriefRevisionSemantics(existing, candidate, instruction).brief);
    expect(applied.prohibitedRequirements.map((item) => item.statement)).not.toContain("No successful submission may be faked.");
    expect(applied.prohibitedRequirements.map((item) => item.statement)).toContain("Frontend success is simulated after local validation.");
    expect(applied.businessGoals).toEqual(existing.businessGoals);
    expect(validateBriefRevisionSemantics(existing, applied, instruction)).toEqual([]);
  });

  it("BCD21-BCD32 and BDV1-BDV14: removal wins over old contradiction history while contradiction-free candidates remain approval-eligible", () => {
    const existing = ProjectBriefV2Schema.parse({ ...v2Brief(), prohibitedRequirements: [entry("old", "No successful submission may be faked.")] });
    const instruction = 'Remove "No successful submission may be faked." and add "Frontend success is simulated after local validation."; preserve all confirmed requirements.';
    const candidate = ProjectBriefV2Schema.parse({ ...existing, prohibitedRequirements: [entry("new", "Frontend success is simulated after local validation.")] });
    const applied = ProjectBriefV2Schema.parse(applyBriefRevisionSemantics(existing, candidate, instruction).brief);
    expect(applied.prohibitedRequirements.map((item) => item.statement)).not.toContain("No successful submission may be faked.");
    expect(briefApprovalBlockers(applied)).toEqual([]);
    expect(applied.approval.approved).toBe(false);
  });

  it("BDV15-BDV28: rejects analytics, logo replacement, route-policy, and real-success transmission contradictions", () => {
    const base = v2Brief();
    const cases = [
      ProjectBriefV2Schema.parse({ ...base, prohibitedRequirements: [entry("analytics-off", "No analytics or tracking.")], features: ["Require analytics tracking."] }),
      ProjectBriefV2Schema.parse({ ...base, features: ["Replace the supplied logo with a generated logo."], assetRequirements: { ...base.assetRequirements, requiredAssets: [{ ...base.assetRequirements.requiredAssets[0]!, replacementForbidden: true }] } }),
      ProjectBriefV2Schema.parse({ ...base, technicalConstraints: ["Single-page only"], pages: [...base.pages, { slug: "impressum", purpose: "Legal route" }] }),
      ProjectBriefV2Schema.parse({ ...base, formBehaviorRequirements: { ...base.formBehaviorRequirements, successUx: "REAL", dataTransmission: "NONE" } }),
      ProjectBriefV2Schema.parse({ ...base, prohibitedRequirements: [entry("analytics-off", "No analytics or tracking.")], deferredIntegrations: [{ integration: "analytics", status: "APPROVED", rationale: "Required for conversion measurement.", sourceRefs: ["synthetic:analytics"] }] }),
      ProjectBriefV2Schema.parse({ ...base, technical: [entry("single-page", "Single-page only")], pages: [...base.pages, { slug: "datenschutz", purpose: "Legal route" }] }),
    ];
    expect(cases.map((brief) => validateBriefContradictions(brief).length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(cases.every((brief) => briefApprovalBlockers(brief).every((reason) => reason.startsWith("BRIEF_CONTRADICTION_DETECTED:")))).toBe(true);
  });

  it("ERA/RPA/FSC: resolves a multilingual legacy exclusion before PRESERVE and keeps it historical only", () => {
    const old = "No successful submission may be faked.";
    const existing = ProjectBriefV2Schema.parse({ ...v2Brief(), explicitExclusions: [old], prohibitedRequirements: [] });
    const candidate = ProjectBriefV2Schema.parse({ ...v2Brief(), explicitExclusions: [], prohibitedRequirements: [entry("simulated-success", "Frontend success is simulated after local validation.")] });
    const instruction = 'Remove "No success may be faked" and add "Frontend success is simulated after local validation."; preserve all confirmed requirements.';
    const appliedResult = applyBriefRevisionSemantics(existing, candidate, instruction);
    const applied = ProjectBriefV2Schema.parse(appliedResult.brief);
    const effective = getEffectiveBriefRequirements(applied);
    expect(appliedResult.diagnostics).toMatchObject({ removeTargetResolved: true, candidateHasOldProhibition: false, candidateHasSimulatedSuccess: true, effectiveHasOldProhibition: false, contradictionAuthority: "CURRENT_EFFECTIVE" });
    expect(effective.explicitExclusions).not.toContain(old);
    expect(effective.formBehaviorRequirements?.successUx).toBe("SIMULATED");
    expect(effective.formBehaviorRequirements?.dataTransmission).toBe("NONE");
    expect(applied.requirementHistory?.some((item) => item.statement === old && item.status === "REMOVED" && item.operation === "REMOVE")).toBe(true);
    expect((effective as unknown as { requirementHistory?: unknown }).requirementHistory).toBeUndefined();
    expect(briefApprovalBlockers(applied)).toEqual([]);
  });

  it("ERA/RPA/FSC: rejects an unapplied REMOVE before contradiction checking and preserves true active conflicts", () => {
    const old = "No successful submission may be faked.";
    const existing = ProjectBriefV2Schema.parse({ ...v2Brief(), explicitExclusions: [old] });
    const retained = ProjectBriefV2Schema.parse({ ...v2Brief(), explicitExclusions: [old], prohibitedRequirements: [entry("simulated-success", "Frontend success is simulated after local validation.")] });
    const instruction = 'Remove "No success may be faked" and add "Frontend success is simulated after local validation."; preserve all confirmed requirements.';
    expect(validateBriefRevisionSemantics(existing, retained, instruction)).toContain("BRIEF_REVISION_REMOVE_NOT_APPLIED");
    expect(briefApprovalBlockers(retained)).toContain("BRIEF_CONTRADICTION_DETECTED:FORM_SUCCESS_SIMULATION_CONFLICT");
    expect(briefApprovalBlockers(ProjectBriefV2Schema.parse({ ...v2Brief(), explicitExclusions: [old] }))).toContain("BRIEF_CONTRADICTION_DETECTED:FORM_SUCCESS_SIMULATION_CONFLICT");
  });

  it("ERA/RPA: rejects PRESERVE/REMOVE on the same target and accepts simulated success with no transmission", () => {
    const old = "No successful submission may be faked.";
    const existing = ProjectBriefV2Schema.parse({ ...v2Brief(), explicitExclusions: [old] });
    const instruction = 'Preserve "No successful submission may be faked." and remove "No successful submission may be faked.".';
    expect(validateBriefRevisionSemantics(existing, existing, instruction)).toContain("REVISION_OPERATION_CONFLICT");
    expect(validateBriefContradictions(ProjectBriefV2Schema.parse({ ...v2Brief(), explicitExclusions: [] }))).toEqual([]);
  });

  it("ERA: resolves UTF-8 legacy prohibition wording across supported languages", () => {
    expect(isSimulationProhibitionRequirement("Kein Erfolg darf vorget\u00e4uscht werden.")).toBe(true);
    expect(isSimulationProhibitionRequirement("\u041d\u0435\u043b\u044c\u0437\u044f \u0438\u043c\u0438\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0443\u0441\u043f\u0435\u0445.")).toBe(true);
    expect(isSimulationProhibitionRequirement("\u041d\u0435 \u043c\u043e\u0436\u043d\u0430 \u0456\u043c\u0456\u0442\u0443\u0432\u0430\u0442\u0438 \u0443\u0441\u043f\u0456\u0445.")).toBe(true);
  });
});
