import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DesignDirectionSetSchema } from "@/domain/design/schema";
import { ProfessionalDesignCapabilityPipeline } from "./professional";
import { buildDesignDirectionSet } from "./deterministic";

const direction = (label: string) => ({ id: randomUUID(), label, concept: `${label} concept`, rationale: `${label} rationale`, mood: "Focused", colorStrategy: "Semantic roles", typographyStrategy: "Readable hierarchy", layoutStrategy: `${label} grid`, heroStrategy: "One clear action", sectionRhythm: "Deliberate", componentCharacter: "Purposeful", imageArtDirection: "Contextual", motionPolicy: "Purposeful", responsivePrinciples: ["Preserve reading order"], antiTemplateRules: ["No filler rows"], advantages: ["Clear"], risks: ["Needs content"], requirementReferences: [] });
const directionSet = () => DesignDirectionSetSchema.parse({ schemaVersion: 1, documentType: "design-directions", projectId: randomUUID(), projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", setId: randomUUID(), directions: [direction("Editorial"), direction("Precision"), direction("Dynamic")], generatedAt: "2026-01-01T00:00:00.000Z", generatedBy: "fixture", readyForSelection: true });
const skillEvidence = ["impeccable", "emil-design-eng", "review-animations", "improve-animations", "find-animation-opportunities", "animation-vocabulary", "transitions-dev"].map((skillId) => ({ skillId, officialRepository: skillId === "impeccable" ? "pbakaus/impeccable" : skillId === "transitions-dev" ? "Jakubantalik/transitions.dev" : "emilkowalski/skills", status: "APPROVED_IMMUTABLE" as const, sourceChecksum: "a".repeat(64), approvedDirectory: `skills/${skillId}` }));
const research = (source: "twenty-first-dev" | "react-bits" | "magic-ui" | "shadcn-ui") => ({ source, query: "design", sourceReference: source === "twenty-first-dev" ? "https://21st.dev/" : source === "react-bits" ? "https://reactbits.dev/" : source === "magic-ui" ? "https://raw.githubusercontent.com/magicuidesign/magicui/main/registry.json" : "https://ui.shadcn.com/", sourceChecksum: "b".repeat(64), retrievedAt: "2026-01-01T00:00:00.000Z", liveEvidence: true, writeAuthority: "NONE" as const, candidates: [{ candidateId: `${source}-candidate`, componentIdentity: `${source} candidate`, category: "design", purpose: "Bounded research.", dependencies: [], motionCharacteristics: "Evaluated.", compatibility: "adaptation-required" as const, sourceReference: source === "twenty-first-dev" ? "https://21st.dev/" : source === "react-bits" ? "https://reactbits.dev/" : source === "magic-ui" ? "https://raw.githubusercontent.com/magicuidesign/magicui/main/registry.json" : "https://ui.shadcn.com/", sourceChecksum: "b".repeat(64), retrievedAt: "2026-01-01T00:00:00.000Z", freePolicy: source === "shadcn-ui" ? "EXISTING_APPROVED" as const : source === "magic-ui" ? "FREE_OPEN_SOURCE" as const : "FREE_PUBLIC_READ_ONLY" as const, disposition: "USED_FOR_RESEARCH_NOT_SELECTED" as const, decisionReason: "Compared.", }], });

const pipeline = () => new ProfessionalDesignCapabilityPipeline({
  fontpair: { listPairings: async () => [1, 2, 3].map((index) => ({ pairingId: `pair-${index}`, displayFamily: `Display ${index}`, bodyFamily: `Body ${index}`, sourceTypes: ["google-fonts"], styleUseCase: "design", sourceUrl: "https://fontpair.co/", sourceChecksum: "c".repeat(64), normalizedChecksum: `${index}`.repeat(64) })) } as never,
  twentyFirstDev: { searchComponents: async () => research("twenty-first-dev") } as never,
  reactBits: { searchComponents: async () => research("react-bits") } as never,
  magicUi: { searchComponents: async () => research("magic-ui") } as never,
  approvedSkillEvidence: async () => skillEvidence,
});

describe("professional design capability pipeline", () => {
  it("binds all four component sources, multiple typography candidates, and the three-direction package", async () => {
    const projectId = randomUUID();
    const generated = buildDesignDirectionSet({ projectId, projectVersion: 1, idempotencyKey: "professional-success", approvedBriefChecksum: "a".repeat(64), acceptedPlanningChecksum: "b".repeat(64), approvedBrief: { targetAudiences: ["Users"], brandFacts: [], imagesRequired: false, explicitExclusions: [] }, acceptedPlanningPackage: { profile: { selectedProfile: "marketing-site" } }, imageSourceDecision: "placeholders", suppliedLogoMetadata: { status: "missing" } } as never);
    const result = await pipeline().run({ projectId, projectVersion: 1, directionSet: generated, prompt: "A bounded design", idempotencyKey: "professional-success" });
    expect(result.directionSet.professionalCapability?.directions).toHaveLength(3);
    expect(result.directionSet.directions.every((direction) => direction.professionalDesign?.typography.source === "fontpair")).toBe(true);
    expect(result.directionSet.directions.every((direction) => direction.professionalDesign?.componentDiscovery.length === 4)).toBe(true);
    expect(result.fontpairCandidates).toHaveLength(3);
    expect(result.dependencyRequests).toHaveLength(1);
  });

  it("fails with the exact capability-source blocker when coverage is absent", async () => {
    const configured = new ProfessionalDesignCapabilityPipeline({ approvedSkillEvidence: async () => [] });
    await expect(configured.run({ projectId: randomUUID(), projectVersion: 1, directionSet: directionSet(), prompt: "A bounded design", idempotencyKey: "professional-missing-skill" })).rejects.toThrow("PHASE_7F_REQUIRED_DESIGN_CAPABILITY_SOURCE_MISSING");
  });

  it("creates a host baseline before enriching provider-shaped directions", async () => {
    const result = await pipeline().run({ projectId: randomUUID(), projectVersion: 1, directionSet: directionSet(), prompt: "A bounded design", idempotencyKey: "professional-missing-contract" });
    expect(result.directionSet.directions).toHaveLength(3);
    expect(result.directionSet.directions.every((direction) => direction.professionalDesign?.typography.source === "fontpair")).toBe(true);
    expect(result.directionSet.directions.every((direction) => direction.professionalDesign?.componentDiscovery.length === 4)).toBe(true);
  });
});
