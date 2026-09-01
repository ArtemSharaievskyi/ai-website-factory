import { buildPlanningPackage } from "@/agents/planner/deterministic";
import { representativeV1Brief, cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { DesignAgentInputSchema, type DesignAgentInput } from "./contracts";
import { buildDesignCanonicalContent } from "./canonical-content";

export function fixtureForContext(): DesignAgentInput {
  const canonicalBrief = CanonicalBriefV3Schema.parse(cleanBriefV3);
  const planning = buildPlanningPackage({
    projectId: representativeV1Brief.projectId,
    projectVersion: 1,
    approvedBrief: representativeV1Brief,
    canonicalBrief,
    approvedBriefChecksum: canonicalBriefChecksum(canonicalBrief),
    originalPromptReference: "fixture:prompt",
    clarificationEvidenceReferences: ["fixture:clarification"],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: "fixture-planning-context",
    expectedRowVersion: 1,
  });
  const acceptedPlanning = {
    ...planning,
    accepted: true,
    acceptance: { acceptedAt: "2026-01-01T00:00:00.000Z", acceptedBy: "fixture-user", checksum: checksumPersistedDocument(planning) },
    architecture: { ...planning.architecture, acceptance: { accepted: true, acceptedAt: "2026-01-01T00:00:00.000Z", acceptedBy: "fixture-user" } },
  };
  const briefChecksum = canonicalBriefChecksum(canonicalBrief);
  const planningChecksum = checksumPersistedDocument(acceptedPlanning);
  return DesignAgentInputSchema.parse({
    projectId: representativeV1Brief.projectId,
    projectVersion: 1,
    approvedBrief: representativeV1Brief,
    canonicalBrief,
    canonicalContent: buildDesignCanonicalContent({ brief: canonicalBrief, briefChecksum, planning: acceptedPlanning, planningChecksum, architectureChecksum: "b".repeat(64) }),
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
    idempotencyKey: "fixture-design-context",
    expectedRowVersion: 1,
  });
}
