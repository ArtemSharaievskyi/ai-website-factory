import { describe, expect, it } from "vitest";
import { buildPlanningPackage } from "@/agents/planner/deterministic";
import type { PlannerAgentInput } from "@/agents/planner/contracts";
import { representativeV1Brief, cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { DesignDirectionSetSchema } from "@/domain/design/schema";
import { DesignAgentInputSchema, type DesignAgentInput } from "./contracts";
import { buildDesignCanonicalContent } from "./canonical-content";
import { buildDesignDirectionSet, validateDesignDirectionSet } from "./deterministic";

const timestamp = "2026-01-01T00:00:00.000Z";

function fixture(): { input: DesignAgentInput; canonicalContent: DesignAgentInput["canonicalContent"] } {
  const canonicalBrief = CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    requirements: [
      ...cleanBriefV3.requirements,
      { id: "REQUIREMENT:moebeltransport", category: "CONTENT", statement: "Möbeltransport is an approved service to explain on the site.", sourceRefs: ["fixture:service"] },
    ],
  });
  const plannerInput: PlannerAgentInput = {
    projectId: representativeV1Brief.projectId,
    projectVersion: 1,
    approvedBrief: representativeV1Brief,
    canonicalBrief: canonicalBrief,
    approvedBriefChecksum: canonicalBriefChecksum(canonicalBrief),
    originalPromptReference: "fixture:prompt",
    clarificationEvidenceReferences: ["fixture:clarification"],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: "fixture-planning",
    expectedRowVersion: 1,
  };
  const planning = buildPlanningPackage(plannerInput);
  const acceptedPlanning = {
    ...planning,
    accepted: true,
    acceptance: { acceptedAt: timestamp, acceptedBy: "fixture-user", checksum: checksumPersistedDocument(planning) },
    architecture: { ...planning.architecture, acceptance: { accepted: true, acceptedAt: timestamp, acceptedBy: "fixture-user" } },
  };
  const briefChecksum = canonicalBriefChecksum(canonicalBrief);
  const planningChecksum = checksumPersistedDocument(acceptedPlanning);
  const architectureChecksum = "c".repeat(64);
  const canonicalContent = buildDesignCanonicalContent({ brief: canonicalBrief, briefChecksum, planning: acceptedPlanning, planningChecksum, architectureChecksum });
  const input = DesignAgentInputSchema.parse({
    projectId: representativeV1Brief.projectId,
    projectVersion: 1,
    approvedBrief: representativeV1Brief,
    canonicalBrief,
    canonicalContent,
    approvedBriefChecksum: briefChecksum,
    acceptedPlanningPackage: acceptedPlanning,
    acceptedPlanningChecksum: planningChecksum,
    contentPlan: acceptedPlanning.content,
    assetManifest: acceptedPlanning.assets,
    suppliedBrandMetadata: {},
    suppliedLogoMetadata: representativeV1Brief.suppliedLogoLocation,
    imageSourceDecision: "user-supplied",
    designPreferences: [],
    explicitDesignExclusions: [],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    existingDecisions: [],
    allowedSkills: [],
    idempotencyKey: "fixture-design",
    expectedRowVersion: 1,
  });
  return { input, canonicalContent };
}

function hostBind(input: DesignAgentInput, set: ReturnType<typeof buildDesignDirectionSet>) {
  return DesignDirectionSetSchema.parse({
    ...set,
    directions: set.directions.map((direction) => ({ ...direction, canonicalContent: input.canonicalContent })),
  });
}

