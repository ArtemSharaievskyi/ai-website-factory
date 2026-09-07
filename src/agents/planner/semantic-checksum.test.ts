import { describe, expect, it } from "vitest";
import { PlanningPackageSchema, PlannerAgentInputSchema } from "./contracts";
import { buildPlanningPackage, planningDocumentChecksum, planningSemanticChecksum, planningSemanticChecksumForPolicy } from "./deterministic";
import { PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT, PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY } from "./checksum-policy";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";

const projectId = "66666666-6666-4666-8666-666666666666";
const timestamp = "2026-01-01T00:00:00.000Z";

function planningPackage() {
  const brief = cleanBriefV3;
  const approvedBrief = RequirementSpecificationSchema.parse({ ...representativeV1Brief, projectId, projectVersion: 1 });
  return buildPlanningPackage(PlannerAgentInputSchema.parse({
    projectId,
    projectVersion: 1,
    approvedBrief,
    canonicalBrief: brief,
    approvedBriefChecksum: canonicalBriefChecksum(brief),
    originalPromptReference: "synthetic-checksum-prompt",
    clarificationEvidenceReferences: [],
    currentWorkflowState: "AWAITING_PLANNING_GENERATION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: "synthetic-checksum-policy",
    expectedRowVersion: 1,
  }));
}

function changeEnvelope(value: unknown, changes: { createdAt?: string; updatedAt?: string }): unknown {
  if (Array.isArray(value)) return value.map((item) => changeEnvelope(item, changes));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    key === "createdAt" && changes.createdAt ? changes.createdAt : key === "updatedAt" && changes.updatedAt ? changes.updatedAt : changeEnvelope(child, changes),
  ]));
}

describe("Planning semantic checksum policy", () => {
  it("excludes createdAt, updatedAt, and nested lifecycle timestamps from the current semantic domain", () => {
    const planning = planningPackage();
    expect(planning.semanticChecksumPolicyVersion).toBe(PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT);
    expect(planningSemanticChecksum(PlanningPackageSchema.parse(changeEnvelope(planning, { createdAt: "2026-02-02T00:00:00.000Z" })))).toBe(planningSemanticChecksum(planning));
    expect(planningSemanticChecksum(PlanningPackageSchema.parse(changeEnvelope(planning, { updatedAt: "2026-03-03T00:00:00.000Z" })))).toBe(planningSemanticChecksum(planning));
    expect(planningSemanticChecksum(PlanningPackageSchema.parse(changeEnvelope(planning, { createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-05-05T00:00:00.000Z" })))).toBe(planningSemanticChecksum(planning));
    expect(planningDocumentChecksum(PlanningPackageSchema.parse(changeEnvelope(planning, { createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-05-05T00:00:00.000Z" })))).not.toBe(planningDocumentChecksum(planning));
  });

  it("changes when actual Planning semantics change and preserves array-order semantics", () => {
    const planning = planningPackage();
    const changed = PlanningPackageSchema.parse({ ...planning, productScope: { ...planning.productScope, purpose: "A different approved synthetic purpose." } });
    expect(planningSemanticChecksum(changed)).not.toBe(planningSemanticChecksum(planning));
    const reordered = PlanningPackageSchema.parse({ ...planning, profile: { ...planning.profile, requirementReferences: [...planning.profile.requirementReferences].reverse() } });
    expect(planningSemanticChecksum(reordered)).not.toBe(planningSemanticChecksum(planning));
    const same = PlanningPackageSchema.parse({ ...planning, profile: { ...planning.profile, requirementReferences: [...planning.profile.requirementReferences] } });
    expect(planningSemanticChecksum(same)).toBe(planningSemanticChecksum(planning));
  });

  it("keeps legacy artifacts verifiable under the historical policy", () => {
    const current = planningPackage();
    const legacy = PlanningPackageSchema.parse({ ...current, semanticChecksumPolicyVersion: undefined });
    const historical = planningSemanticChecksumForPolicy(legacy, PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY);
    expect(legacy.semanticChecksumPolicyVersion).toBeUndefined();
    expect(planningSemanticChecksum(legacy)).toBe(historical);
    expect(planningSemanticChecksumForPolicy(legacy, PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT)).not.toBe(historical);
    expect(timestamp).toBe("2026-01-01T00:00:00.000Z");
  });
});
