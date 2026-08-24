import { describe, expect, it } from "vitest";
import {
  ArchitectureReviewProviderOutputSchema,
  ReviewEvidenceIdSchema,
} from "@/domain/review/schema";
import {
  createReviewEvidenceCatalog,
  resolveProviderEvidenceRefs,
  resolveProviderReviewEvidence,
} from "./evidence";

const projectId = "11111111-1111-4111-8111-111111111111";
const refs = ["brief:projectSummary", "planning:architecture", "planning:traceability"];
const catalog = () => createReviewEvidenceCatalog({
  projectId,
  projectVersion: 1,
  evidenceRefs: refs,
  requestContext: { idempotencyKey: "synthetic-request", expectedRowVersion: 1 },
});

describe("host-issued reviewer evidence catalogs", () => {
  it("A: resolves a valid issued ID to canonical provenance", () => {
    const current = catalog();
    const id = current.entries[0]!.id;
    expect(resolveProviderEvidenceRefs(current, [id])).toEqual({
      canonicalRefs: [current.entries[0]!.canonicalRef],
      provenance: [{ evidenceId: id, canonicalRef: current.entries[0]!.canonicalRef }],
    });
  });

  it("B and J: rejects canonical paths and provider-authored provenance at the output schema", () => {
    const current = catalog();
    const id = current.entries[0]!.id;
    const base = { verdict: "APPROVED" as const, findings: [], reviewedArtifactRefs: [id] };
    expect(ArchitectureReviewProviderOutputSchema.safeParse({ ...base, reviewedArtifactRefs: ["acceptedPlanningPackage.architecture"] }).success).toBe(false);
    expect(ArchitectureReviewProviderOutputSchema.safeParse({ ...base, evidenceProvenance: [{ evidenceId: id, canonicalRef: "planning:architecture" }] }).success).toBe(false);
  });

  it("C: rejects an unknown malformed E999 reference", () => {
    expect(ReviewEvidenceIdSchema.safeParse("E999").success).toBe(false);
  });

  it("D-F: rejects IDs issued for another request, project, or version", () => {
    const current = catalog();
    const otherRequest = createReviewEvidenceCatalog({ projectId, projectVersion: 1, evidenceRefs: refs, requestContext: { idempotencyKey: "other-request", expectedRowVersion: 1 } });
    const otherProject = createReviewEvidenceCatalog({ projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 1, evidenceRefs: refs, requestContext: { idempotencyKey: "synthetic-request", expectedRowVersion: 1 } });
    const otherVersion = createReviewEvidenceCatalog({ projectId, projectVersion: 2, evidenceRefs: refs, requestContext: { idempotencyKey: "synthetic-request", expectedRowVersion: 1 } });
    for (const foreign of [otherRequest, otherProject, otherVersion]) {
      const foreignId = foreign.entries[0]!.id;
      expect(foreignId).not.toBe(current.entries[0]!.id);
      expect(() => resolveProviderEvidenceRefs(current, [foreignId])).toThrow();
    }
  });

  it("G: normalizes duplicate evidence IDs deterministically", () => {
    const current = catalog();
    const id = current.entries[0]!.id;
    const resolved = resolveProviderReviewEvidence(current, {
      reviewedArtifactRefs: [id, id],
      findings: [{ evidenceRefs: [id, id], affectedArtifacts: [id, id] }],
    });
    expect(resolved.reviewedArtifactRefs).toEqual([current.entries[0]!.canonicalRef]);
    expect(resolved.findings[0]?.evidenceRefs).toEqual([current.entries[0]!.canonicalRef]);
    expect(resolved.findings[0]?.affectedArtifacts).toEqual([current.entries[0]!.canonicalRef]);
    expect(resolved.provenance).toHaveLength(1);
  });
});
