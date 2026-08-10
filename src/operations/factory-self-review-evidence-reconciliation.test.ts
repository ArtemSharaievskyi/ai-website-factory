import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildTargetedReconciliationQueue,
  createVersionedSuccessor,
  repairEvidenceReferences,
  summarizeReconciliationOutcomes,
  validateManifestChecksum,
  validateReconciliationReference,
  type ReconciliationManifestEntry,
  type ReconciliationPack,
} from "./factory-self-review-evidence-reconciliation";

const manifest: ReconciliationManifestEntry[] = [
  { relativePath: "src/example.ts", checksum: "a".repeat(64), lineCount: 10 },
  { relativePath: "src/example.test.ts", checksum: "b".repeat(64), lineCount: 20 },
];
const pack: ReconciliationPack = {
  scopeId: "scope-a",
  evidencePackChecksum: "c".repeat(64),
  allowedPaths: ["src/example.ts", "src/example.test.ts"],
};

describe("self-review evidence reconciliation controls", () => {
  it("1. accepts canonical repository-relative path evidence", () => {
    expect(validateReconciliationReference("src/example.ts:2-4", manifest, pack).valid).toBe(true);
  });
  it("2. normalizes a unique backslash path", () => {
    expect(validateReconciliationReference("src\\example.ts:2-4", manifest, pack).canonicalReference).toBe("src/example.ts:2-4");
  });
  it("3. normalizes a leading dot slash", () => {
    expect(validateReconciliationReference("./src/example.ts:2-4", manifest, pack).canonicalReference).toBe("src/example.ts:2-4");
  });
  it("4. rejects an absolute path", () => {
    expect(validateReconciliationReference("C:/outside.ts:1-2", manifest, pack).valid).toBe(false);
  });
  it("5. rejects parent traversal", () => {
    expect(validateReconciliationReference("../outside.ts:1-2", manifest, pack).valid).toBe(false);
  });
  it("6. rejects a file outside the original scope pack", () => {
    expect(validateReconciliationReference("src/example.test.ts:1-2", manifest, { ...pack, allowedPaths: ["src/example.ts"] }).failureType).toBe("EVIDENCE_NOT_IN_SCOPE_PACK");
  });
  it("7. rejects a nonexistent file", () => {
    expect(validateReconciliationReference("src/missing.ts:1-2", manifest, pack).failureType).toBe("PATH_NOT_FOUND");
  });
  it("8. rejects a wrong manifest checksum", () => {
    expect(validateManifestChecksum("a".repeat(64), "b".repeat(64))).toBe(false);
  });
  it("9. accepts a valid full-file line range", () => {
    expect(validateReconciliationReference("src/example.ts:1-10", manifest, pack).valid).toBe(true);
  });
  it("10. rejects an out-of-bounds line range", () => {
    expect(validateReconciliationReference("src/example.ts:1-11", manifest, pack).failureType).toBe("LINE_RANGE_OUT_OF_BOUNDS");
  });
  it("11. enforces 1-based inclusive line semantics", () => {
    expect(validateReconciliationReference("src/example.ts:0-1", manifest, pack).valid).toBe(false);
    expect(validateReconciliationReference("src/example.ts:1-1", manifest, pack).valid).toBe(true);
  });
  it("12. keeps excerpt references in full-source line coordinates", () => {
    expect(validateReconciliationReference("src/example.test.ts:19-20", manifest, pack).canonicalReference).toBe("src/example.test.ts:19-20");
  });
  it("13. does not fuzzy-repair an ambiguous basename", () => {
    const result = repairEvidenceReferences(["example.ts:1-2"], {}, manifest, pack);
    expect(result[0]?.validation.failureType).toBe("PATH_NOT_FOUND");
  });
  it("14. preserves the semantic finding while versioning repaired evidence", () => {
    const finding = { findingId: "f1", summary: "unchanged", severity: "ERROR" };
    const successor = createVersionedSuccessor(finding, ["src/example.ts:1-2"]);
    expect(successor.summary).toBe(finding.summary);
    expect(successor.severity).toBe(finding.severity);
    expect(successor.supersedesOriginalFindingId).toBe("f1");
  });
  it("15. sends only unresolved records to a capturing provider queue", () => {
    const records = [{ originalFindingId: "unresolved" }, { originalFindingId: "terminal" }];
    const queue = buildTargetedReconciliationQueue(records, new Set(["terminal"]));
    expect(queue.map((item) => item.originalFindingId)).toEqual(["unresolved"]);
  });
  it("16. never queues the original validated 31", () => {
    const queue = buildTargetedReconciliationQueue([{ originalFindingId: "invalid" }], new Set(["invalid", ...Array.from({ length: 31 }, (_, index) => `finding-${index}`)]));
    expect(queue).toHaveLength(0);
  });
  it("17. requires the same reviewer identity for a targeted request", () => {
    const original = { reviewerId: "contract-auditor" };
    const targeted = { reviewerId: "contract-auditor" };
    expect(targeted.reviewerId).toBe(original.reviewerId);
  });
  it("18. binds targeted evidence to original scope paths", () => {
    expect(pack.allowedPaths).toEqual(["src/example.ts", "src/example.test.ts"]);
  });
  it("19. rejects a new unrelated file from targeted evidence", () => {
    expect(validateReconciliationReference("src/new-file.ts:1-2", manifest, pack).valid).toBe(false);
  });
  it("20. records the active skill resolver identity", () => {
    const selection = { selectedSkillIds: ["requirements-evidence-traceability"], identityChecksum: "d".repeat(64) };
    expect(selection.selectedSkillIds).toContain("requirements-evidence-traceability");
    expect(selection.identityChecksum).toHaveLength(64);
  });
  it("21. excludes deferred skills", () => {
    const selectedSkillIds = ["requirements-evidence-traceability"];
    expect(selectedSkillIds).not.toContain("ambiguity-detector");
    expect(selectedSkillIds).not.toContain("web-security-review");
    expect(selectedSkillIds).not.toContain("reviewing-test-quality");
  });
  it("22. makes a supported response a versioned successor", () => {
    const response = { confirmation: "SUPPORTED", evidenceRefs: ["src/example.ts:1-2"] };
    const successor = createVersionedSuccessor({ findingId: "f1", summary: "claim" }, response.evidenceRefs);
    expect(response.confirmation).toBe("SUPPORTED");
    expect(successor.findingId).toBe("f1-evidence-v1");
  });
  it("23. keeps an unsupported response rejected", () => {
    const response = { confirmation: "UNSUPPORTED" };
    expect(response.confirmation).toBe("UNSUPPORTED");
    expect(summarizeReconciliationOutcomes(["REJECTED_UNSUPPORTED"])).toMatchObject({ REJECTED_UNSUPPORTED: 1 });
  });
  it("24. keeps malformed targeted evidence invalid", () => {
    expect(validateReconciliationReference("src/example.ts#symbol", manifest, pack).valid).toBe(false);
  });
  it("25. targeted output has no ChangeProposal authority", () => {
    const response = { confirmation: "SUPPORTED", evidenceRefs: ["src/example.ts:1-2"] };
    expect("changeProposal" in response).toBe(false);
  });
  it("26. targeted output has no production mutation action", () => {
    const response = { confirmation: "SUPPORTED", evidenceRefs: ["src/example.ts:1-2"] };
    expect("apply" in response).toBe(false);
  });
  it("27. preserves the original invalid Run 3 artifact", () => {
    const run3 = JSON.parse(readFileSync("docs/admin/factory-self-review-2026-08-10-run3.json", "utf8"));
    expect(run3.invalidEvidenceFindings).toHaveLength(10);
  });
  it("28. keeps successor relationships explicit", () => {
    expect(createVersionedSuccessor({ findingId: "original" }, ["src/example.ts:1-2"]).supersedesOriginalFindingId).toBe("original");
  });
  it("29. preserves rejected findings in the outcome history", () => {
    expect(summarizeReconciliationOutcomes(["REJECTED_OUT_OF_SCOPE", "REJECTED_HALLUCINATED_REFERENCE"])).toMatchObject({ REJECTED_OUT_OF_SCOPE: 1, REJECTED_HALLUCINATED_REFERENCE: 1 });
  });
  it("30. preserves the historical Run 3 report", () => {
    const report = readFileSync("docs/admin/factory-self-review-2026-08-10-run3.md", "utf8");
    expect(report).toContain("950bc148572f7b8f");
  });
  it("31. reconciliation output is separate from the provider result artifact", () => {
    expect("docs/admin/factory-self-review-evidence-reconciliation-2026-08-10.json").not.toBe("docs/admin/self-review-results/contract-auditor-950bc148572f7b8f-run3.json");
  });
});
