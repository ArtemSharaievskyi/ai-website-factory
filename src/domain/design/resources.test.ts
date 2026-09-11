import { describe, expect, it } from "vitest";
import {
  AceternityComponentCandidateSchema,
  authorizeAceternityInstallation,
  createNextFontGoogleImplementation,
  evaluatePaletteSelection,
  proposeAceternityComponent,
  validateGoogleFontRuntimePrivacy,
  validateTypographySelection,
  type TypographyCandidate,
} from "./resources";

const checksum = "a".repeat(64);
const typographyCandidate: TypographyCandidate = {
  family: "Fraunces",
  category: "serif",
  visualPersonality: "Editorial and literary.",
  readabilityNotes: "Use for considered display hierarchy.",
  languageCoverage: ["latin", "latin-ext"],
  availableWeights: [400, 600, 700],
  variableFont: false,
  performanceNotes: "Self-host only approved weights.",
  sourceChecksum: checksum,
};

const typographySelection = {
  primaryFamily: "Fraunces",
  source: "GOOGLE_FONTS" as const,
  rationale: "Approved editorial contrast supports the selected direction.",
  headingUse: "Page and section headings",
  bodyUse: "Use a readable system fallback for body copy",
  weights: [400, 700],
  variableFont: false,
  languageCoverage: ["latin", "latin-ext"],
  implementation: "NEXT_FONT_GOOGLE_SELF_HOSTED" as const,
  fallbackStack: ["Georgia", "serif"],
  approvedByDesign: true,
  runtimeExternalRequest: false as const,
};

const componentCandidate = AceternityComponentCandidateSchema.parse({
  source: "ACETERNITY_UI",
  registryNamespace: "@aceternity",
  componentName: "spotlight",
  kind: "COMPONENT",
  description: "A bounded spotlight primitive.",
  sourceReference: "https://ui.aceternity.com/registry/spotlight.json",
  sourceChecksum: checksum,
  retrievedAt: "2026-09-11T00:00:00.000Z",
  liveEvidence: true,
  writeAuthority: "NONE",
  dependencies: ["framer-motion"],
  registryDependencies: [],
  motionCharacteristics: "Normalize motion to the approved tokens.",
  clientJsCost: "MINIMAL_CLIENT_ISLAND",
  entitlement: {
    source: "Aceternity UI",
    resourceIdentifier: "spotlight",
    tier: "PREMIUM",
    entitlementVerified: false,
    usageScope: "Generated end product only",
  },
  licenseReference: "https://ui.aceternity.com/licence",
  disposition: "INSPECTED_NOT_SELECTED",
  decisionReason: "Synthetic read-only inspection.",
});

const selection = proposeAceternityComponent({
  candidate: componentCandidate,
  approvedDesignFit: true,
  interactionPurpose: "Orient the user to the primary action.",
  accessibilityNotes: "Keep focus and text content independent from the visual effect.",
  responsiveNotes: "Disable decorative overflow on narrow viewports.",
  performanceNotes: "Keep the effect inside one minimal client island.",
  dependencyNotes: "Review framer-motion through DependencyGuardian before use.",
  visualDistinctiveness: "Adds a restrained directional cue.",
  contentFit: "Supports the approved editorial hero content.",
  adaptationNotes: ["Map colors to semantic tokens.", "Normalize timing to canonical motion tokens.", "Provide a reduced-motion fallback."],
  dependencyReview: { status: "PENDING", evidenceRef: "dependency-review:pending" },
  clientBoundary: "MINIMAL_CLIENT_ISLAND",
  motionNormalization: "CANONICAL_MOTION_TOKENS",
  reducedMotionFallback: "Render the same content without decorative movement.",
});

