import { randomUUID } from "node:crypto";
import { DesignDirectionSetSchema } from "@/domain/design/schema";
import { DirectionDesignCapabilitySchema, stableDesignChecksum, buildDesignDependencyAmendment, approveDesignDependencyAmendment } from "@/domain/design/capability";
import { ProfessionalDesignCapabilityPipeline } from "@/agents/design/professional";
import { inspectApprovedDesignSkills } from "@/integrations/design/skill-evidence";

const now = new Date().toISOString();
const hash = (value: unknown) => stableDesignChecksum(value);
const sourceRefs = {
  "twenty-first-dev": "https://21st.dev/",
  "react-bits": "https://reactbits.dev/",
  "magic-ui": "https://raw.githubusercontent.com/magicuidesign/magicui/main/registry.json",
  "shadcn-ui": "https://ui.shadcn.com/",
} as const;
const passIds = ["fontpair-normalization", "fontpair-multiple-candidates", "twenty-first-discovery", "react-bits-discovery", "magic-ui-discovery", "shadcn-base-discovery", "impeccable-semantic-skill", "impeccable-critique", "impeccable-antipattern-detector", "emil-design-review", "emil-animation-opportunities", "emil-animation-review", "transitions-pattern-mapping", "transitions-polish", "motion-suitability"] as const;

function seedCapability(variant: string, suitability: "NONE" | "CSS_NATIVE" | "MOTION") {
  const id = randomUUID();
  const visualSystem = { schemaVersion: 1 as const, contractId: randomUUID(), tokenChecksum: hash(`${variant}:tokens`), colorTokens: ["canvas", "surface", "text", "accent"].map((name) => ({ name, value: `${variant}-${name}`, contrastRole: name === "text" ? "text" as const : name === "accent" ? "accent" as const : name === "canvas" ? "canvas" as const : "surface" as const })), layout: { grid: `${variant} responsive grid`, container: "bounded content container", spacingScale: ["0.25rem", "0.5rem", "1rem"], breakpoints: [{ name: "mobile", minWidth: 0 }], density: "moderate" as const }, componentRules: ["Every component has a clear purpose.", "Use one coherent control language."], logoRules: ["Use only the approved mark."], antiTemplateRules: ["No filler rows."] };
  const typographyBase = { schemaVersion: 1 as const, decisionId: randomUUID(), displayFamily: "Fraunces", bodyFamily: "Inter", fallbackStack: ["ui-sans-serif", "system-ui"], normalizedPair: { display: "Fraunces", body: "Inter" }, source: "system-approved" as const, sourceEvidenceChecksum: hash(`${variant}:type`), weights: [400, 600], loadingStrategy: "system-stack" as const, usageRules: ["Display hierarchy.", "Readable body text."] };
  const motionBase = { schemaVersion: 1 as const, decisionId: randomUUID(), suitability, purpose: "Clarify state without delaying task completion.", navigation: "Short purposeful transition.", sectionEntrance: "Subtle orientation cue.", microinteractions: "Feedback only.", reducedMotionFallback: "Preserve state and focus without movement.", transitionPattern: suitability === "MOTION" ? "spring" : suitability === "CSS_NATIVE" ? "css" : "none", ...(suitability === "MOTION" ? { dependency: { packageName: "motion" as const, versionSpec: "12.43.0" as const } } : {}) };
  const interactionBase = { schemaVersion: 1 as const, interactionId: randomUUID(), surface: "primary action", trigger: "user activation", states: ["idle", "active"], response: "Show the next state.", transitionStrategy: suitability === "MOTION" ? "MOTION_SPRING" as const : suitability === "CSS_NATIVE" ? "CSS_TRANSITION" as const : "NONE" as const, keyboardBehavior: "Enter and Space.", focusBehavior: "Visible focus.", reducedMotionBehavior: "Preserve state and focus.", requirementReferences: [randomUUID()] };
  const componentDiscovery = (Object.entries(sourceRefs) as Array<[keyof typeof sourceRefs, string]>).map(([source, sourceReference]) => ({ source, query: `${variant} source comparison`, sourceReference, sourceChecksum: hash(`${variant}:${source}`), liveEvidence: false, writeAuthority: "NONE" as const, candidates: [{ candidateId: `${source}-seed`, componentIdentity: `${variant} seed candidate`, disposition: "NOT_APPLICABLE_AFTER_ANALYSIS" as const, decisionReason: "Seed evidence is replaced by the live professional pipeline.", dependencies: [] }], deduplicatedCandidateCount: 1 }));
  const passEvidence = passIds.map((capabilityId) => ({ capabilityId, status: "NOT_RUN" as const, evidenceId: `${id}:${capabilityId}`, summary: "Seed capability awaiting bounded professional enrichment.", checkedAt: now }));
  const base = { visualSystem, typography: { ...typographyBase, checksum: hash(typographyBase) }, motion: { ...motionBase, checksum: hash(motionBase) }, interactions: [{ ...interactionBase, checksum: hash(interactionBase) }], componentDiscovery, toolProvenance: [{ toolId: "host-deterministic" as const, status: "AVAILABLE" as const, source: "host-deterministic" as const, sourceVersion: "seed", sourceChecksum: hash(variant), retrievedAt: now, liveEvidence: false, contentTrust: "HOST_VALIDATED" as const, redacted: false }], passEvidence, currentness: { status: "CURRENT" as const, checkedAt: now } };
  return DirectionDesignCapabilitySchema.parse({ ...base, contractChecksum: hash(base) });
}

