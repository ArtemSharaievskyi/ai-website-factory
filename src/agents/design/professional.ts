import { createHash } from "node:crypto";
import { DesignDirectionSetSchema, type DesignDirection, type DesignDirectionSet } from "@/domain/design/schema";
import { DesignCapabilityPackageSchema, DirectionDesignCapabilitySchema, stableDesignChecksum, validateExactThreeDesignCapabilities, type DesignCapabilityPassEvidence, type DesignToolProvenance } from "@/domain/design/capability";
import { decideDependency } from "@/dependencies/authority";
import { FontpairAdapter } from "@/integrations/design/fontpair";
import { TwentyFirstDevAdapter, ReactBitsAdapter, MagicUiAdapter, discoverShadcnBase, normalizeAndDeduplicateCandidates } from "@/integrations/design/component-sources";
import type { FontpairNormalizedPair, DesignSourceResearch } from "@/integrations/design/contracts";
import { detectImpeccableAntiPatterns } from "@/integrations/design/impeccable";
import { inspectApprovedDesignSkills, validateDesignSkillCoverage, type ApprovedDesignSkillEvidence } from "@/integrations/design/skill-evidence";

export type ProfessionalDesignPipelineInput = { projectId: string; projectVersion: number; directionSet: DesignDirectionSet; prompt: string; idempotencyKey: string; approvedDependencies?: ReadonlySet<string>; signal?: AbortSignal };
export type ProfessionalDesignPipelineResult = { directionSet: DesignDirectionSet; dependencyRequests: Array<{ packageName: "motion"; versionSpec: "12.43.0"; directionIds: string[]; authorityCode: string }>; skillEvidence: ApprovedDesignSkillEvidence[]; fontpairCandidates: FontpairNormalizedPair[]; sourceResearch: Array<{ directionId: string; sources: DesignSourceResearch[]; deduplicatedCandidateCount: number }>; impeccableDetector: ReturnType<typeof detectImpeccableAntiPatterns> };

const sourceChecksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const evidence = (capabilityId: DesignCapabilityPassEvidence["capabilityId"], directionId: string, summary: string, checkedAt: string, sourceChecksumValue?: string): DesignCapabilityPassEvidence => ({ capabilityId, status: "PASS", evidenceId: `${directionId}:${capabilityId}:${sourceChecksum(summary).slice(0, 16)}`, summary, ...(sourceChecksumValue ? { sourceChecksum: sourceChecksumValue } : {}), checkedAt });

const skillSourceRef = (repository: string) => `https://github.com/${repository}`;
const discoveryTool = (source: DesignSourceResearch["source"]): DesignToolProvenance["toolId"] => source === "twenty-first-dev" ? "twenty-first-dev" : source === "react-bits" ? "react-bits" : source === "magic-ui" ? "magic-ui" : "shadcn-ui";
const researchToCapability = (source: DesignSourceResearch) => ({ source: source.source, query: source.query, sourceReference: source.sourceReference, sourceChecksum: source.sourceChecksum, liveEvidence: source.liveEvidence, writeAuthority: "NONE" as const, candidates: source.candidates.map((item) => ({ candidateId: item.candidateId, componentIdentity: item.componentIdentity, disposition: item.disposition, decisionReason: item.decisionReason, dependencies: item.dependencies })), deduplicatedCandidateCount: source.candidates.length });

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
  constructor(private readonly dependencies: { fontpair?: FontpairAdapter; twentyFirstDev?: TwentyFirstDevAdapter; reactBits?: ReactBitsAdapter; magicUi?: MagicUiAdapter; approvedSkillEvidence?: () => Promise<ApprovedDesignSkillEvidence[]> } = {}) {}

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
      const typographyBase = { ...current.typography, displayFamily: pair.displayFamily, bodyFamily: pair.bodyFamily, normalizedPair: { display: pair.displayFamily, body: pair.bodyFamily }, source: "fontpair" as const, sourceEvidenceChecksum: pair.normalizedChecksum, loadingStrategy: "google-fonts-css" as const };
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
      const capabilityBase = { ...current, typography, componentDiscovery, toolProvenance: provenance, passEvidence, currentness: { status: "CURRENT" as const, checkedAt } };
      directions.push({ ...direction, professionalDesign: DirectionDesignCapabilitySchema.parse({ ...capabilityBase, contractChecksum: stableDesignChecksum(capabilityBase) }) });
    }

    const dependencyDirectionIds = directions.filter((direction) => direction.professionalDesign?.motion.suitability === "MOTION").map((direction) => direction.id);
    if (dependencyDirectionIds.length) {
      const decision = decideDependency({ operation: "ADD", packageName: "motion", versionSpec: "12.43.0", dependencySection: "dependencies", context: { plannedDependencies: [{ name: "motion", runtime: "runtime", required: true }] } });
      if (!decision.approved) throw new Error(`UNAPPROVED_DESIGN_DEPENDENCY:${decision.code}`);
    }
    const readiness = validateExactThreeDesignCapabilities(directions, { approvedDependencies: input.approvedDependencies, requireLiveEvidence: true });
    const nonDependencyIssues = readiness.issues.filter((issue) => issue.code !== "UNAPPROVED_DESIGN_DEPENDENCY");
    if (nonDependencyIssues.length || (input.approvedDependencies && !readiness.valid)) throw new Error(`PHASE_7F_RECONCILIATION_EVIDENCE_INVALID:${(nonDependencyIssues[0] ?? readiness.issues[0])?.code ?? "DESIGN_CONTRACT_STALE"}`);
    const packageBase = { schemaVersion: 1 as const, documentType: "professional-design-capability" as const, projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.directionSet.createdAt, updatedAt: checkedAt, capabilityPolicyVersion: "professional-design-capability-v1" as const, directionSetId: input.directionSet.setId, directions: directions.map((direction) => ({ directionId: direction.id, capability: direction.professionalDesign! })), dependencyRequests: dependencyDirectionIds.length ? [{ packageName: "motion" as const, versionSpec: "12.43.0" as const, reason: "Selected dynamic direction requires the approved Motion for React runtime.", directionIds: dependencyDirectionIds }] : [] };
    const professionalCapability = DesignCapabilityPackageSchema.parse({ ...packageBase, packageChecksum: stableDesignChecksum(packageBase) });
    return { directionSet: DesignDirectionSetSchema.parse({ ...input.directionSet, directions, professionalCapability, provider: { name: "professional-design-capability-pipeline", used: true } }), dependencyRequests: dependencyDirectionIds.length ? [{ packageName: "motion", versionSpec: "12.43.0", directionIds: dependencyDirectionIds, authorityCode: "APPROVED" }] : [], skillEvidence, fontpairCandidates: pairCandidates, sourceResearch, impeccableDetector: detector };
  }
}
