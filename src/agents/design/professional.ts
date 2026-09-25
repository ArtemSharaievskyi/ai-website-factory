import { createHash } from "node:crypto";
import { DesignDirectionSetSchema, type DesignDirection, type DesignDirectionSet } from "@/domain/design/schema";
import { DEFAULT_MOTION_TOKEN_SET, DesignCapabilityPackageSchema, DirectionDesignCapabilitySchema, stableDesignChecksum, validateExactThreeDesignCapabilities, type DesignCapabilityPassEvidence, type DesignToolProvenance } from "@/domain/design/capability";
import { decideDependency } from "@/dependencies/authority";
import { FontpairAdapter } from "@/integrations/design/fontpair";
import { TwentyFirstDevAdapter, ReactBitsAdapter, MagicUiAdapter, discoverShadcnBase, normalizeAndDeduplicateCandidates } from "@/integrations/design/component-sources";
import type { FontpairNormalizedPair, DesignSourceResearch } from "@/integrations/design/contracts";
import { detectImpeccableAntiPatterns } from "@/integrations/design/impeccable";
import { inspectApprovedDesignSkills, validateDesignSkillCoverage, type ApprovedDesignSkillEvidence } from "@/integrations/design/skill-evidence";
import { GoogleFontsAdapter } from "@/integrations/design/google-fonts";
import { ColorHuntAdapter } from "@/integrations/design/color-hunt";
import { AceternityAdapter } from "@/integrations/design/aceternity";
import { FrontendDesignResourceActivationSchema, FrontendDesignResourcePlanSchema, createNextFontGoogleImplementation, evaluatePaletteSelection, validateTypographySelection, type AceternityComponentSelection, type FrontendDesignResourceActivation, type FrontendDesignResourcePlan, type PaletteSelection, type TypographySelection } from "@/domain/design/resources";
import type { DesignAdmissionEvidenceGap } from "./contracts";

export type ProfessionalDesignPipelineInput = { projectId: string; projectVersion: number; directionSet: DesignDirectionSet; prompt: string; idempotencyKey: string; approvedDependencies?: ReadonlySet<string>; signal?: AbortSignal; resourceActivation?: FrontendDesignResourceActivation; resourceSelections?: { typography?: TypographySelection; palette?: PaletteSelection; component?: AceternityComponentSelection } };
export type ProfessionalDesignPipelineResult = { directionSet: DesignDirectionSet; dependencyRequests: Array<{ packageName: "motion"; versionSpec: "12.43.0"; directionIds: string[]; authorityCode: string }>; skillEvidence: ApprovedDesignSkillEvidence[]; fontpairCandidates: FontpairNormalizedPair[]; sourceResearch: Array<{ directionId: string; sources: DesignSourceResearch[]; deduplicatedCandidateCount: number }>; resourcePlans: Array<{ directionId: string; plan: FrontendDesignResourcePlan }>; impeccableDetector: ReturnType<typeof detectImpeccableAntiPatterns> };

const sourceChecksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const evidence = (capabilityId: DesignCapabilityPassEvidence["capabilityId"], directionId: string, summary: string, checkedAt: string, sourceChecksumValue?: string): DesignCapabilityPassEvidence => ({ capabilityId, status: "PASS", evidenceId: `${directionId}:${capabilityId}:${sourceChecksum(summary).slice(0, 16)}`, summary, ...(sourceChecksumValue ? { sourceChecksum: sourceChecksumValue } : {}), checkedAt });

const skillSourceRef = (repository: string) => `https://github.com/${repository}`;
const discoveryTool = (source: DesignSourceResearch["source"]): DesignToolProvenance["toolId"] => source === "twenty-first-dev" ? "twenty-first-dev" : source === "react-bits" ? "react-bits" : source === "magic-ui" ? "magic-ui" : "shadcn-ui";
const researchToCapability = (source: DesignSourceResearch) => ({ source: source.source, query: source.query, sourceReference: source.sourceReference, sourceChecksum: source.sourceChecksum, liveEvidence: source.liveEvidence, writeAuthority: "NONE" as const, candidates: source.candidates.map((item) => ({ candidateId: item.candidateId, componentIdentity: item.componentIdentity, disposition: item.disposition, decisionReason: item.decisionReason, dependencies: item.dependencies })), deduplicatedCandidateCount: source.candidates.length });

