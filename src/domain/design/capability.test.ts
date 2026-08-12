import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { approveDesignDependencyAmendment, buildDesignDependencyAmendment, DirectionDesignCapabilitySchema, stableDesignChecksum, validateDirectionDesignCapability, validateExactThreeDesignCapabilities } from "./capability";

const hash = (seed: unknown) => stableDesignChecksum(seed);
const capability = (variant: string, suitability: "NONE" | "CSS_NATIVE" | "MOTION" = "CSS_NATIVE") => {
  const colors = ["canvas", "surface", "text", "accent"].map((name) => ({ name, value: `${variant}-${name}`, contrastRole: name === "text" ? "text" as const : name === "accent" ? "accent" as const : name === "canvas" ? "canvas" as const : "surface" as const }));
  const motionBase = { schemaVersion: 1 as const, decisionId: randomUUID(), suitability, purpose: "Clarify state without delay.", navigation: "Short route transition.", sectionEntrance: "Subtle orientation cue.", microinteractions: "Feedback only.", reducedMotionFallback: "Preserve state without movement.", transitionPattern: suitability === "MOTION" ? "interruptible spring" : suitability === "CSS_NATIVE" ? "CSS transform transition" : "none", ...(suitability === "MOTION" ? { dependency: { packageName: "motion" as const, versionSpec: "12.43.0" as const } } : {}) };
  const interaction = { schemaVersion: 1 as const, interactionId: randomUUID(), surface: "primary action", trigger: "activation", states: ["idle", "active"], response: "Show the next state.", transitionStrategy: suitability === "MOTION" ? "MOTION_SPRING" as const : suitability === "CSS_NATIVE" ? "CSS_TRANSITION" as const : "NONE" as const, keyboardBehavior: "Enter and Space activate.", focusBehavior: "Keep visible focus.", reducedMotionBehavior: "Keep state and focus.", requirementReferences: ["brief:projectSummary"] };
  const typographyBase = { schemaVersion: 1 as const, decisionId: randomUUID(), displayFamily: "Fraunces", bodyFamily: "Sora", fallbackStack: ["ui-sans-serif", "system-ui"], normalizedPair: { display: "Fraunces", body: "Sora" }, source: "fontpair" as const, sourceEvidenceChecksum: hash(`${variant}:fontpair`), loadingStrategy: "google-fonts-css" as const, weights: [400, 600], usageRules: ["Use display for hierarchy.", "Use body for reading."] };
  const visual = { schemaVersion: 1 as const, contractId: randomUUID(), tokenChecksum: hash(`${variant}:tokens`), colorTokens: colors, layout: { grid: `${variant} grid`, container: "bounded container", spacingScale: ["0.25rem", "0.5rem", "1rem"], breakpoints: [{ name: "mobile", minWidth: 0 }], density: "moderate" as const }, componentRules: ["Purposeful components.", "Consistent control language."], logoRules: ["Use approved mark only."], antiTemplateRules: ["No filler rows."] };
  const motion = { ...motionBase, checksum: hash(motionBase) };
  const typography = { ...typographyBase, checksum: hash(typographyBase) };
  const interactionWithChecksum = { ...interaction, checksum: hash(interaction) };
  const base = { visualSystem: visual, typography, motion, interactions: [interactionWithChecksum], toolProvenance: [{ toolId: "host-deterministic" as const, status: "AVAILABLE" as const, source: "host-deterministic" as const, sourceVersion: "fixture", sourceChecksum: hash(variant), retrievedAt: "2026-01-01T00:00:00.000Z", liveEvidence: true, contentTrust: "HOST_VALIDATED" as const, redacted: false }], passEvidence: ["fontpair-normalization", "impeccable-semantic-skill", "impeccable-antipattern-detector", "emil-design-review", "emil-animation-review", "transitions-pattern-mapping", "motion-suitability"].map((capabilityId) => ({ capabilityId: capabilityId as never, status: "PASS" as const, evidenceId: `${variant}:${capabilityId}`, summary: "Fixture evidence passed.", checkedAt: "2026-01-01T00:00:00.000Z" })), currentness: { status: "CURRENT" as const, checkedAt: "2026-01-01T00:00:00.000Z" } };
  return DirectionDesignCapabilitySchema.parse({ ...base, contractChecksum: hash(base) });
};

describe("professional design capability contracts", () => {
  it("requires exactly three directions with distinct visual systems", () => {
    const directions = ["editorial", "precision", "dynamic"].map((variant, index) => ({ id: randomUUID(), professionalDesign: capability(variant, index === 2 ? "MOTION" : "CSS_NATIVE") }));
    expect(validateExactThreeDesignCapabilities(directions, { approvedDependencies: new Set(["motion@12.43.0"]) }).valid).toBe(true);
    expect(validateExactThreeDesignCapabilities(directions.slice(0, 2)).valid).toBe(false);
  });

  it("blocks stale, mismatched, unapproved, and non-live evidence", () => {
    const base = capability("precision");
    expect(validateDirectionDesignCapability("direction", { ...base, currentness: { status: "STALE", checkedAt: base.currentness.checkedAt } }).issues[0]?.code).toBe("DESIGN_CONTRACT_STALE");
    expect(validateDirectionDesignCapability("direction", { ...base, typography: { ...base.typography, normalizedPair: { display: "Other", body: base.typography.bodyFamily } } }).issues.some((issue) => issue.code === "TYPOGRAPHY_CONTRACT_MISMATCH")).toBe(true);
    expect(validateDirectionDesignCapability("direction", capability("dynamic", "MOTION")).issues.some((issue) => issue.code === "UNAPPROVED_DESIGN_DEPENDENCY")).toBe(true);
    expect(validateDirectionDesignCapability("direction", base, { requireLiveEvidence: true }).issues.some((issue) => issue.code === "DESIGN_TOOL_EVIDENCE_MISSING")).toBe(false);
  });

  it("binds a Motion amendment only after Dependency Authority approval", () => {
    const proposed = buildDesignDependencyAmendment({ amendmentId: randomUUID(), projectId: randomUUID(), projectVersion: 1, directionId: randomUUID(), reason: "The selected direction needs interruptible state transitions.", requestedBy: "user", requestedAt: "2026-01-01T00:00:00.000Z" });
    expect(proposed.status).toBe("PROPOSED");
    const approved = approveDesignDependencyAmendment(proposed, { approvedBy: "user", approvedAt: "2026-01-01T00:01:00.000Z" });
    expect(approved.status).toBe("USER_APPROVED");
    expect(approved.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});
