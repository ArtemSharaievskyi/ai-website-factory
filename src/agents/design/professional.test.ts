import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DesignDirectionSetSchema } from "@/domain/design/schema";
import { ProfessionalDesignCapabilityPipeline } from "./professional";
import { buildDesignDirectionSet } from "./deterministic";

const direction = (label: string) => ({ id: randomUUID(), label, concept: `${label} concept`, rationale: `${label} rationale`, mood: "Focused", colorStrategy: "Semantic roles", typographyStrategy: "Readable hierarchy", layoutStrategy: `${label} grid`, heroStrategy: "One clear action", sectionRhythm: "Deliberate", componentCharacter: "Purposeful", imageArtDirection: "Contextual", motionPolicy: "Purposeful", responsivePrinciples: ["Preserve reading order"], antiTemplateRules: ["No filler rows"], advantages: ["Clear"], risks: ["Needs content"], requirementReferences: [] });
const directionSet = () => DesignDirectionSetSchema.parse({ schemaVersion: 1, documentType: "design-directions", projectId: randomUUID(), projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", setId: randomUUID(), directions: [direction("Editorial"), direction("Precision"), direction("Dynamic")], generatedAt: "2026-01-01T00:00:00.000Z", generatedBy: "fixture", readyForSelection: true });
const skillEvidence = ["impeccable", "emil-design-eng", "review-animations", "improve-animations", "find-animation-opportunities", "animation-vocabulary", "transitions-dev", "transitions-polish"].map((skillId) => ({ skillId, officialRepository: skillId === "impeccable" ? "pbakaus/impeccable" : skillId.startsWith("transition") ? "Jakubantalik/transitions.dev" : "emilkowalski/skills", status: "APPROVED_IMMUTABLE" as const, sourceChecksum: "a".repeat(64), approvedDirectory: `skills/${skillId}` }));

describe("professional design capability pipeline", () => {
  it("binds live evidence and the embedded three-direction professional package", async () => {
    const projectId = randomUUID();
    const generated = buildDesignDirectionSet({ projectId, projectVersion: 1, idempotencyKey: "professional-success", approvedBriefChecksum: "a".repeat(64), acceptedPlanningChecksum: "b".repeat(64), approvedBrief: { targetAudiences: ["Users"], brandFacts: [], imagesRequired: false, explicitExclusions: [] }, acceptedPlanningPackage: { profile: { selectedProfile: "marketing-site" } }, imageSourceDecision: "placeholders", suppliedLogoMetadata: { status: "missing" } } as never);
    const pipeline = new ProfessionalDesignCapabilityPipeline({
      magicPatterns: { createMinimalArtifact: async () => ({ artifactId: "artifact", sourceFileNames: ["reference.json"], responseChecksum: "b".repeat(64), createdAt: "2026-01-01T00:00:00.000Z" }) } as never,
      fontpair: { recommendPair: async () => ({ displayFamily: "Fraunces", bodyFamily: "Sora", sourceUrl: "https://fontpair.co/", sourceChecksum: "c".repeat(64), normalizedChecksum: "d".repeat(64) }) } as never,
      approvedSkillEvidence: async () => skillEvidence,
    });
    const result = await pipeline.run({ projectId, projectVersion: 1, directionSet: generated, prompt: "A bounded design", idempotencyKey: "professional-success" });
    expect(result.directionSet.professionalCapability?.directions).toHaveLength(3);
    expect(result.directionSet.directions.every((direction) => direction.professionalDesign?.typography.source === "fontpair")).toBe(true);
    expect(result.dependencyRequests).toHaveLength(1);
  });

  it("fails with the exact approved-source blocker when a required official skill is absent", async () => {
    const pipeline = new ProfessionalDesignCapabilityPipeline({
      magicPatterns: { createMinimalArtifact: async () => ({ artifactId: "artifact", sourceFileNames: [], responseChecksum: "b".repeat(64), createdAt: "2026-01-01T00:00:00.000Z" }) } as never,
      fontpair: { recommendPair: async () => ({ displayFamily: "Fraunces", bodyFamily: "Sora", sourceUrl: "https://fontpair.co/", sourceChecksum: "c".repeat(64), normalizedChecksum: "d".repeat(64) }) } as never,
      approvedSkillEvidence: async () => skillEvidence.map((skill) => ({ ...skill, status: "NOT_AVAILABLE" as const, sourceChecksum: undefined, approvedDirectory: undefined })),
    });
    await expect(pipeline.run({ projectId: randomUUID(), projectVersion: 1, directionSet: directionSet(), prompt: "A bounded design", idempotencyKey: "professional-missing-skill" })).rejects.toThrow("DESIGN_SKILL_NOT_AVAILABLE_THROUGH_APPROVED_SOURCE");
  });

  it("does not silently treat a contract-less direction set as professionally ready", async () => {
    const pipeline = new ProfessionalDesignCapabilityPipeline({
      magicPatterns: { createMinimalArtifact: async () => ({ artifactId: "artifact", sourceFileNames: [], responseChecksum: "b".repeat(64), createdAt: "2026-01-01T00:00:00.000Z" }) } as never,
      fontpair: { recommendPair: async () => ({ displayFamily: "Fraunces", bodyFamily: "Sora", sourceUrl: "https://fontpair.co/", sourceChecksum: "c".repeat(64), normalizedChecksum: "d".repeat(64) }) } as never,
      approvedSkillEvidence: async () => skillEvidence,
    });
    await expect(pipeline.run({ projectId: randomUUID(), projectVersion: 1, directionSet: directionSet(), prompt: "A bounded design", idempotencyKey: "professional-missing-contract" })).rejects.toThrow();
  });
});