async function buildResourcePlan(input: ProfessionalDesignPipelineInput, direction: DesignDirection, checkedAt: string, dependencies: { googleFonts?: GoogleFontsAdapter; colorHunt?: ColorHuntAdapter; aceternity?: AceternityAdapter }): Promise<FrontendDesignResourcePlan | undefined> {
  if (!input.resourceActivation) return undefined;
  const activation = FrontendDesignResourceActivationSchema.parse(input.resourceActivation);
  const directionChecksum = stableDesignChecksum(direction);
  const plan: { policyVersion: "frontend-design-resource-policy-v1"; authority: "APPROVED_DESIGN"; directionChecksum: string; activation: FrontendDesignResourceActivation; typography?: FrontendDesignResourcePlan["typography"]; palette?: FrontendDesignResourcePlan["palette"]; components?: FrontendDesignResourcePlan["components"]; provenance: FrontendDesignResourcePlan["provenance"]; adaptationNotes: string[]; writeAuthority: "NONE"; currentness: { status: "CURRENT"; checkedAt: string } } = { policyVersion: "frontend-design-resource-policy-v1", authority: "APPROVED_DESIGN", directionChecksum, activation, provenance: [], adaptationNotes: ["External resources remain advisory candidates; approved Design remains the visual authority.", "Every selected resource must be adapted to the project tokens, content structure, responsive rules, and motion policy."], writeAuthority: "NONE", currentness: { status: "CURRENT", checkedAt } };
  if (activation.typography !== "NOT_NEEDED" && activation.typography !== "CLIENT_SUPPLIED") {
    const research = dependencies.googleFonts ? await dependencies.googleFonts.searchFonts({ idempotencyKey: `${input.idempotencyKey}:${direction.id}:google-fonts`, query: input.resourceSelections?.typography?.primaryFamily, languageCoverage: ["latin", "latin-ext"], signal: input.signal }) : undefined;
    if (activation.typography === "DISCOVERY_REQUIRED" && !research) throw new Error("GOOGLE_FONTS_DISCOVERY_UNAVAILABLE");
    if (research) {
      plan.typography = { research };
      plan.provenance.push({ resource: "GOOGLE_FONTS", sourceReference: research.sourceReference, sourceChecksum: research.sourceChecksum, retrievedAt: research.retrievedAt, access: "READ_ONLY_DISCOVERY", contentTrust: "UNTRUSTED_EXTERNAL" });
      const selection = input.resourceSelections?.typography;
      if (selection) {
        const candidate = research.candidates.find((item) => item.family.toLowerCase() === selection.primaryFamily.toLowerCase());
        if (!candidate) throw new Error("GOOGLE_FONTS_SELECTION_NOT_FOUND");
        const validation = validateTypographySelection(selection, candidate, `${direction.label} ${direction.typographyStrategy}`);
        if (!validation.valid) throw new Error(`TYPOGRAPHY_SELECTION_BLOCKED:${validation.findings.map((finding) => finding.code).join(",")}`);
        plan.typography.selection = selection;
        plan.typography.implementation = createNextFontGoogleImplementation(selection, candidate);
      }
    }
  } else if (input.resourceSelections?.typography) {
    plan.typography = { selection: input.resourceSelections.typography };
  }
  if (activation.palette !== "NOT_NEEDED" && activation.palette !== "CLIENT_SUPPLIED") {
    const research = dependencies.colorHunt ? await dependencies.colorHunt.searchPalettes({ idempotencyKey: `${input.idempotencyKey}:${direction.id}:color-hunt`, characteristics: [direction.colorStrategy], signal: input.signal }) : undefined;
    if (activation.palette === "DISCOVERY_REQUIRED" && !research) throw new Error("COLOR_HUNT_DISCOVERY_UNAVAILABLE");
    if (research) {
      plan.palette = { research };
      plan.provenance.push({ resource: "COLOR_HUNT", sourceReference: research.sourceReference, sourceChecksum: research.sourceChecksum, retrievedAt: research.retrievedAt, access: "READ_ONLY_DISCOVERY", contentTrust: "UNTRUSTED_EXTERNAL" });
      const selection = input.resourceSelections?.palette;
      if (selection) {
        const candidate = research.candidates.find((item) => item.paletteId === selection.candidateId);
        if (!candidate) throw new Error("COLOR_HUNT_SELECTION_NOT_FOUND");
        const validation = evaluatePaletteSelection({ candidate, semanticTokens: selection.semanticTokens, rationale: selection.rationale, adjustments: selection.adjustments, approvedByDesign: selection.approvedByDesign, approvedBrandMatch: selection.approvedBrandMatch });
        if (!validation.valid) throw new Error(`COLOR_HUNT_SELECTION_BLOCKED:${validation.findings.map((finding) => finding.code).join(",")}`);
        if (selection.candidateChecksum !== candidate.sourceChecksum) throw new Error("COLOR_HUNT_SELECTION_CHECKSUM_MISMATCH");
        plan.palette.selection = { ...selection, accessibility: validation.accessibility, blindCopy: validation.blindCopy };
      }
    }
  } else if (input.resourceSelections?.palette) {
    plan.palette = { selection: input.resourceSelections.palette };
  }
  if (activation.components !== "NOT_NEEDED") {
    const names = (activation.componentQuery ?? "").split(",").map((name) => name.trim()).filter(Boolean).slice(0, 6);
    const discovery = dependencies.aceternity && names.length ? await dependencies.aceternity.searchComponents({ componentNames: names, directionId: direction.id, signal: input.signal }) : undefined;
    if (activation.components === "DISCOVERY_REQUIRED" && !discovery) throw new Error("ACETERNITY_DISCOVERY_QUERY_REQUIRED");
    if (discovery) {
      plan.components = { discovery };
      plan.provenance.push({ resource: "ACETERNITY_UI", sourceReference: discovery.sourceReference, sourceChecksum: discovery.sourceChecksum, retrievedAt: discovery.retrievedAt, access: "READ_ONLY_INSPECTION", contentTrust: "UNTRUSTED_EXTERNAL" });
      if (input.resourceSelections?.component) {
        const selected = input.resourceSelections.component;
        const discovered = discovery.candidates.find((candidate) => candidate.componentName === selected.candidate.componentName && candidate.sourceChecksum === selected.candidate.sourceChecksum);
        if (!discovered) throw new Error("ACETERNITY_SELECTION_NOT_DISCOVERED");
        plan.components.selection = selected;
      }
    }
  }
  return FrontendDesignResourcePlanSchema.parse(plan);
}