describe("frontend design resource contracts", () => {
  it("validates approved Google typography and creates a self-hosted Next font plan", () => {
    expect(validateTypographySelection(typographySelection, typographyCandidate).valid).toBe(true);
    expect(createNextFontGoogleImplementation(typographySelection, typographyCandidate)).toMatchObject({
      importPath: "next/font/google",
      family: "Fraunces",
      requestedWeights: [400, 700],
      runtimeExternalRequest: false,
      onlyRequiredWeights: true,
    });
    expect(createNextFontGoogleImplementation({ ...typographySelection, secondaryFamily: "DM Sans" }, typographyCandidate)).toMatchObject({ secondaryFamily: "DM Sans" });
    expect(validateTypographySelection({ ...typographySelection, weights: [500] }, typographyCandidate).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "TYPOGRAPHY_WEIGHT_UNAVAILABLE", severity: "BLOCKING" }),
    ]));
    expect(validateTypographySelection({ ...typographySelection, primaryFamily: "Inter", rationale: "A default choice for the interface." }).valid).toBe(false);
  });

  it("blocks runtime Google font requests at the implementation boundary", () => {
    expect(validateGoogleFontRuntimePrivacy([{ path: "src/app/layout.tsx", content: "https://fonts.googleapis.com/css2?family=Fraunces" }])).toMatchObject({ status: "BLOCK", runtimeGoogleRequest: true });
    expect(validateGoogleFontRuntimePrivacy([{ path: "src/app/layout.tsx", content: "import { Fraunces } from 'next/font/google'" }])).toMatchObject({ status: "PASS", runtimeGoogleRequest: false });
  });

  it("requires semantic palette adaptation and rejects unchanged Color Hunt copying", () => {
    const candidate = { paletteId: "earth", colors: ["#ffffff", "#000000", "#f0f0f0", "#111111", "#cccccc", "#ffffff"], characteristics: ["earth"], sourceReference: "https://colorhunt.co/palettes/earth", sourceChecksum: checksum, retrievedAt: "2026-09-11T00:00:00.000Z", liveEvidence: true, writeAuthority: "NONE" as const, inspirationOnly: true as const };
    const copied = evaluatePaletteSelection({ candidate, semanticTokens: { background: "#ffffff", foreground: "#000000", surface: "#f0f0f0", primary: "#111111", primaryForeground: "#ffffff", border: "#cccccc" }, rationale: "The approved palette provides the project semantic roles.", adjustments: [], approvedByDesign: true, approvedBrandMatch: false });
    expect(copied).toMatchObject({ valid: false, blindCopy: true });
    expect(copied.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PALETTE_BLIND_COPY" })]));
    const adapted = evaluatePaletteSelection({ candidate, semanticTokens: { background: "#0f172a", foreground: "#f8fafc", surface: "#172033", mutedForeground: "#cbd5e1", primary: "#14b8a6", primaryForeground: "#042f2e" }, rationale: "The palette is adapted into semantic roles for the approved brand direction.", adjustments: ["Shifted the background toward the approved navy."], approvedByDesign: true, approvedBrandMatch: false });
    expect(adapted).toMatchObject({ valid: true, blindCopy: false, accessibility: { status: "PASS" } });
  });

  it("keeps Aceternity discovery separate from installation authority and entitlement", () => {
    expect(selection.installationDisposition).toBe("DISCOVERY_ONLY");
    const premiumSelection = proposeAceternityComponent({ ...selection, dependencyReview: { status: "APPROVED", evidenceRef: "dependency-review:approved" } });
    expect(() => authorizeAceternityInstallation(premiumSelection, { taskAuthorized: true, taskAuthorityReference: "task:frontend-1" })).toThrow("LICENSE_OR_ENTITLEMENT_REQUIRED");
    const freeCandidate = { ...componentCandidate, entitlement: { ...componentCandidate.entitlement, tier: "FREE" as const, entitlementVerified: true, verificationEvidence: "Official registry metadata." } };
    const freeSelection = proposeAceternityComponent({ ...selection, candidate: freeCandidate, dependencyReview: { status: "APPROVED", evidenceRef: "dependency-review:approved" } });
    expect(authorizeAceternityInstallation(freeSelection, { taskAuthorized: true, taskAuthorityReference: "task:frontend-1" })).toMatchObject({ installationDisposition: "TASK_AUTHORIZED", taskAuthorityReference: "task:frontend-1" });
  });
});
