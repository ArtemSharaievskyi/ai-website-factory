import { describe, expect, it } from "vitest";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { CanonicalBriefV3Schema, RequirementCategorySchema } from "@/domain/requirements/v3/schema";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { assertPlannerReferenceTableCurrent, createPlannerReferenceTable, measurePlannerProviderInput, plannerProviderReferenceProtocol } from "./reference-table";
import { PLANNER_COVERAGE_DEFINITIONS } from "./coverage-contract";

const input = (brief = cleanBriefV3, idempotencyKey = "synthetic-planner-operation") => ({
  projectId: "11111111-1111-4111-8111-111111111111",
  projectVersion: 1,
  approvedBriefChecksum: canonicalBriefChecksum(brief),
  idempotencyKey,
  expectedRowVersion: 7,
  canonicalBrief: brief,
});

describe("Planner reference table", () => {
  it("assigns stable compact requirement, page, and route tokens from the current canonical Brief", () => {
    const first = createPlannerReferenceTable(input());
    const second = createPlannerReferenceTable(input());
    expect(second).toEqual(first);
    expect(first.requirements.map((entry) => entry.token)).toEqual(["REQ_001", "REQ_002"]);
    expect(first.pages.map((entry) => entry.token)).toEqual(["PAGE_001"]);
    expect(first.routes.map((entry) => entry.token)).toEqual(["ROUTE_001"]);
    expect(new Set(first.requirements.map((entry) => entry.canonicalRequirementId)).size).toBe(first.requirements.length);
    expect(first.requirements.filter((entry) => entry.mandatory)).not.toHaveLength(0);
  });

  it("exposes only semantic token context at the provider boundary", () => {
    const table = createPlannerReferenceTable(input());
    const protocol = plannerProviderReferenceProtocol(table);
    const providerText = JSON.stringify(protocol);
    expect(providerText).toContain("REQ_001");
    expect(providerText).toContain("PAGE_001");
    expect(providerText).toContain("ROUTE_001");
    for (const entry of table.requirements) expect(providerText).not.toContain(entry.canonicalRequirementId);
    for (const entry of table.pages) expect(providerText).not.toContain(entry.canonicalPageId);
    for (const entry of table.routes) expect(providerText).not.toContain(entry.canonicalRouteId);
    expect(providerText).not.toContain(table.approvedBriefChecksum);
    expect(providerText).not.toContain(table.operationChecksum);
    expect(protocol.requirements.every((entry) => entry.coverageConstraints.minimumCoverageTargets === 1)).toBe(true);
    expect(protocol.requirements.every((entry) => entry.coverageConstraints.allowedDomains.length > 0 && entry.coverageConstraints.allowedElementKinds.length > 0)).toBe(true);
  });

  it("audits an explicit compatibility definition for every canonical V3 requirement category", () => {
    expect(Object.keys(PLANNER_COVERAGE_DEFINITIONS).sort()).toEqual([...RequirementCategorySchema.options].sort());
  });

  it("measures the compact provider protocol without counting host-only identities as transmitted input", () => {
    const table = createPlannerReferenceTable(input());
    const protocol = plannerProviderReferenceProtocol(table);
    const metrics = measurePlannerProviderInput(table, protocol);
    expect(metrics.referenceTableBytes).toBeGreaterThan(metrics.totalPlannerInputBytes);
    expect(metrics.coverageSchemaBytes).toBeGreaterThan(0);
    expect(metrics.requirementSemanticsBytes).toBeGreaterThan(0);
    expect(metrics.estimatedInputTokens).toBe(Math.ceil(metrics.totalPlannerInputBytes / 4));
    expect(metrics.totalPlannerInputBytes).toBeLessThan(64_000);
  });

  it("keeps distinct canonical identities as distinct coverage slots even when their semantics match", () => {
    const duplicateSemanticBrief = CanonicalBriefV3Schema.parse({
      ...cleanBriefV3,
      requirements: Array.from({ length: 12 }, (_, index) => ({
        id: `REQUIREMENT:synthetic-duplicate-${String(index + 1).padStart(3, "0")}`,
        category: "FEATURE" as const,
        statement: `Provide the same synthetic capability pair ${Math.floor(index / 2) + 1}.`,
        sourceRefs: [`fixture:duplicate:${index + 1}`],
      })),
    });
    const table = createPlannerReferenceTable(input(duplicateSemanticBrief));
    expect(table.requirements.filter((entry) => entry.mandatory)).toHaveLength(12);
    expect(new Set(table.requirements.map((entry) => entry.token)).size).toBe(12);
    expect(new Set(table.requirements.map((entry) => entry.canonicalRequirementId)).size).toBe(12);
    for (let index = 0; index < 12; index += 2) {
      expect(table.requirements[index]?.summary).toBe(table.requirements[index + 1]?.summary);
      expect(table.requirements[index]?.canonicalRequirementId).not.toBe(table.requirements[index + 1]?.canonicalRequirementId);
    }
  });

  it("rejects a stale reference table before provider work", () => {
    const table = createPlannerReferenceTable(input());
    const changed = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, summary: "A changed canonical Brief." });
    expect(() => assertPlannerReferenceTableCurrent(table, input(changed))).toThrow("PLANNER_REFERENCE_TABLE_STALE");
    expect(() => assertPlannerReferenceTableCurrent(table, input(cleanBriefV3, "different-operation"))).toThrow("PLANNER_REFERENCE_TABLE_STALE");
  });
});