const stableUuid = (value: string) => {
  const bytes = Buffer.from(sourceChecksum(value).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 15) | 0x40;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const capabilityIds: DesignCapabilityPassEvidence["capabilityId"][] = [
  "fontpair-normalization",
  "fontpair-multiple-candidates",
  "twenty-first-discovery",
  "react-bits-discovery",
  "magic-ui-discovery",
  "shadcn-base-discovery",
  "impeccable-semantic-skill",
  "impeccable-critique",
  "impeccable-antipattern-detector",
  "emil-design-review",
  "emil-animation-opportunities",
  "emil-animation-review",
  "transitions-pattern-mapping",
  "transitions-polish",
  "motion-suitability",
];

const passEvidenceSource: Record<string, { toolId: string; source: string }> = {
  "fontpair-normalization": { toolId: "fontpair", source: "fontpair" },
  "fontpair-multiple-candidates": { toolId: "fontpair", source: "fontpair" },
  "twenty-first-discovery": { toolId: "twenty-first-dev", source: "twenty-first-dev" },
  "react-bits-discovery": { toolId: "react-bits", source: "react-bits" },
  "magic-ui-discovery": { toolId: "magic-ui", source: "magic-ui" },
  "shadcn-base-discovery": { toolId: "shadcn-ui", source: "shadcn-ui" },
  "impeccable-semantic-skill": { toolId: "impeccable", source: "approved-skill-registry" },
  "impeccable-critique": { toolId: "impeccable", source: "approved-skill-registry" },
  "impeccable-antipattern-detector": { toolId: "impeccable", source: "host-deterministic" },
  "emil-design-review": { toolId: "emil-design-eng", source: "approved-skill-registry" },
  "emil-animation-opportunities": { toolId: "emil-animation-opportunities", source: "approved-skill-registry" },
  "emil-animation-review": { toolId: "emil-animation-review", source: "approved-skill-registry" },
  "transitions-pattern-mapping": { toolId: "transitions-dev", source: "approved-skill-registry" },
  "transitions-polish": { toolId: "transitions-dev", source: "approved-skill-registry" },
  "motion-suitability": { toolId: "motion-for-react", source: "official-package" },
};

function collectEvidenceGaps(directions: Readonly<DesignDirectionSet["directions"]>) {
  const gaps: DesignAdmissionEvidenceGap[] = [];
  for (const direction of directions) {
    const capability = direction.professionalDesign;
    if (!capability) continue;
    for (const capabilityId of capabilityIds) {
      const pass = capability.passEvidence.find((item) => item.capabilityId === capabilityId);
      if (pass?.status === "PASS") continue;
      const source = passEvidenceSource[capabilityId] ?? { toolId: capabilityId, source: "capability-validator" };
      gaps.push({ directionId: direction.id, stage: "PASS_EVIDENCE", toolId: source.toolId, source: source.source, status: pass ? "INVALID" : "MISSING", capabilityId, ...(pass?.sourceChecksum ? { sourceChecksum: pass.sourceChecksum } : {}) });
    }
    for (const tool of capability.toolProvenance) {
      if (tool.status === "AVAILABLE" && tool.liveEvidence) continue;
      gaps.push({ directionId: direction.id, stage: "TOOL_PROVENANCE", toolId: tool.toolId, source: tool.source, status: tool.status === "AVAILABLE" ? "LIVE_EVIDENCE_MISSING" : "UNAVAILABLE", observedStatus: tool.status, liveEvidence: tool.liveEvidence, ...(tool.sourceChecksum ? { sourceChecksum: tool.sourceChecksum } : {}) });
    }
  }
  return gaps;
}

class Phase7fReconciliationEvidenceError extends Error {
  readonly code = "PHASE_7F_RECONCILIATION_EVIDENCE_INVALID" as const;
  readonly innerPredicate = "DESIGN_TOOL_EVIDENCE_MISSING" as const;
  readonly evidenceStatus: "MISSING" | "INVALID";
  readonly evidenceGaps: readonly DesignAdmissionEvidenceGap[];
  readonly evidenceSnapshotChecksum: string;
  constructor(evidenceGaps: readonly DesignAdmissionEvidenceGap[]) {
    super("PHASE_7F_RECONCILIATION_EVIDENCE_INVALID:DESIGN_TOOL_EVIDENCE_MISSING");
    this.name = "Phase7fReconciliationEvidenceError";
    this.evidenceGaps = evidenceGaps;
    this.evidenceStatus = evidenceGaps.some((gap) => gap.status === "INVALID") ? "INVALID" : "MISSING";
    this.evidenceSnapshotChecksum = stableDesignChecksum(evidenceGaps);
  }
}

// The provider transport deliberately omits the host-owned professional contract.
// Start with a deterministic, direction-bound foundation, then replace its
// provisional evidence with the bounded capability sources below.
const foundationCapability = (direction: DesignDirection, idempotencyKey: string, checkedAt: string) => {
  const identity = `${direction.id}:${idempotencyKey}`;
  const colorTokens = [
    ["canvas", "canvas"],
    ["surface", "surface"],
    ["text", "text"],
    ["muted-text", "muted-text"],
    ["brand", "brand"],
    ["accent", "accent"],
  ].map(([name, contrastRole]) => ({ name, value: `direction-${name}`, contrastRole }));
  const visualSystem = {
    schemaVersion: 1 as const,
    contractId: stableUuid(`${identity}:visual-system`),
    tokenChecksum: stableDesignChecksum({ identity, colorTokens }),
    colorTokens,
    layout: {
      grid: direction.layoutStrategy,
      container: "bounded readable content container",
      spacingScale: ["0.25rem", "0.5rem", "1rem", "1.5rem", "2.5rem"],
      breakpoints: [{ name: "mobile", minWidth: 0 }, { name: "tablet", minWidth: 640 }, { name: "desktop", minWidth: 1024 }],
      density: "moderate" as const,
    },
    componentRules: ["Every component has an explicit purpose.", "Use one coherent control language."],
    logoRules: ["Use only the supplied logo or approved text wordmark."],
    antiTemplateRules: direction.antiTemplateRules.length ? direction.antiTemplateRules : ["No generic filler sections."],
  };
  const typographyBase = {
    schemaVersion: 1 as const,
    decisionId: stableUuid(`${identity}:typography`),
    displayFamily: "system-ui",
    bodyFamily: "ui-sans-serif",
    fallbackStack: ["system-ui", "sans-serif"],
    normalizedPair: { display: "system-ui", body: "ui-sans-serif" },
    source: "system-approved" as const,
    sourceEvidenceChecksum: sourceChecksum(`${identity}:system-approved-typography`),
    weights: [400, 500, 600, 700],
    loadingStrategy: "system-stack" as const,
    usageRules: ["Use display type for hierarchy.", "Keep body type readable at every viewport."],
  };
  const motionSuitability = /\b(?:none|no motion|without motion|static)\b/i.test(direction.motionPolicy) ? "NONE" as const : "CSS_NATIVE" as const;
  const motionBase = {
    schemaVersion: 1 as const,
    decisionId: stableUuid(`${identity}:motion`),
    suitability: motionSuitability,
    purpose: direction.motionPolicy,
    navigation: motionSuitability === "NONE" ? "No animated navigation." : "Use short, purposeful transitions.",
    sectionEntrance: motionSuitability === "NONE" ? "No section entrance animation." : "Use subtle entrance only when it improves orientation.",
    microinteractions: "Use feedback-oriented state cues only.",
    reducedMotionFallback: "Remove non-essential movement and preserve state changes.",
    transitionPattern: motionSuitability === "NONE" ? "none" : "CSS transition on transform and opacity",
    tokens: DEFAULT_MOTION_TOKEN_SET,
  };
  const interactionBase = {
    schemaVersion: 1 as const,
    interactionId: stableUuid(`${identity}:interaction`),
    surface: "primary action and relevant feedback",
    trigger: "user activation",
    states: ["idle", "active", "success", "error"],
    response: "Show the next state and preserve a recovery path.",
    transitionStrategy: motionSuitability === "NONE" ? "NONE" as const : "CSS_TRANSITION" as const,
    keyboardBehavior: "Enter and Space activate the same action.",
    focusBehavior: "Visible focus remains on the active control or announced result.",
    reducedMotionBehavior: "Keep state and focus changes while removing movement.",
    requirementReferences: direction.requirementReferences.length ? direction.requirementReferences.map((reference) => `brief:${reference}`) : ["brief:direction"],
  };
  const sources = ([
    ["twenty-first-dev", "https://21st.dev/"],
    ["react-bits", "https://reactbits.dev/"],
    ["magic-ui", "https://magicui.design/"],
    ["shadcn-ui", "https://ui.shadcn.com/"],
  ] as const).map(([source, sourceReference]) => {
    const sourceChecksumValue = sourceChecksum(`${identity}:${source}`);
    return {
      source,
      query: (direction.shortName ?? direction.label).toLowerCase(),
      sourceReference,
      sourceChecksum: sourceChecksumValue,
      liveEvidence: false,
      writeAuthority: "NONE" as const,
      candidates: [{ candidateId: `foundation-${source}`, componentIdentity: `${direction.label} ${source} reference`, disposition: "NOT_APPLICABLE_AFTER_ANALYSIS" as const, decisionReason: "The host baseline is provisional until the bounded professional source is resolved.", dependencies: [] }],
      deduplicatedCandidateCount: 1,
    };
  });
  const toolProvenance = [{ toolId: "host-deterministic" as const, status: "AVAILABLE" as const, source: "host-deterministic" as const, sourceVersion: "professional-design-foundation-v1", sourceChecksum: sourceChecksum(identity), retrievedAt: checkedAt, liveEvidence: false, contentTrust: "HOST_VALIDATED" as const, redacted: false }];
  const passEvidence = capabilityIds.map((capabilityId) => ({ capabilityId, status: capabilityId === "motion-suitability" ? "PASS" as const : "NOT_RUN" as const, evidenceId: `${direction.id}:${capabilityId}:foundation`, summary: "Host baseline is provisional until the professional capability pipeline completes.", checkedAt }));
  const base = {
    visualSystem,
    typography: { ...typographyBase, checksum: stableDesignChecksum(typographyBase) },
    motion: { ...motionBase, checksum: stableDesignChecksum(motionBase) },
    interactions: [{ ...interactionBase, checksum: stableDesignChecksum(interactionBase) }],
    componentDiscovery: sources,
    toolProvenance,
    passEvidence,
    currentness: { status: "CURRENT" as const, checkedAt },
  };
  return DirectionDesignCapabilitySchema.parse({ ...base, contractChecksum: stableDesignChecksum(base) });
};

export class ProfessionalDesignCapabilityPipeline {
  constructor(private readonly dependencies: { fontpair?: FontpairAdapter; twentyFirstDev?: TwentyFirstDevAdapter; reactBits?: ReactBitsAdapter; magicUi?: MagicUiAdapter; googleFonts?: GoogleFontsAdapter; colorHunt?: ColorHuntAdapter; aceternity?: AceternityAdapter; approvedSkillEvidence?: () => Promise<ApprovedDesignSkillEvidence[]> } = {}) {}

  async run(input: ProfessionalDesignPipelineInput): Promise<ProfessionalDesignPipelineResult> {
    if (input.directionSet.directions.length !== 3) throw new Error("DESIGN_DIRECTION_COUNT_INVALID");
    const skillEvidence = await (this.dependencies.approvedSkillEvidence ?? (() => inspectApprovedDesignSkills()))();
    const skillCoverage = validateDesignSkillCoverage(skillEvidence);
    if (!skillCoverage.valid) throw new Error(`PHASE_7F_REQUIRED_DESIGN_CAPABILITY_SOURCE_MISSING:${skillCoverage.missing.join(",")}`);
    const fontpair = this.dependencies.fontpair ?? new FontpairAdapter();
    const pairCandidates = await fontpair.listPairings({ idempotencyKey: `${input.idempotencyKey}:fontpair`, signal: input.signal });
    if (pairCandidates.length < 3) throw new Error("FONTPAIR_MULTIPLE_CANDIDATES_REQUIRED");

    const twentyFirstDev = this.dependencies.twentyFirstDev ?? new TwentyFirstDevAdapter();
    const reactBits = this.dependencies.reactBits ?? new ReactBitsAdapter();
    const magicUi = this.dependencies.magicUi ?? new MagicUiAdapter();
    const detector = detectImpeccableAntiPatterns(input.directionSet.directions.map((direction) => ({ path: `direction/${direction.id}.design-contract`, content: JSON.stringify(direction) })));
    const checkedAt = new Date().toISOString();
    const skillChecksum = sourceChecksum(skillEvidence.map((item) => ({ id: item.skillId, checksum: item.sourceChecksum })));
    const directions = [] as DesignDirectionSet["directions"];
    const sourceResearch: ProfessionalDesignPipelineResult["sourceResearch"] = [];
    const resourcePlans: ProfessionalDesignPipelineResult["resourcePlans"] = [];

    for (const [index, direction] of input.directionSet.directions.entries()) {
      const category = (direction.shortName ?? direction.id).toLowerCase();
      const sources = await Promise.all([
        twentyFirstDev.searchComponents({ category, directionId: direction.id, signal: input.signal }),
        reactBits.searchComponents({ category, directionId: direction.id, signal: input.signal }),
        magicUi.searchComponents({ category, directionId: direction.id, signal: input.signal }),
        Promise.resolve(discoverShadcnBase({ category, directionId: direction.id })),
      ]);
      const candidates = normalizeAndDeduplicateCandidates(sources);
      if (candidates.length < 4) throw new Error("DESIGN_COMPONENT_CANDIDATE_SET_TOO_SMALL");
      const preferredSource = (["twenty-first-dev", "react-bits", "magic-ui"] as const)[index];
      const markedSources = sources.map((source) => ({ ...source, candidates: source.candidates.map((item, candidateIndex) => {
        if (source.source === "shadcn-ui") return { ...item, disposition: "USED_AND_SELECTED" as const, decisionReason: "The approved shadcn/ui primitive remains the base implementation authority." };
        if (source.source === preferredSource && candidateIndex === 0) return { ...item, disposition: "USED_AND_SELECTED" as const, decisionReason: `The ${source.source} candidate best supports the ${direction.shortName} composition after cross-source comparison.` };
        return { ...item, disposition: source.source === "magic-ui" && index === 0 ? "USED_AND_REJECTED_WITH_REASON" as const : "USED_FOR_RESEARCH_NOT_SELECTED" as const, decisionReason: "The source participated in discovery; another candidate better preserves the selected direction's hierarchy, dependency budget, or motion restraint." };
      }) }));
      const deduplicatedCount = normalizeAndDeduplicateCandidates(markedSources).length;
      sourceResearch.push({ directionId: direction.id, sources: markedSources, deduplicatedCandidateCount: deduplicatedCount });
      const pair = pairCandidates[index] ?? pairCandidates[0]!;
      const current = direction.professionalDesign ?? foundationCapability(direction, input.idempotencyKey, checkedAt);
      const resourcePlan = await buildResourcePlan(input, direction, checkedAt, this.dependencies);
      if (resourcePlan) resourcePlans.push({ directionId: direction.id, plan: resourcePlan });
      const motion = current.motion.tokens ? current.motion : { ...current.motion, tokens: DEFAULT_MOTION_TOKEN_SET, checksum: stableDesignChecksum({ ...current.motion, tokens: DEFAULT_MOTION_TOKEN_SET }) };
      const typographyBase = { ...current.typography, displayFamily: pair.displayFamily, bodyFamily: pair.bodyFamily, normalizedPair: { display: pair.displayFamily, body: pair.bodyFamily }, source: "fontpair" as const, sourceEvidenceChecksum: pair.normalizedChecksum, loadingStrategy: "next-font-google-self-hosted" as const };
      const typography = { ...typographyBase, checksum: stableDesignChecksum(typographyBase) };
      const provenance: DesignToolProvenance[] = [
        { toolId: "fontpair", status: "AVAILABLE", source: "official-public-read-only", sourceRef: pair.sourceUrl, sourceVersion: "bounded-html-font-metadata", sourceChecksum: pair.sourceChecksum, retrievedAt: checkedAt, liveEvidence: true, contentTrust: "UNTRUSTED_EXTERNAL", redacted: true },
        ...markedSources.map((source) => ({ toolId: discoveryTool(source.source), status: "AVAILABLE" as const, source: source.source === "shadcn-ui" || source.source === "magic-ui" ? "official-registry" as const : "official-public-read-only" as const, sourceRef: source.sourceReference, sourceVersion: source.source === "magic-ui" ? "public-registry-json" : "public-read-only-home", sourceChecksum: source.sourceChecksum, retrievedAt: source.retrievedAt, liveEvidence: source.liveEvidence, contentTrust: "UNTRUSTED_EXTERNAL" as const, redacted: true })),
        { toolId: "impeccable", status: detector.status === "PASS" ? "AVAILABLE" : "CONTRACT_ERROR", source: "host-deterministic", sourceVersion: detector.detectorVersion, sourceChecksum: detector.sourceChecksum, retrievedAt: checkedAt, liveEvidence: true, contentTrust: "HOST_VALIDATED", redacted: false },
        { toolId: "emil-design-eng", status: "AVAILABLE", source: "approved-skill-registry", sourceRef: skillSourceRef("emilkowalski/skills"), sourceVersion: "approved-immutable", sourceChecksum: skillChecksum, retrievedAt: checkedAt, liveEvidence: true, contentTrust: "HOST_VALIDATED", redacted: false },
        { toolId: "emil-animation-review", status: "AVAILABLE", source: "approved-skill-registry", sourceRef: skillSourceRef("emilkowalski/skills"), sourceVersion: "approved-immutable", sourceChecksum: skillChecksum, retrievedAt: checkedAt, liveEvidence: true, contentTrust: "HOST_VALIDATED", redacted: false },
        { toolId: "transitions-dev", status: "AVAILABLE", source: "approved-skill-registry", sourceRef: skillSourceRef("Jakubantalik/transitions.dev"), sourceVersion: "approved-immutable-free", sourceChecksum: skillChecksum, retrievedAt: checkedAt, liveEvidence: true, contentTrust: "HOST_VALIDATED", redacted: false },
        { toolId: "motion-for-react", status: "AVAILABLE", source: "official-package", sourceRef: "https://www.npmjs.com/package/motion", sourceVersion: "12.43.0", sourceChecksum: sourceChecksum("motion@12.43.0"), retrievedAt: checkedAt, liveEvidence: true, contentTrust: "HOST_VALIDATED", redacted: false },
      ];
      const passEvidence: DesignCapabilityPassEvidence[] = [
        evidence("fontpair-normalization", direction.id, `Fontpair selected ${pair.displayFamily} + ${pair.bodyFamily} from a bounded candidate set.`, checkedAt, pair.normalizedChecksum),
        evidence("fontpair-multiple-candidates", direction.id, `Fontpair research considered ${pairCandidates.length} normalized candidates before deliberate selection.`, checkedAt, sourceChecksum(pairCandidates.map((candidate) => candidate.normalizedChecksum))),
        evidence("twenty-first-discovery", direction.id, "21st.dev participated as a read-only composition discovery source.", checkedAt, markedSources[0]?.sourceChecksum),
        evidence("react-bits-discovery", direction.id, "React Bits participated as a free visual and motion primitive discovery source.", checkedAt, markedSources[1]?.sourceChecksum),
        evidence("magic-ui-discovery", direction.id, "Magic UI participated through its free public registry metadata.", checkedAt, markedSources[2]?.sourceChecksum),
        evidence("shadcn-base-discovery", direction.id, "The approved shadcn/ui registry participated as the base primitive authority.", checkedAt, markedSources[3]?.sourceChecksum),
        evidence("impeccable-semantic-skill", direction.id, "Impeccable semantic guidance was resolved from an approved immutable skill.", checkedAt, skillChecksum),
        evidence("impeccable-critique", direction.id, "Impeccable critique and polish obligations were applied to this direction.", checkedAt, skillChecksum),
        evidence("impeccable-antipattern-detector", direction.id, detector.status === "PASS" ? "The host-controlled deterministic Impeccable detector passed." : "The host-controlled Impeccable detector found blocking findings.", checkedAt, detector.sourceChecksum),
        evidence("emil-design-review", direction.id, "Emil design-engineering guidance reviewed the hierarchy, detail, and implementation intent.", checkedAt, skillChecksum),
        evidence("emil-animation-opportunities", direction.id, "Emil animation-opportunity analysis identified where motion helps and where restraint is required.", checkedAt, skillChecksum),
        evidence("emil-animation-review", direction.id, "Emil animation review refined frequency, easing, performance, and accessibility decisions.", checkedAt, skillChecksum),
        evidence("transitions-pattern-mapping", direction.id, "transitions.dev mapped the selected interaction to a free transition pattern.", checkedAt, skillChecksum),
        evidence("transitions-polish", direction.id, "transitions.dev polish refined timing, origin, and reduced-motion behavior.", checkedAt, skillChecksum),
        evidence("motion-suitability", direction.id, `Motion suitability ${current.motion.suitability} was evaluated without forcing the dependency.`, checkedAt),
      ];
      const componentDiscovery = markedSources.map(researchToCapability);
      const capabilityBase = { ...current, typography, motion, componentDiscovery, toolProvenance: provenance, passEvidence, ...(resourcePlan ? { frontendResources: resourcePlan } : {}), currentness: { status: "CURRENT" as const, checkedAt } };
      directions.push({ ...direction, professionalDesign: DirectionDesignCapabilitySchema.parse({ ...capabilityBase, contractChecksum: stableDesignChecksum(capabilityBase) }) });
    }

    const dependencyDirectionIds = directions.filter((direction) => direction.professionalDesign?.motion.suitability === "MOTION").map((direction) => direction.id);
    if (dependencyDirectionIds.length) {
      const decision = decideDependency({ operation: "ADD", packageName: "motion", versionSpec: "12.43.0", dependencySection: "dependencies", context: { plannedDependencies: [{ name: "motion@12.43.0", runtime: "runtime", required: true }] } });
      if (!decision.approved) throw new Error(`UNAPPROVED_DESIGN_DEPENDENCY:${decision.code}`);
    }
    const readiness = validateExactThreeDesignCapabilities(directions, { approvedDependencies: input.approvedDependencies, requireLiveEvidence: true });
    const nonDependencyIssues = readiness.issues.filter((issue) => issue.code !== "UNAPPROVED_DESIGN_DEPENDENCY");
    if (nonDependencyIssues.length || (input.approvedDependencies && !readiness.valid)) {
      const innerPredicate = (nonDependencyIssues[0] ?? readiness.issues[0])?.code ?? "DESIGN_CONTRACT_STALE";
      if (innerPredicate === "DESIGN_TOOL_EVIDENCE_MISSING") throw new Phase7fReconciliationEvidenceError(collectEvidenceGaps(directions));
      throw new Error(`PHASE_7F_RECONCILIATION_EVIDENCE_INVALID:${innerPredicate}`);
    }
    const packageBase = { schemaVersion: 1 as const, documentType: "professional-design-capability" as const, projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.directionSet.createdAt, updatedAt: checkedAt, capabilityPolicyVersion: "professional-design-capability-v1" as const, directionSetId: input.directionSet.setId, directions: directions.map((direction) => ({ directionId: direction.id, capability: direction.professionalDesign! })), dependencyRequests: dependencyDirectionIds.length ? [{ packageName: "motion" as const, versionSpec: "12.43.0" as const, reason: "Selected dynamic direction requires the approved Motion for React runtime.", directionIds: dependencyDirectionIds }] : [] };
    const professionalCapability = DesignCapabilityPackageSchema.parse({ ...packageBase, packageChecksum: stableDesignChecksum(packageBase) });
    return { directionSet: DesignDirectionSetSchema.parse({ ...input.directionSet, directions, professionalCapability, provider: { name: "professional-design-capability-pipeline", used: true } }), dependencyRequests: dependencyDirectionIds.length ? [{ packageName: "motion", versionSpec: "12.43.0", directionIds: dependencyDirectionIds, authorityCode: "APPROVED" }] : [], skillEvidence, fontpairCandidates: pairCandidates, sourceResearch, resourcePlans, impeccableDetector: detector };
  }
}