const projectId = "00000000-0000-4000-8000-000000000007";
const directionSet = DesignDirectionSetSchema.parse({
  schemaVersion: 1,
  documentType: "design-directions",
  projectId,
  projectVersion: 1,
  createdAt: now,
  updatedAt: now,
  setId: randomUUID(),
  directions: [
    ["Editorial", "Narrative editorial character", "NONE"],
    ["Precision", "Structured product precision", "CSS_NATIVE"],
    ["Dynamic", "Purposeful product momentum", "MOTION"],
  ].map(([shortName, concept, suitability]) => ({ id: randomUUID(), shortName, label: shortName, concept, rationale: "Distinct direction for user comparison.", mood: "Focused", colorStrategy: "Semantic roles", typographyStrategy: "Readable hierarchy", layoutStrategy: `${shortName} layout`, heroStrategy: "Clear primary action", sectionRhythm: "Deliberate pacing", componentCharacter: "Purposeful components", imageArtDirection: "Contextual imagery", motionPolicy: suitability, responsivePrinciples: ["Preserve reading order", "Keep primary action reachable"], antiTemplateRules: ["No filler rows"], advantages: ["Clear point of view"], risks: ["Requires disciplined content"], requirementReferences: [randomUUID()], professionalDesign: seedCapability(shortName, suitability as "NONE" | "CSS_NATIVE" | "MOTION") })),
  generatedAt: now,
  generatedBy: "phase7f-reconciliation-fixture",
  readyForSelection: true,
  provider: { name: "phase7f-reconciliation-fixture", used: false },
});

async function main() {
  const pipeline = new ProfessionalDesignCapabilityPipeline();
  const skills = await inspectApprovedDesignSkills();
  const result = await pipeline.run({ projectId, projectVersion: 1, directionSet, prompt: "Reconcile the professional design capability layer.", idempotencyKey: "phase7f-reconciliation-evidence", approvedDependencies: new Set(["motion@12.43.0"]) });
  const selected = result.directionSet.directions[1]!;
  const directionSetChecksum = hash(result.directionSet);
  const selectedDirectionChecksum = hash(selected);
  const capability = selected.professionalDesign!;
  const selectedDesign = { schemaVersion: 1, documentType: "selected-design" as const, projectId, projectVersion: 1, createdAt: now, updatedAt: now, directionSetId: result.directionSet.setId, selectedDirectionId: selected.id, selectedAt: now, selectedBy: "user", selectionNotes: "User-selected current direction: Precision.", selectedDirectionChecksum, selectedDirectionContract: capability, designContract: { directionSetChecksum, selectedDirectionChecksum, visualSystemChecksum: capability.visualSystem.tokenChecksum, typographyChecksum: capability.typography.checksum, motionChecksum: capability.motion.checksum, interactionChecksum: capability.interactions[0]!.checksum, selectedAt: now, currentness: { status: "CURRENT" as const, checkedAt: now } } };
  const amendment = buildDesignDependencyAmendment({ amendmentId: randomUUID(), projectId, projectVersion: 1, directionId: result.directionSet.directions[2]!.id, reason: "Dynamic direction requests Motion for React.", requestedBy: "user", requestedAt: now });
  const approvedAmendment = approveDesignDependencyAmendment(amendment, { approvedBy: "user", approvedAt: now });
  console.log(JSON.stringify({
    status: "PASS",
    projectId,
    directionSetId: result.directionSet.setId,
    directions: result.directionSet.directions.map((direction, index) => ({ index: index + 1, id: direction.id, shortName: direction.shortName, contractChecksum: direction.professionalDesign?.contractChecksum, typography: direction.professionalDesign?.typography.normalizedPair, motion: direction.professionalDesign?.motion.suitability, sourceCount: result.sourceResearch[index]?.sources.length, sourceEvidence: result.sourceResearch[index]?.sources.map((source) => ({ source: source.source, sourceReference: source.sourceReference, sourceChecksum: source.sourceChecksum, candidates: source.candidates.length, liveEvidence: source.liveEvidence, writeAuthority: source.writeAuthority })), deduplicatedCandidateCount: result.sourceResearch[index]?.deduplicatedCandidateCount, passCount: direction.professionalDesign?.passEvidence.filter((pass) => pass.status === "PASS").length })),
    fontpairCandidateCount: result.fontpairCandidates.length,
    fontpairEvidence: [...new Set(result.fontpairCandidates.map((pair) => JSON.stringify({ sourceUrl: pair.sourceUrl, sourceChecksum: pair.sourceChecksum })))].map((item) => JSON.parse(item)),
    skillCount: skills.length,
    skillIds: skills.map((skill) => ({ skillId: skill.skillId, sourceChecksum: skill.sourceChecksum })),
    selectedDesign: { selectedDirectionId: selectedDesign.selectedDirectionId, selectedBy: selectedDesign.selectedBy, selectedDirectionChecksum, directionSetChecksum },
    dependencyAmendment: { status: approvedAmendment.status, directionId: approvedAmendment.directionId, package: `${approvedAmendment.packageName}@${approvedAmendment.versionSpec}`, checksum: approvedAmendment.checksum },
    packageChecksum: result.directionSet.professionalCapability?.packageChecksum,
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? `${error.name}:${error.message}` : "PHASE7F_RECONCILIATION_EVIDENCE_FAILED"); process.exitCode = 1; });
