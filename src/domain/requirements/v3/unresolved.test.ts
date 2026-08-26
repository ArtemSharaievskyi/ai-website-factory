import { describe, expect, it } from "vitest";
import { cleanBriefV3, pilotShapedV1Brief, representativeV1Brief } from "./fixtures";
import { BriefChangeSetSchema } from "./changeset";
import { migrateV1ToCanonicalBriefV3 } from "./migrate-v1";
import { reduceBriefChangeSet } from "./reducer";
import { canonicalBriefChecksum } from "./normalize";
import { evaluateBriefReadiness } from "./readiness";
import { canonicalBriefToPlannerBrief } from "@/agents/planner/brief-context";
import { CanonicalBriefV3Schema } from "./schema";
import {
  canonicalUnresolvedBlockingStages,
  canonicalUnresolvedBlocksStage,
  isPhotoRightsUnresolvedRequirement,
} from "./unresolved";

describe("canonical unresolved stage ownership", () => {
  it("does not turn every unresolved item into a Planning blocker", () => {
    const brief = CanonicalBriefV3Schema.parse({
      ...cleanBriefV3,
      unresolved: [
        { target: "FINAL_LEGAL_FACTS_REQUIRED", reason: "Final legal facts are required before publication.", sourceRefs: ["fixture:legal"], blockingStages: ["PUBLICATION"] as const },
        { target: "PHOTO_RIGHTS_PROVENANCE_REQUIRED", reason: "Photo rights provenance is required before asset publication.", sourceRefs: ["fixture:photo"], blockingStages: ["ASSET_REVIEW", "PUBLICATION"] as const },
        { target: "REQUIREMENT:planning-choice", reason: "Choose the approved service workflow.", sourceRefs: ["fixture:planning"], blockingStages: ["PLANNING"] as const },
      ],
    });

    expect(canonicalUnresolvedBlockingStages(brief, brief.unresolved[0]!)).toEqual(["PUBLICATION"]);
    expect(canonicalUnresolvedBlocksStage(brief, brief.unresolved[0]!, "PLANNING")).toBe(false);
    expect(canonicalUnresolvedBlocksStage(brief, brief.unresolved[1]!, "PLANNING")).toBe(false);
    expect(canonicalUnresolvedBlocksStage(brief, brief.unresolved[2]!, "PLANNING")).toBe(true);
    expect(evaluateBriefReadiness({ brief }).readyForApproval).toBe(false);
    expect(evaluateBriefReadiness({ brief }).nonBlockingUnresolvedTargets).toEqual(["FINAL_LEGAL_FACTS_REQUIRED", "PHOTO_RIGHTS_PROVENANCE_REQUIRED"]);
    expect(evaluateBriefReadiness({ brief }).publicationBlockers).toEqual(expect.arrayContaining(["FINAL_LEGAL_FACTS_REQUIRED", "PHOTO_RIGHTS_PROVENANCE_REQUIRED", "CURRENT_BRIEF_UNRESOLVED"]));
  });

  it("classifies historical legal and photo-rights items conservatively without requiring new checksum fields", () => {
    const historical = migrateV1ToCanonicalBriefV3(pilotShapedV1Brief);
    const legal = historical.unresolved[0]!;
    expect(legal.blockingStages).toBeUndefined();
    expect(canonicalUnresolvedBlocksStage(historical, legal, "PLANNING")).toBe(false);
    const photo = { target: "PHOTO_RIGHTS_PROVENANCE_REQUIRED", reason: "Photo rights provenance is required before publication.", sourceRefs: ["fixture:photo"] };
    expect(isPhotoRightsUnresolvedRequirement(photo)).toBe(true);
    expect(canonicalUnresolvedBlockingStages(historical, photo)).toEqual(["ASSET_REVIEW", "PUBLICATION"]);
    expect(canonicalBriefChecksum(historical)).toBe(canonicalBriefChecksum({ ...historical, unresolved: historical.unresolved.map(({ target, reason, sourceRefs }) => ({ target, reason, sourceRefs })) }));
  });

  it("assigns host-owned stage metadata to new canonical unresolved items", () => {
    const reduction = reduceBriefChangeSet(cleanBriefV3, {
      contractVersion: 1,
      changes: [],
      unresolved: [{ target: "PHOTO_RIGHTS_PROVENANCE_REQUIRED", reason: "Photo rights provenance is required before publication.", sourceRefs: ["fixture:photo"] }],
    });
    const next = reduction.after;
    expect(next.unresolved[0]?.blockingStages).toEqual(["ASSET_REVIEW", "PUBLICATION"]);
    expect(reduction.changed).toBe(true);
    expect(reduction.effectiveDelta).toContainEqual(expect.objectContaining({ target: "UNRESOLVED:PHOTO_RIGHTS_PROVENANCE_REQUIRED", operation: "UPSERT" }));
  });

  it("keeps unknown historical unresolved items fail-closed for Planning", () => {
    const brief = { ...cleanBriefV3, unresolved: [{ target: "REQUIREMENT:unknown", reason: "An unspecified requirement remains open.", sourceRefs: ["fixture:unknown"] }] };
    expect(canonicalUnresolvedBlocksStage(brief, brief.unresolved[0]!, "PLANNING")).toBe(true);
    expect(evaluateBriefReadiness({ brief }).approvalBlockers).toContainEqual({ code: "UNRESOLVED_CANONICAL_REQUIREMENT", target: "REQUIREMENT:unknown" });
  });

  it("keeps approval ownership distinct from later-stage deferral", () => {
    const brief = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, unresolved: [{ target: "REQUIREMENT:approval-choice", reason: "An approval decision remains open.", sourceRefs: ["fixture:approval"], blockingStages: ["BRIEF_APPROVAL"] }] });
    const result = evaluateBriefReadiness({ brief });
    expect(result.readyForApproval).toBe(false);
    expect(result.nonBlockingUnresolvedTargets).toEqual([]);
  });

  it("does not allow a provider changeset to author lifecycle ownership", () => {
    expect(BriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [], unresolved: [{ target: "PHOTO_RIGHTS_PROVENANCE_REQUIRED", reason: "Photo rights provenance is required.", sourceRefs: ["fixture:photo"], blockingStages: ["PLANNING"] }] }).success).toBe(false);
  });

  it("normalizes ownership stage order without materializing historical metadata", () => {
    const ordered = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, unresolved: [{ target: "PHOTO_RIGHTS_PROVENANCE_REQUIRED", reason: "Photo rights provenance is required.", sourceRefs: ["fixture:photo"], blockingStages: ["PUBLICATION", "ASSET_REVIEW"] }] });
    const normalized = CanonicalBriefV3Schema.parse({ ...ordered, unresolved: [{ ...ordered.unresolved[0]!, blockingStages: ["ASSET_REVIEW", "PUBLICATION"] }] });
    expect(canonicalBriefChecksum(ordered)).toBe(canonicalBriefChecksum(normalized));
    expect(cleanBriefV3.unresolved).toEqual([]);
  });

  it("keeps legacy compatibility from overriding canonical stage ownership", () => {
    const canonical = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, unresolved: [{ target: "PHOTO_RIGHTS_PROVENANCE_REQUIRED", reason: "Photo rights provenance is required before publication.", sourceRefs: ["fixture:photo"], blockingStages: ["ASSET_REVIEW", "PUBLICATION"] }] });
    const legacy = representativeV1Brief;
    const mapped = canonicalBriefToPlannerBrief(canonical, legacy, { approved: true, approvedAt: "2026-01-01T00:00:00.000Z", approvedBy: "synthetic-user", approvedCanonicalChecksum: canonicalBriefChecksum(canonical) });
    expect(legacy.unresolvedItems).toEqual([]);
    expect(mapped.unresolvedItems).toHaveLength(1);
    expect(mapped.unresolvedItems[0]?.blocking).toBe(false);
  });
});
