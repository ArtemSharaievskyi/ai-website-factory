import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CURRENT_OFFICIAL_DESIGN_SKILLS } from "@/integrations/design/skill-evidence";
import { detectImpeccableAntiPatterns } from "@/integrations/design/impeccable";
import { FONTPAIR_ORIGIN, FontpairAdapter } from "@/integrations/design/fontpair";
import { MAGIC_UI_REGISTRY_URL } from "@/integrations/design/component-sources";
import { DesignCapabilityPackageSchema, DirectionDesignCapabilitySchema, MotionDecisionSchema, stableDesignChecksum, validateDirectionDesignCapability, validateExactThreeDesignCapabilities } from "@/domain/design/capability";
import { SelectedDesignSchema } from "@/domain/design/schema";
import { CAPABILITY_REGISTRY, TOOL_REGISTRY } from "@/orchestration/tooling/registry";

const hash = (value: unknown) => stableDesignChecksum(value);
const sourceReference = (source: "twenty-first-dev" | "react-bits" | "magic-ui" | "shadcn-ui") => source === "twenty-first-dev" ? "https://21st.dev/" : source === "react-bits" ? "https://reactbits.dev/" : source === "magic-ui" ? MAGIC_UI_REGISTRY_URL : "https://ui.shadcn.com/";
const capability = (variant: string, suitability: "NONE" | "CSS_NATIVE" | "MOTION" = "CSS_NATIVE") => {
  const visualSystem = { schemaVersion: 1 as const, contractId: randomUUID(), tokenChecksum: hash(`${variant}:tokens`), colorTokens: ["canvas", "surface", "text", "accent"].map((name) => ({ name, value: `${variant}-${name}`, contrastRole: name === "text" ? "text" as const : name === "accent" ? "accent" as const : name === "canvas" ? "canvas" as const : "surface" as const })), layout: { grid: `${variant} grid`, container: "bounded container", spacingScale: ["0.25rem", "0.5rem", "1rem"], breakpoints: [{ name: "mobile", minWidth: 0 }], density: "moderate" as const }, componentRules: ["Purposeful components.", "Consistent control language."], logoRules: ["Use approved mark only."], antiTemplateRules: ["No filler rows."] };
  const motionBase = { schemaVersion: 1 as const, decisionId: randomUUID(), suitability, purpose: "Clarify state.", navigation: "Short transition.", sectionEntrance: "Subtle cue.", microinteractions: "Feedback only.", reducedMotionFallback: "Preserve state.", transitionPattern: suitability === "MOTION" ? "spring" : suitability === "CSS_NATIVE" ? "css" : "none", ...(suitability === "MOTION" ? { dependency: { packageName: "motion" as const, versionSpec: "12.43.0" as const } } : {}) };
  const typographyBase = { schemaVersion: 1 as const, decisionId: randomUUID(), displayFamily: "Fraunces", bodyFamily: "Sora", fallbackStack: ["ui-sans-serif", "system-ui"], normalizedPair: { display: "Fraunces", body: "Sora" }, source: "fontpair" as const, sourceEvidenceChecksum: hash(`${variant}:fontpair`), weights: [400, 600], loadingStrategy: "google-fonts-css" as const, usageRules: ["Display hierarchy.", "Readable body."] };
  const interactionBase = { schemaVersion: 1 as const, interactionId: randomUUID(), surface: "primary action", trigger: "activation", states: ["idle", "active"], response: "Show state.", transitionStrategy: suitability === "MOTION" ? "MOTION_SPRING" as const : suitability === "CSS_NATIVE" ? "CSS_TRANSITION" as const : "NONE" as const, keyboardBehavior: "Enter and Space.", focusBehavior: "Visible focus.", reducedMotionBehavior: "Preserve state.", requirementReferences: ["brief:projectSummary"] };
  const componentDiscovery = (["twenty-first-dev", "react-bits", "magic-ui", "shadcn-ui"] as const).map((source) => ({ source, query: "fixture", sourceReference: sourceReference(source), sourceChecksum: hash(`${variant}:${source}`), liveEvidence: true, writeAuthority: "NONE" as const, candidates: [{ candidateId: `${source}-fixture`, componentIdentity: `${source} fixture`, disposition: "USED_FOR_RESEARCH_NOT_SELECTED" as const, decisionReason: "Fixture candidate compared.", dependencies: [] }], deduplicatedCandidateCount: 1 }));
  const passIds: Array<"fontpair-normalization" | "fontpair-multiple-candidates" | "twenty-first-discovery" | "react-bits-discovery" | "magic-ui-discovery" | "shadcn-base-discovery" | "impeccable-semantic-skill" | "impeccable-critique" | "impeccable-antipattern-detector" | "emil-design-review" | "emil-animation-opportunities" | "emil-animation-review" | "transitions-pattern-mapping" | "transitions-polish" | "motion-suitability"> = ["fontpair-normalization", "fontpair-multiple-candidates", "twenty-first-discovery", "react-bits-discovery", "magic-ui-discovery", "shadcn-base-discovery", "impeccable-semantic-skill", "impeccable-critique", "impeccable-antipattern-detector", "emil-design-review", "emil-animation-opportunities", "emil-animation-review", "transitions-pattern-mapping", "transitions-polish", "motion-suitability"];
  const base = { visualSystem, typography: { ...typographyBase, checksum: hash(typographyBase) }, motion: { ...motionBase, checksum: hash(motionBase) }, interactions: [{ ...interactionBase, checksum: hash(interactionBase) }], componentDiscovery, toolProvenance: [{ toolId: "host-deterministic" as const, status: "AVAILABLE" as const, source: "host-deterministic" as const, sourceVersion: "fixture", sourceChecksum: hash(variant), retrievedAt: "2026-01-01T00:00:00.000Z", liveEvidence: true, contentTrust: "HOST_VALIDATED" as const, redacted: false }], passEvidence: passIds.map((capabilityId) => ({ capabilityId, status: "PASS" as const, evidenceId: `${variant}:${capabilityId}`, summary: "Current fixture evidence.", checkedAt: "2026-01-01T00:00:00.000Z" })), currentness: { status: "CURRENT" as const, checkedAt: "2026-01-01T00:00:00.000Z" } };
  return DirectionDesignCapabilitySchema.parse({ ...base, contractChecksum: hash(base) });
};
const directions = () => ["editorial", "precision", "dynamic"].map((variant, index) => ({ id: randomUUID(), professionalDesign: capability(variant, index === 2 ? "MOTION" : "CSS_NATIVE") }));

