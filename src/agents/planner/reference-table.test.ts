import { describe, expect, it } from "vitest";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { assertPlannerReferenceTableCurrent, createPlannerReferenceTable, plannerProviderReferenceProtocol } from "./reference-table";

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
  });

  it("rejects a stale reference table before provider work", () => {
    const table = createPlannerReferenceTable(input());
    const changed = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, summary: "A changed canonical Brief." });
    expect(() => assertPlannerReferenceTableCurrent(table, input(changed))).toThrow("PLANNER_REFERENCE_TABLE_STALE");
    expect(() => assertPlannerReferenceTableCurrent(table, input(cleanBriefV3, "different-operation"))).toThrow("PLANNER_REFERENCE_TABLE_STALE");
  });
});
