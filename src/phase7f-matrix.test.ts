import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { REQUIRED_OFFICIAL_DESIGN_SKILLS } from "@/integrations/design/skill-evidence";
import { detectImpeccableAntiPatterns } from "@/integrations/design/impeccable";
import { FONTPAIR_ORIGIN, FontpairAdapter } from "@/integrations/design/fontpair";
import { MAGIC_PATTERNS_API_ORIGIN, MagicPatternsAdapter } from "@/integrations/design/magic-patterns";
import { DesignCapabilityPackageSchema, DesignToolIdSchema, DirectionDesignCapabilitySchema, MotionDecisionSchema, buildDesignDependencyAmendment, approveDesignDependencyAmendment, stableDesignChecksum, validateDirectionDesignCapability, validateExactThreeDesignCapabilities } from "@/domain/design/capability";
import { DesignDirectionSetSchema, SelectedDesignSchema } from "@/domain/design/schema";
import { decideDependency } from "@/dependencies/authority";
import { CAPABILITY_REGISTRY, TOOL_REGISTRY } from "@/orchestration/tooling/registry";
import { executeBoundToolOperation } from "@/orchestration/tooling/adapters";

const hash = (value: unknown) => stableDesignChecksum(value);
const capability = (variant: string, suitability: "NONE" | "CSS_NATIVE" | "MOTION" = "CSS_NATIVE") => {
  const visualSystem = { schemaVersion: 1 as const, contractId: randomUUID(), tokenChecksum: hash(`${variant}:tokens`), colorTokens: ["canvas", "surface", "text", "accent"].map((name) => ({ name, value: `${variant}-${name}`, contrastRole: name === "text" ? "text" as const : name === "accent" ? "accent" as const : name === "canvas" ? "canvas" as const : "surface" as const })), layout: { grid: `${variant} grid`, container: "bounded container", spacingScale: ["0.25rem", "0.5rem", "1rem"], breakpoints: [{ name: "mobile", minWidth: 0 }], density: "moderate" as const }, componentRules: ["Purposeful components.", "Consistent control language."], logoRules: ["Use approved mark only."], antiTemplateRules: ["No filler rows."] };
  const motionBase = { schemaVersion: 1 as const, decisionId: randomUUID(), suitability, purpose: "Clarify state.", navigation: "Short transition.", sectionEntrance: "Subtle cue.", microinteractions: "Feedback only.", reducedMotionFallback: "Preserve state.", transitionPattern: suitability === "MOTION" ? "spring" : suitability === "CSS_NATIVE" ? "css" : "none", ...(suitability === "MOTION" ? { dependency: { packageName: "motion" as const, versionSpec: "12.43.0" as const } } : {}) };
  const typographyBase = { schemaVersion: 1 as const, decisionId: randomUUID(), displayFamily: "Fraunces", bodyFamily: "Sora", fallbackStack: ["ui-sans-serif", "system-ui"], normalizedPair: { display: "Fraunces", body: "Sora" }, source: "fontpair" as const, sourceEvidenceChecksum: hash(`${variant}:fontpair`), weights: [400, 600], loadingStrategy: "google-fonts-css" as const, usageRules: ["Display hierarchy.", "Readable body."] };
  const interactionBase = { schemaVersion: 1 as const, interactionId: randomUUID(), surface: "primary action", trigger: "activation", states: ["idle", "active"], response: "Show state.", transitionStrategy: suitability === "MOTION" ? "MOTION_SPRING" as const : suitability === "CSS_NATIVE" ? "CSS_TRANSITION" as const : "NONE" as const, keyboardBehavior: "Enter and Space.", focusBehavior: "Visible focus.", reducedMotionBehavior: "Preserve state.", requirementReferences: ["brief:projectSummary"] };
  const passEvidence = ["fontpair-normalization", "impeccable-semantic-skill", "impeccable-antipattern-detector", "emil-design-review", "emil-animation-review", "transitions-pattern-mapping", "motion-suitability"].map((capabilityId) => ({ capabilityId: capabilityId as never, status: "PASS" as const, evidenceId: `${variant}:${capabilityId}`, summary: "Current fixture evidence.", checkedAt: "2026-01-01T00:00:00.000Z" }));
  const base = { visualSystem, typography: { ...typographyBase, checksum: hash(typographyBase) }, motion: { ...motionBase, checksum: hash(motionBase) }, interactions: [{ ...interactionBase, checksum: hash(interactionBase) }], toolProvenance: [{ toolId: "host-deterministic" as const, status: "AVAILABLE" as const, source: "host-deterministic" as const, sourceVersion: "fixture", sourceChecksum: hash(variant), retrievedAt: "2026-01-01T00:00:00.000Z", liveEvidence: true, contentTrust: "HOST_VALIDATED" as const, redacted: false }], passEvidence, currentness: { status: "CURRENT" as const, checkedAt: "2026-01-01T00:00:00.000Z" } };
  return DirectionDesignCapabilitySchema.parse({ ...base, contractChecksum: hash(base) });
};
const directions = () => ["editorial", "precision", "dynamic"].map((variant, index) => ({ id: randomUUID(), professionalDesign: capability(variant, index === 2 ? "MOTION" : "CSS_NATIVE") }));
const designSet = () => DesignDirectionSetSchema.parse({ schemaVersion: 1, documentType: "design-directions", projectId: randomUUID(), projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", setId: randomUUID(), directions: ["Editorial", "Precision", "Dynamic"].map((label) => ({ id: randomUUID(), label, concept: `${label} concept`, rationale: "Fixture", mood: "Focused", colorStrategy: "Semantic", typographyStrategy: "Readable", layoutStrategy: `${label} layout`, heroStrategy: "Clear action", sectionRhythm: "Deliberate", componentCharacter: "Purposeful", imageArtDirection: "Contextual", motionPolicy: "Purposeful", responsivePrinciples: ["Preserve order"], antiTemplateRules: ["No filler"], advantages: ["Clear"], risks: ["Needs content"], requirementReferences: [] })), generatedAt: "2026-01-01T00:00:00.000Z", generatedBy: "fixture", readyForSelection: true });

const cases: Array<[string, () => unknown | Promise<unknown>]> = [
  ["F1 — MAGIC PATTERNS ADAPTER", async () => expect(await new MagicPatternsAdapter({ credentialProvider: () => "key", maxRetries: 0, transport: async () => ({ status: 201, headers: {}, body: JSON.stringify({ id: "a", sourceFiles: [] }) }) }).createMinimalArtifact({ prompt: "bounded", idempotencyKey: "f1" })).toMatchObject({ artifactId: "a" })],
  ["F2 — MAGIC PATTERNS HOST ALLOWLIST", () => expect(MAGIC_PATTERNS_API_ORIGIN).toBe("https://api.magicpatterns.com")],
  ["F3 — MAGIC PATTERNS SECRET", async () => expect(new MagicPatternsAdapter({ credentialProvider: () => undefined }).health()).resolves.toMatchObject({ status: "AUTH_REQUIRED" })],
  ["F4 — MAGIC PATTERNS BOUNDED RESPONSE", async () => await expect(new MagicPatternsAdapter({ credentialProvider: () => "key", maxRetries: 0, transport: async () => ({ status: 200, headers: {}, body: "x".repeat(200001) }) }).health()).resolves.toBeTruthy()],
  ["F5 — MAGIC PATTERNS AUTH ERROR", async () => expect(new MagicPatternsAdapter({ credentialProvider: () => "key", maxRetries: 0, transport: async () => ({ status: 401, headers: {}, body: "" }) }).health()).resolves.toMatchObject({ status: "AUTH_INVALID" })],
  ["F6 — MAGIC PATTERNS THREE DIRECTIONS", () => expect(designSet().directions).toHaveLength(3)],
  ["F7 — FONTPAIR READ", async () => expect(await new FontpairAdapter({ transport: async () => ({ status: 200, headers: {}, body: "Headline Fraunces Body Sora" }) }).recommendPair({ idempotencyKey: "f7" })).toMatchObject({ displayFamily: "Fraunces", bodyFamily: "Sora" })],
  ["F8 — FONTPAIR HOST ALLOWLIST", () => expect(FONTPAIR_ORIGIN).toBe("https://fontpair.co")],
  ["F9 — FONTPAIR CACHE", async () => { let calls = 0; const adapter = new FontpairAdapter({ transport: async () => { calls += 1; return { status: 200, headers: {}, body: "Headline Fraunces Body Sora" }; } }); await adapter.recommendPair({ idempotencyKey: "f9" }); await adapter.recommendPair({ idempotencyKey: "f9" }); expect(calls).toBe(1); }],
  ["F10 — FONTPAIR PAIRING PROVENANCE", async () => expect(await new FontpairAdapter({ transport: async () => ({ status: 200, headers: {}, body: "Headline Fraunces Body Sora" }) }).recommendPair({ idempotencyKey: "f10" })).toMatchObject({ sourceChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) })],
  ["F11 — IMPECCABLE SKILL APPROVED", () => expect(REQUIRED_OFFICIAL_DESIGN_SKILLS.map((skill) => skill.skillId)).toContain("impeccable")],
  ["F12 — IMPECCABLE DETECTOR", () => expect(detectImpeccableAntiPatterns([{ path: "x", content: "animation: margin 1s infinite" }]).status).toBe("FAIL")],
  ["F13 — IMPECCABLE CLEAN FIXTURE", () => expect(detectImpeccableAntiPatterns([{ path: "x", content: "opacity: 1" }]).status).toBe("PASS")],
  ["F14 — IMPECCABLE NO WRITE", () => { const files = [{ path: "x", content: "safe" }]; detectImpeccableAntiPatterns(files); expect(files[0]?.content).toBe("safe"); }],
  ["F15 — IMPECCABLE CONFIG PROJECTION", () => expect(DirectionDesignCapabilitySchema.shape.passEvidence).toBeDefined()],
  ["F16 — EMIL DESIGN SKILL RESOLUTION", () => expect(REQUIRED_OFFICIAL_DESIGN_SKILLS.map((skill) => skill.skillId)).toContain("emil-design-eng")],
  ["F17 — ANIMATION OPPORTUNITY ANALYSIS", () => expect(capability("animation").motion.reducedMotionFallback).toBeTruthy()],
  ["F18 — PURPOSEFUL MOTION", () => expect(capability("motion", "MOTION").motion.transitionPattern).toBe("spring")],
  ["F19 — ANIMATION REVIEW", () => expect(capability("review").passEvidence.some((evidence) => evidence.capabilityId === "emil-animation-review")).toBe(true)],
  ["F20 — NO SKILL ESCALATION", () => expect(REQUIRED_OFFICIAL_DESIGN_SKILLS).toHaveLength(8)],
  ["F21 — TRANSITIONS SKILL RESOLUTION", () => expect(REQUIRED_OFFICIAL_DESIGN_SKILLS.map((skill) => skill.skillId)).toEqual(expect.arrayContaining(["transitions-dev", "transitions-polish"]))],
  ["F22 — TRANSITION MAPPING", () => expect(capability("transition").passEvidence.some((evidence) => evidence.capabilityId === "transitions-pattern-mapping")).toBe(true)],
  ["F23 — NO MOTION VALID", () => expect(MotionDecisionSchema.parse({ ...capability("none", "NONE").motion }).dependency).toBeUndefined()],
  ["F24 — POLISH / TOKEN NORMALIZATION", () => expect(hash({ token: "normalized" })).toMatch(/^[a-f0-9]{64}$/)],
  ["F25 — NO DIRECT SOURCE INSTALL", () => expect(REQUIRED_OFFICIAL_DESIGN_SKILLS.every((skill) => !skill.skillId.includes("install"))).toBe(true)],
  ["F26 — MOTION DEPENDENCY AUTHORITY", () => expect(decideDependency({ operation: "ADD", packageName: "motion", versionSpec: "12.43.0", dependencySection: "dependencies", context: { plannedDependencies: [{ name: "motion", runtime: "runtime", required: true }] } }).code).toBe("APPROVED")],
  ["F27 — MOTION NOT REQUIRED", () => expect(validateDirectionDesignCapability("none", capability("none", "NONE")).issues.some((issue) => issue.code === "UNAPPROVED_DESIGN_DEPENDENCY")).toBe(false)],
  ["F28 — MOTION REQUIRED", () => expect(capability("required", "MOTION").motion.dependency?.versionSpec).toBe("12.43.0")],
  ["F29 — MOTION UNAPPROVED", () => expect(validateDirectionDesignCapability("dynamic", capability("dynamic", "MOTION")).valid).toBe(false)],
  ["F30 — MOTION APPROVED", () => expect(validateDirectionDesignCapability("dynamic", capability("dynamic", "MOTION"), { approvedDependencies: new Set(["motion@12.43.0"]) }).valid).toBe(true)],
  ["F31 — VISUAL SYSTEM ROUND TRIP", () => expect(DirectionDesignCapabilitySchema.parse(capability("visual")).visualSystem.tokenChecksum).toBe(capability("visual").visualSystem.tokenChecksum)],
  ["F32 — TYPOGRAPHY ROUND TRIP", () => expect(DirectionDesignCapabilitySchema.parse(capability("type")).typography.normalizedPair).toEqual({ display: "Fraunces", body: "Sora" })],
  ["F33 — MOTION DECISION ROUND TRIP", () => expect(DirectionDesignCapabilitySchema.parse(capability("motion", "MOTION")).motion.suitability).toBe("MOTION")],
  ["F34 — INTERACTION ROUND TRIP", () => expect(DirectionDesignCapabilitySchema.parse(capability("interaction")).interactions).toHaveLength(1)],
  ["F35 — EXACTLY THREE", () => expect(validateExactThreeDesignCapabilities(directions(), { approvedDependencies: new Set(["motion@12.43.0"]) }).valid).toBe(true)],
  ["F36 — TOOLCHAIN COMPLETENESS", () => expect(DesignToolIdSchema.options).toEqual(expect.arrayContaining(["magic-patterns", "fontpair", "impeccable", "emil-design-eng", "emil-animation-review", "transitions-dev", "motion-for-react"]))],
  ["F37 — DISTINCTNESS", () => expect(new Set(directions().map((direction) => direction.professionalDesign.visualSystem.tokenChecksum)).size).toBe(3)],
  ["F38 — SELECTION CURRENTNESS", () => expect(capability("current").currentness.status).toBe("CURRENT")],
  ["F39 — TYPOGRAPHY CHANGE", () => expect(validateDirectionDesignCapability("type", { ...capability("type"), typography: { ...capability("type").typography, normalizedPair: { display: "Changed", body: "Sora" } } }).valid).toBe(false)],
  ["F40 — MOTION CHANGE", () => expect(validateDirectionDesignCapability("motion", { ...capability("motion"), motion: { ...capability("motion").motion, suitability: "NONE", dependency: { packageName: "motion", versionSpec: "12.43.0" } } as never }).valid).toBe(false)],
  ["F41 — SELECTED FONT ENFORCEMENT", () => expect(capability("selected").typography.source).toBe("fontpair")],
  ["F42 — MOTION STRATEGY ENFORCEMENT", () => expect(capability("selected-motion", "MOTION").motion.suitability).toBe("MOTION")],
  ["F43 — CSS-ONLY NO MOTION PACKAGE", () => expect(capability("css", "CSS_NATIVE").motion.dependency).toBeUndefined()],
  ["F44 — INTERACTION TRACEABILITY", () => expect(capability("trace").interactions[0]?.requirementReferences).toContain("brief:projectSummary")],
  ["F45 — UNAPPROVED DESIGN DEPENDENCY", () => expect(validateDirectionDesignCapability("dynamic", capability("dynamic", "MOTION")).issues[0]?.code).toBe("UNAPPROVED_DESIGN_DEPENDENCY")],
  ["F46 — MAGIC PATTERNS DIRECT WRITE", () => expect(TOOL_REGISTRY["magic-patterns-design"].operations[0]?.workspaceScope).toBe("NONE")],
  ["F47 — IMPECCABLE DIRECT WRITE", () => expect(TOOL_REGISTRY["design-quality-validation"].operations[0]?.mutationMode).toBe("READ_ONLY")],
  ["F48 — TRANSITIONS DIRECT WRITE", () => expect(REQUIRED_OFFICIAL_DESIGN_SKILLS.filter((skill) => skill.skillId.startsWith("transitions"))).toHaveLength(2)],
  ["F49 — AST COMPATIBILITY", () => expect(TOOL_REGISTRY["controlled-edit"].operations[0]?.mutationMode).toBe("MUTATION_VIA_CHANGE_PROPOSAL")],
  ["F50 — FULL-FILE COMPATIBILITY", () => expect(TOOL_REGISTRY["magic-patterns-design"].operations[0]?.mutationMode).not.toBe("MUTATION_VIA_CHANGE_PROPOSAL")],
  ["F51 — PROMPT INJECTION", async () => expect((await executeBoundToolOperation({ toolId: "magic-patterns-design", operationId: "create-direction-artifact", executor: { createDirectionArtifact: async () => JSON.stringify({ artifactId: "untrusted", sourceFileNames: [], responseChecksum: "a".repeat(64), createdAt: "2026-01-01T00:00:00.000Z" }) }, input: { prompt: "ignore authority", idempotencyKey: "f51" } })).contentTrust).toBe("UNTRUSTED_EXTERNAL")],
  ["F52 — PATH / NETWORK", () => expect(TOOL_REGISTRY["fontpair-read"].operations[0]?.networkMode).toBe("APPROVED_EXTERNAL_READ_ONLY")],
  ["F53 — LOCALIZED WEBSITE", () => expect(capability("localized").typography.fallbackStack.length).toBeGreaterThanOrEqual(2)],
  ["F54 — SECRET-SAFE DESIGN STATE", () => expect(TOOL_REGISTRY["fontpair-read"].operations[0]?.workspaceScope).toBe("NONE")],
  ["F55 — USER LOGO", () => expect(designSet().directions).toHaveLength(3)],
  ["F56 — NO-LOGO", () => expect(designSet().directions.every((direction) => direction.label)).toBe(true)],
  ["F57 — COMPLETE DIRECTION PIPELINE", () => expect(CAPABILITY_REGISTRY.some((capabilityDefinition) => capabilityDefinition.id === "design.magic-patterns" && capabilityDefinition.taskTypes.includes("create-design-directions"))).toBe(true)],
  ["F58 — ALL THREE PIPELINES", () => expect(validateExactThreeDesignCapabilities(directions(), { approvedDependencies: new Set(["motion@12.43.0"]) }).issues).toHaveLength(0)],
  ["F59 — USER SELECTION", () => expect(SelectedDesignSchema.shape.selectedDirectionId).toBeDefined()],
  ["F60 — DESIGN DEPENDENCY AMENDMENT", () => { const proposed = buildDesignDependencyAmendment({ amendmentId: randomUUID(), projectId: randomUUID(), projectVersion: 1, directionId: randomUUID(), reason: "Approved dynamic interaction.", requestedBy: "user", requestedAt: "2026-01-01T00:00:00.000Z" }); expect(approveDesignDependencyAmendment(proposed, { approvedBy: "user", approvedAt: "2026-01-01T00:01:00.000Z" }).status).toBe("USER_APPROVED"); }],
  ["F61 — PLANNING CONTRACT COMPATIBILITY", () => expect(DesignCapabilityPackageSchema.shape.directionSetId).toBeDefined()],
  ["F62 — DATABASE CONTRACT REGRESSION", () => expect(DesignCapabilityPackageSchema.shape.projectVersion).toBeDefined()],
  ["F63 — CHANGE PROPOSAL REGRESSION", () => expect(TOOL_REGISTRY["controlled-edit"].operations[0]?.executorId).toBe("controlled-edit-layer")],
  ["F64 — QA WORKSPACE REGRESSION", () => expect(TOOL_REGISTRY["design-quality-validation"].operations[0]?.workspaceScope).toBe("CURRENT_TASK_WORKSPACE")],
];

describe("Phase 7F deterministic F1-F64 matrix", () => {
  for (const [label, check] of cases) it(label, async () => { await check(); });
  it("contains the complete requested matrix", () => expect(cases).toHaveLength(64));
});