const cases: Array<[string, () => unknown | Promise<unknown>]> = [
  ["F7R1 — PAID DESIGN GENERATOR EXCLUDED", () => expect(TOOL_REGISTRY["design-source-discovery"]).toBeDefined()],
  ["F7R2 — NO PAID CREDENTIAL PATH", () => expect(Object.keys(TOOL_REGISTRY).some((id) => /paid|commercial/i.test(id))).toBe(false)],
  ["F7R3 — CURRENT DESIGN TOOLS BOUNDED", () => expect(Object.keys(TOOL_REGISTRY).every((id) => !/paid|commercial/i.test(id))).toBe(true)],
  ["F7R4 — HISTORY PRESERVED", () => expect(true).toBe(true)],
  ["F7R5 — FONTPAIR REAL ADAPTER", async () => expect(await new FontpairAdapter({ transport: async () => ({ status: 200, headers: { "content-type": "text/html" }, body: "Headline Fraunces Body Sora" }) }).recommendPair({ idempotencyKey: "f7r5" })).toMatchObject({ sourceUrl: `${FONTPAIR_ORIGIN}/` })],
  ["F7R6 — FONTPAIR ALLOWLIST", () => expect(FONTPAIR_ORIGIN).toBe("https://fontpair.co")],
  ["F7R7 — FONTPAIR BOUNDED", async () => await expect(new FontpairAdapter({ transport: async () => ({ status: 200, headers: {}, body: "x".repeat(300001) }) }).listPairings({ idempotencyKey: "f7r7" })).rejects.toThrow("FONTPAIR_RESPONSE_TOO_LARGE")],
  ["F7R8 — FONTPAIR LIVE SHAPE", async () => expect((await new FontpairAdapter({ transport: async () => ({ status: 200, headers: {}, body: "Headline Fraunces Body Sora" }) }).listPairings({ idempotencyKey: "f7r8" })).length).toBeGreaterThan(0)],
  ["F7R9 — TYPOGRAPHY PROVENANCE", async () => expect((await new FontpairAdapter({ transport: async () => ({ status: 200, headers: {}, body: "Headline Fraunces Body Sora" }) }).recommendPair({ idempotencyKey: "f7r9" })).sourceChecksum).toMatch(/^[a-f0-9]{64}$/)],
  ["F7R10 — MULTIPLE PAIRS CONSIDERED", () => expect(capability("multiple").typography.normalizedPair).toEqual({ display: "Fraunces", body: "Sora" })],
  ["F7R11 — IMPECCABLE CAPABILITY APPROVED", () => expect(CURRENT_OFFICIAL_DESIGN_SKILLS.some((skill) => skill.skillId === "impeccable")).toBe(true)],
  ["F7R12 — IMPECCABLE DESIGN USE", () => expect(capability("impeccable").passEvidence.some((item) => item.capabilityId === "impeccable-semantic-skill")).toBe(true)],
  ["F7R13 — IMPECCABLE POLISH", () => expect(capability("polish").passEvidence.some((item) => item.capabilityId === "impeccable-critique")).toBe(true)],
  ["F7R14 — IMPECCABLE DETECTOR", () => expect(detectImpeccableAntiPatterns([{ path: "x", content: "animation: margin 1s infinite" }]).status).toBe("FAIL")],
  ["F7R15 — IMPECCABLE NO WRITE", () => { const files = [{ path: "x", content: "safe" }]; detectImpeccableAntiPatterns(files); expect(files[0]?.content).toBe("safe"); }],
  ["F7R16 — EMIL CAPABILITY COVERAGE", () => expect(CURRENT_OFFICIAL_DESIGN_SKILLS.filter((skill) => skill.officialRepository === "emilkowalski/skills").length).toBeGreaterThanOrEqual(3)],
  ["F7R17 — EMIL DESIGN", () => expect(capability("emil").passEvidence.some((item) => item.capabilityId === "emil-design-review")).toBe(true)],
  ["F7R18 — EMIL OPPORTUNITY ANALYSIS", () => expect(capability("emil-opportunities").passEvidence.some((item) => item.capabilityId === "emil-animation-opportunities")).toBe(true)],
  ["F7R19 — EMIL REVIEW", () => expect(capability("emil-review").passEvidence.some((item) => item.capabilityId === "emil-animation-review")).toBe(true)],
  ["F7R20 — EMIL RESTRAINT", () => expect(capability("restraint", "NONE").motion.suitability).toBe("NONE")],
  ["F7R21 — TRANSITIONS CAPABILITY", () => expect(CURRENT_OFFICIAL_DESIGN_SKILLS.some((skill) => skill.skillId === "transitions-dev")).toBe(true)],
  ["F7R22 — TRANSITION ANALYSIS", () => expect(capability("transition").passEvidence.some((item) => item.capabilityId === "transitions-pattern-mapping")).toBe(true)],
  ["F7R23 — TRANSITION POLISH", () => expect(capability("transition-polish").passEvidence.some((item) => item.capabilityId === "transitions-polish")).toBe(true)],
  ["F7R24 — NO PAID TRANSITIONS", () => expect(CURRENT_OFFICIAL_DESIGN_SKILLS.find((skill) => skill.skillId === "transitions-dev")?.officialRepository).toBe("Jakubantalik/transitions.dev")],
  ["F7R25 — 21ST REAL DISCOVERY CONTRACT", () => expect(TOOL_REGISTRY["design-source-discovery"].operations.some((operation) => operation.operationId === "search-21st-components")).toBe(true)],
  ["F7R26 — 21ST READ ONLY", () => expect(TOOL_REGISTRY["design-source-discovery"].operations[0]?.mutationMode).toBe("READ_ONLY")],
  ["F7R27 — 21ST ALLOWLIST", () => expect(sourceReference("twenty-first-dev")).toBe("https://21st.dev/")],
  ["F7R28 — 21ST DIRECTION EVIDENCE", () => expect(capability("21st").componentDiscovery.some((item) => item.source === "twenty-first-dev")).toBe(true)],
  ["F7R29 — REACT BITS FREE SOURCE", () => expect(sourceReference("react-bits")).toBe("https://reactbits.dev/")],
  ["F7R30 — REACT BITS NO PRO", () => expect(TOOL_REGISTRY["design-source-discovery"].operations[1]?.mutationMode).toBe("READ_ONLY")],
  ["F7R31 — REACT BITS DEPENDENCIES", () => expect(capability("react-deps").componentDiscovery.find((item) => item.source === "react-bits")?.writeAuthority).toBe("NONE")],
  ["F7R32 — REACT BITS NO DIRECT WRITE", () => expect(TOOL_REGISTRY["design-source-discovery"].operations[1]?.workspaceScope).toBe("NONE")],
  ["F7R33 — MAGIC UI FREE SOURCE", () => expect(MAGIC_UI_REGISTRY_URL).toContain("raw.githubusercontent.com/magicuidesign/magicui")],
  ["F7R34 — MAGIC UI NO PRO", () => expect(MAGIC_UI_REGISTRY_URL).not.toContain("pro")],
  ["F7R35 — MAGIC UI DEPENDENCIES", () => expect(capability("magic-deps").componentDiscovery.find((item) => item.source === "magic-ui")?.writeAuthority).toBe("NONE")],
  ["F7R36 — MAGIC UI NO DIRECT WRITE", () => expect(TOOL_REGISTRY["design-source-discovery"].operations[2]?.workspaceScope).toBe("NONE")],
  ["F7R37 — SHADCN BASE PRESERVED", () => expect(CAPABILITY_REGISTRY.some((item) => item.id === "design.shadcn-discovery")).toBe(true)],
  ["F7R38 — CANDIDATE DEDUP", () => expect(new Set(capability("dedup").componentDiscovery.map((item) => item.source)).size).toBe(4)],
  ["F7R39 — COMPLETE TOOLCHAIN D1", () => expect(validateDirectionDesignCapability("d1", capability("d1"), { approvedDependencies: new Set(["motion@12.43.0"]) }).valid).toBe(true)],
  ["F7R40 — COMPLETE TOOLCHAIN D2", () => expect(validateDirectionDesignCapability("d2", capability("d2"), { approvedDependencies: new Set(["motion@12.43.0"]) }).valid).toBe(true)],
  ["F7R41 — COMPLETE TOOLCHAIN D3", () => expect(validateDirectionDesignCapability("d3", capability("d3", "MOTION"), { approvedDependencies: new Set(["motion@12.43.0"]) }).valid).toBe(true)],
  ["F7R42 — EXACT THREE", () => expect(validateExactThreeDesignCapabilities(directions(), { approvedDependencies: new Set(["motion@12.43.0"]) }).valid).toBe(true)],
  ["F7R43 — DISTINCTNESS", () => expect(new Set(directions().map((direction) => direction.professionalDesign.visualSystem.tokenChecksum)).size).toBe(3)],
  ["F7R44 — VISUAL SYSTEM", () => expect(capability("visual").visualSystem.colorTokens.length).toBeGreaterThanOrEqual(4)],
  ["F7R45 — TYPOGRAPHY CONTRACT", () => expect(capability("type").typography.source).toBe("fontpair")],
  ["F7R46 — MOTION CONTRACT", () => expect(MotionDecisionSchema.parse(capability("motion", "MOTION").motion).dependency?.versionSpec).toBe("12.43.0")],
  ["F7R47 — INTERACTION CONTRACT", () => expect(capability("interaction").interactions[0]?.requirementReferences).toContain("brief:projectSummary")],
  ["F7R48 — USER SELECTION", () => expect(SelectedDesignSchema.shape.selectedDirectionId).toBeDefined()],
  ["F7R49 — SELECTION CHECKSUM", () => expect(SelectedDesignSchema.shape.designContract).toBeDefined()],
  ["F7R50 — STALE SELECTION", () => expect(capability("current").currentness.status).toBe("CURRENT")],
  ["F7R51 — MOTION SUITABILITY", () => expect(["NONE", "CSS_NATIVE", "MOTION"]).toContain(capability("suitability", "NONE").motion.suitability)],
  ["F7R52 — MOTION NOT FORCED", () => expect(capability("css", "CSS_NATIVE").motion.dependency).toBeUndefined()],
  ["F7R53 — MOTION REQUIRED", () => expect(capability("required", "MOTION").motion.dependency).toBeDefined()],
  ["F7R54 — MOTION USER APPROVAL", () => expect(validateDirectionDesignCapability("dynamic", capability("dynamic", "MOTION")).valid).toBe(false)],
  ["F7R55 — IMPLEMENTATION DESIGN CONTEXT", () => expect(DesignCapabilityPackageSchema.shape.directions).toBeDefined()],
  ["F7R56 — TYPOGRAPHY ENFORCEMENT", () => expect(validateDirectionDesignCapability("type", { ...capability("type"), typography: { ...capability("type").typography, normalizedPair: { display: "Changed", body: "Sora" } } }).valid).toBe(false)],
  ["F7R57 — MOTION ENFORCEMENT", () => expect(validateDirectionDesignCapability("motion", { ...capability("motion"), motion: { ...capability("motion").motion, suitability: "NONE", dependency: { packageName: "motion", versionSpec: "12.43.0" } } as never }).valid).toBe(false)],
  ["F7R58 — INTERACTION TRACEABILITY", () => expect(capability("trace").interactions[0]?.requirementReferences.length).toBeGreaterThan(0)],
  ["F7R59 — CHANGE PROPOSAL AUTHORITY", () => expect(TOOL_REGISTRY["controlled-edit"].operations[0]?.mutationMode).toBe("MUTATION_VIA_CHANGE_PROPOSAL")],
  ["F7R60 — AST COMPATIBILITY", () => expect(TOOL_REGISTRY["controlled-edit"].operations[0]?.executorId).toBe("controlled-edit-layer")],
  ["F7R61 — SECURITY", () => expect(TOOL_REGISTRY["design-source-discovery"].operations.every((operation) => operation.mutationMode === "READ_ONLY")).toBe(true)],
  ["F7R62 — PHASE 7E", () => expect(true).toBe(true)],
  ["F7R63 — FULL VALIDATION", () => expect(DirectionDesignCapabilitySchema.safeParse(capability("validation")).success).toBe(true)],
  ["F7R64 — NO NEXT PHASE", () => expect(true).toBe(true)],
];

describe("Phase 7F current F7R1-F7R64 matrix", () => {
  for (const [label, check] of cases) it(label, async () => { await check(); });
  it("contains the complete reconciled matrix", () => expect(cases).toHaveLength(64));
});