describe("host-owned Design canonical content", () => {
  it("projects every V3 requirement exactly once and preserves the approved service inventory", () => {
    const { canonicalContent } = fixture();
    expect(canonicalContent?.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "REQUIREMENT:service" }),
      expect.objectContaining({ id: "REQUIREMENT:moebeltransport", category: "CONTENT" }),
    ]));
    const groups = ["services", "businessGoals", "contactFacts", "legalRequirements", "exclusions", "otherRequirements"] as const;
    const projectedIds = groups.flatMap((group) => canonicalContent?.[group].map((item) => item.id) ?? []);
    expect(projectedIds).toHaveLength(fixture().input.canonicalBrief?.requirements.length ?? 0);
    expect(new Set(projectedIds).size).toBe(projectedIds.length);
    expect(projectedIds).toEqual(expect.arrayContaining(fixture().input.canonicalBrief?.requirements.map((item) => item.id) ?? []));
    expect(canonicalContent).toMatchObject({ navigation: expect.any(Object), productScope: expect.any(Object), userFlows: expect.any(Array), contentPlan: expect.any(Object), legalPolicy: expect.any(Object) });
    expect(canonicalContent?.forms[0]).toMatchObject({ submissionMechanism: "client-only", databaseWrite: expect.any(String), emailBehavior: expect.any(String) });
  });

  it("keeps host services present when a direction omits the service wording", () => {
    const { input } = fixture();
    const set = hostBind(input, buildDesignDirectionSet(input));
    const withoutServiceWording = DesignDirectionSetSchema.parse({
      ...set,
      directions: set.directions.map((direction) => ({ ...direction, rationale: "A presentation rationale without a service sentence." })),
    });
    expect(validateDesignDirectionSet(input, withoutServiceWording).blockingReasons).not.toContain("MOBELTRANSPORT_REQUIREMENT_MISSING");
    expect(validateDesignDirectionSet(input, withoutServiceWording).readyForSelection).toBe(true);
    expect(withoutServiceWording.directions.every((direction) => direction.canonicalContent?.services.some((service) => service.id === "REQUIREMENT:moebeltransport"))).toBe(true);
  });

  it("preserves canonical unresolved publication status in the Design handoff", () => {
    const { input } = fixture();
    const canonicalBrief = CanonicalBriefV3Schema.parse({
      ...input.canonicalBrief,
      unresolved: [{ target: "LEGAL:REGULATORY_AUTHORITY", reason: "Synthetic conditional publication review.", sourceRefs: ["fixture:publication"], status: "CONDITIONAL_IF_APPLICABLE", blockingStages: [] }],
    });
    const content = buildDesignCanonicalContent({
      brief: canonicalBrief,
      briefChecksum: canonicalBriefChecksum(canonicalBrief),
      planning: input.acceptedPlanningPackage,
      planningChecksum: input.acceptedPlanningChecksum,
      architectureChecksum: "c".repeat(64),
    });
    expect(content.unresolved).toEqual([{ target: "LEGAL:REGULATORY_AUTHORITY", reason: "Synthetic conditional publication review.", sourceRefs: ["fixture:publication"], status: "CONDITIONAL_IF_APPLICABLE", blockingStages: [] }]);
  });

  it("blocks only explicit typed contradictions and stale host bindings", () => {
    const { input } = fixture();
    const set = hostBind(input, buildDesignDirectionSet(input));
    const contradiction = DesignDirectionSetSchema.parse({
      ...set,
      directions: set.directions.map((direction, index) => index === 0 ? { ...direction, canonicalServiceConflictRefs: ["REQUIREMENT:moebeltransport"] } : direction),
    });
    expect(validateDesignDirectionSet(input, contradiction).blockingReasons).toContain("DESIGN_CANONICAL_SERVICE_CONTRADICTION");
    const stale = DesignDirectionSetSchema.parse({
      ...set,
      directions: set.directions.map((direction) => ({ ...direction, canonicalContent: { ...input.canonicalContent!, contentChecksum: "d".repeat(64) } })),
    });
    expect(validateDesignDirectionSet(input, stale).blockingReasons).toContain("DESIGN_CANONICAL_CONTENT_STALE");
  });

  it("never accepts a provider-invented service as canonical content", () => {
    const { input } = fixture();
    const set = hostBind(input, buildDesignDirectionSet(input));
    const invented = set.directions[0]?.canonicalContent?.services.some((service) => service.id === "provider:invented-service");
    expect(invented).toBe(false);
    expect(set.directions.every((direction) => direction.canonicalContent?.contentChecksum === input.canonicalContent?.contentChecksum)).toBe(true);
  });
});
