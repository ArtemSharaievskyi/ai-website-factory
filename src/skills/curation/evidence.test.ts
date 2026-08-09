import { describe, expect, it } from "vitest";
import { assessCandidateEvidence, isSupportedRegistryLicenseEvidence } from "./evidence";

const checksum = "a".repeat(64);
const base = (overrides: Record<string, unknown> = {}) => ({
  externalSkillId: "owner/repository/skill",
  expectedExternalSkillId: "owner/repository/skill",
  expectedChecksum: checksum,
  stagedExternalSkillId: "owner/repository/skill",
  stagedChecksum: checksum,
  evaluationChecksum: checksum,
  upstreamExternalSkillId: "owner/repository/skill",
  upstreamChecksum: checksum,
  metadataUnresolved: [],
  license: "MIT",
  hasApprovalBlockingFinding: false,
  externalAuditStatus: "pass" as const,
  ...overrides,
});

describe("selected candidate evidence", () => {
  it("accepts the corrected Security external ID as an exact value", () => {
    const result = assessCandidateEvidence({
      ...base(),
      externalSkillId: "sarmakska/slipstream/supabase-rls",
      expectedExternalSkillId: "sarmakska/slipstream/supabase-rls",
      stagedExternalSkillId: "sarmakska/slipstream/supabase-rls",
      upstreamExternalSkillId: "sarmakska/slipstream/supabase-rls",
    });
    expect(result.externalSkillId).toBe("sarmakska/slipstream/supabase-rls");
    expect(result.readiness).toBe("APPROVAL_ELIGIBLE");
  });

  it("does not alias the previous Security typo", () => {
    const result = assessCandidateEvidence({
      ...base(),
      externalSkillId: "sarmaks/slipstream/supabase-rls",
      expectedExternalSkillId: "sarmakska/slipstream/supabase-rls",
      stagedExternalSkillId: "sarmakska/slipstream/supabase-rls",
      upstreamExternalSkillId: "sarmakska/slipstream/supabase-rls",
    });
    expect(result.readiness).toBe("SOURCE_UNAVAILABLE");
    expect(result.blockers.join(" ")).toContain("external ID");
  });

  it("requires the staged candidate checksum", () => {
    const result = assessCandidateEvidence(base({ stagedChecksum: "b".repeat(64) }));
    expect(result.readiness).toBe("UPSTREAM_CHANGED");
  });

  it("requires the evaluation checksum", () => {
    const result = assessCandidateEvidence(base({ evaluationChecksum: "b".repeat(64) }));
    expect(result.readiness).toBe("UPSTREAM_CHANGED");
  });

  it("requires the current upstream checksum", () => {
    const result = assessCandidateEvidence(base({ upstreamChecksum: "b".repeat(64) }));
    expect(result.upstreamStatus).toBe("STALE");
    expect(result.readiness).toBe("UPSTREAM_CHANGED");
  });

  it("marks an unverified upstream source as not current", () => {
    const result = assessCandidateEvidence(base({ upstreamChecksum: undefined, upstreamExternalSkillId: undefined }));
    expect(result.upstreamStatus).toBe("NOT_VERIFIED");
    expect(result.readiness).toBe("SOURCE_UNAVAILABLE");
  });

  it("blocks unresolved purpose metadata", () => {
    const result = assessCandidateEvidence(base({ metadataUnresolved: ["purpose"] }));
    expect(result.metadataStatus).toBe("INCOMPLETE");
    expect(result.readiness).toBe("METADATA_INCOMPLETE");
  });

  it("preserves every unresolved metadata field", () => {
    const result = assessCandidateEvidence(base({ metadataUnresolved: ["purpose", "steps"] }));
    expect(result.metadataUnresolved).toEqual(["purpose", "steps"]);
  });

  it("blocks absent license evidence", () => {
    const result = assessCandidateEvidence(base({ license: undefined }));
    expect(result.licenseEvidenceStatus).toBe("MISSING");
    expect(result.readiness).toBe("LICENSE_EVIDENCE_MISSING");
  });

  it("blocks empty license evidence", () => {
    const result = assessCandidateEvidence(base({ license: "" }));
    expect(result.licenseEvidenceStatus).toBe("MISSING");
  });

  it("rejects whitespace-only license evidence", () => {
    expect(isSupportedRegistryLicenseEvidence("   ")).toBe(false);
    expect(assessCandidateEvidence(base({ license: "   " })).licenseEvidenceStatus).toBe("MALFORMED");
  });

  it("rejects control characters in license evidence", () => {
    expect(isSupportedRegistryLicenseEvidence("MIT\nlicense")).toBe(false);
    expect(assessCandidateEvidence(base({ license: "MIT\nlicense" })).licenseEvidenceStatus).toBe("MALFORMED");
  });

  it("does not infer a license from a repository name", () => {
    const result = assessCandidateEvidence(base({ externalSkillId: "mit/repository/skill", expectedExternalSkillId: "mit/repository/skill", stagedExternalSkillId: "mit/repository/skill", upstreamExternalSkillId: "mit/repository/skill", license: undefined }));
    expect(result.licenseEvidenceStatus).toBe("MISSING");
    expect(result.readiness).toBe("LICENSE_EVIDENCE_MISSING");
  });

  it("does not treat an audit PASS as license evidence", () => {
    const result = assessCandidateEvidence(base({ license: undefined, externalAuditStatus: "pass" }));
    expect(result.externalAuditStatus).toBe("PASS");
    expect(result.readiness).toBe("LICENSE_EVIDENCE_MISSING");
  });

  it("blocks an approval-blocking local security finding", () => {
    const result = assessCandidateEvidence(base({ hasApprovalBlockingFinding: true }));
    expect(result.localSecurityStatus).toBe("BLOCKED");
    expect(result.readiness).toBe("SECURITY_BLOCKED");
  });

  it("requires an exact evaluation before readiness", () => {
    const result = assessCandidateEvidence(base({ evaluationChecksum: undefined }));
    expect(result.readiness).toBe("SOURCE_UNAVAILABLE");
    expect(result.blockers.join(" ")).toContain("evaluation");
  });

  it("allows valid explicit license evidence to satisfy the readiness contract", () => {
    const result = assessCandidateEvidence(base({ license: "Apache-2.0" }));
    expect(result.licenseEvidenceStatus).toBe("PRESENT");
    expect(result.readiness).toBe("APPROVAL_ELIGIBLE");
  });

  it("does not mutate or create approval state", () => {
    const result = assessCandidateEvidence(base());
    expect(result).not.toHaveProperty("approval");
    expect(result).not.toHaveProperty("approvedDirectory");
  });

  it("handles selected candidates independently", () => {
    const results = [
      assessCandidateEvidence(base({ externalSkillId: "codybrom/clairvoyance/module-boundaries", expectedExternalSkillId: "codybrom/clairvoyance/module-boundaries", stagedExternalSkillId: "codybrom/clairvoyance/module-boundaries", upstreamExternalSkillId: "codybrom/clairvoyance/module-boundaries", metadataUnresolved: ["purpose", "steps"], license: undefined })),
      assessCandidateEvidence(base({ externalSkillId: "masanao-ohba/claude-manifests/acceptance-criteria", expectedExternalSkillId: "masanao-ohba/claude-manifests/acceptance-criteria", stagedExternalSkillId: "masanao-ohba/claude-manifests/acceptance-criteria", upstreamExternalSkillId: "masanao-ohba/claude-manifests/acceptance-criteria", metadataUnresolved: ["purpose", "steps"], license: undefined })),
      assessCandidateEvidence(base({ externalSkillId: "sarmakska/slipstream/supabase-rls", expectedExternalSkillId: "sarmakska/slipstream/supabase-rls", stagedExternalSkillId: "sarmakska/slipstream/supabase-rls", upstreamExternalSkillId: "sarmakska/slipstream/supabase-rls", metadataUnresolved: ["purpose"], license: undefined })),
    ];
    expect(results.map((result) => result.readiness)).toEqual([
      "METADATA_INCOMPLETE",
      "METADATA_INCOMPLETE",
      "METADATA_INCOMPLETE",
    ]);
  });

  it("permits a candidate to remain human review only", () => {
    const result = assessCandidateEvidence(base({ metadataUnresolved: ["purpose"], license: undefined }));
    expect(result.readiness).not.toBe("APPROVAL_ELIGIBLE");
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("keeps external audit status advisory", () => {
    const result = assessCandidateEvidence(base({ externalAuditStatus: "unavailable" }));
    expect(result.externalAuditStatus).toBe("UNAVAILABLE");
    expect(result.readiness).toBe("APPROVAL_ELIGIBLE");
  });
});
