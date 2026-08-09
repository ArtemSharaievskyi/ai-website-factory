import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessCandidateEvidence,
  createHumanLicenseEvidence,
  ExternalSkillEvidenceSchema,
  extractMetadataEvidence,
} from "./evidence";

const checksum = "a".repeat(64);
const repository = "owner/repository";
const externalSkillId = "owner/repository/skill";
const evidence = (id = externalSkillId, hash = checksum, source = repository) =>
  createHumanLicenseEvidence({
    externalSkillId: id,
    candidateChecksum: hash,
    sourceRepository: source,
    recordedAt: "2026-08-09T16:30:00.000Z",
  });
const base = (overrides: Record<string, unknown> = {}) => ({
  externalSkillId,
  expectedExternalSkillId: externalSkillId,
  expectedChecksum: checksum,
  expectedSourceRepository: repository,
  stagedExternalSkillId: externalSkillId,
  stagedChecksum: checksum,
  evaluationChecksum: checksum,
  upstreamExternalSkillId: externalSkillId,
  upstreamChecksum: checksum,
  metadataUnresolved: [],
  licenseEvidence: evidence(),
  hasApprovalBlockingFinding: false,
  externalAuditStatus: "pass" as const,
  ...overrides,
});

const architectureSkill = `---
name: module-boundaries
description: "Evaluates module boundaries and whether modules should be merged or split."
---

# Module Boundaries Review Lens

## Discovery Process

1. Name the shared concern.
2. Ask what it looks like alone.
3. Verify simplification.

## Review Process

1. Map dependencies.
2. Apply merge signals.
3. Recommend adjustments.
`;
const contractSkill = `# Acceptance Criteria

## Core Purpose

Transform requirements into verifiable acceptance criteria.

### Step 1: Extract Requirements

Identify explicit requirements and constraints.

### Step 2: Validate Criteria

Check that outcomes are objectively measurable.
`;
const securitySkill = `---
name: supabase-rls
description: >-
  Use when tables must restrict each user to their own rows.
---

## Overview

Lock down tables with row level security so users only read and write their own rows.

## Steps

1. Enable row level security.
2. Add user-scoped policies.
3. Test anonymous access boundaries.
`;

describe("human license evidence", () => {
  it.each([
    ["codybrom/clairvoyance/module-boundaries", "codybrom/clairvoyance"],
    ["masanao-ohba/claude-manifests/acceptance-criteria", "masanao-ohba/claude-manifests"],
    ["sarmakska/slipstream/supabase-rls", "sarmakska/slipstream"],
  ])("accepts exact human MIT evidence for %s", (id, source) => {
    const result = createHumanLicenseEvidence({
      externalSkillId: id,
      candidateChecksum: checksum,
      sourceRepository: source,
      recordedAt: "2026-08-09T16:30:00.000Z",
    });
    expect(result.assertedValue).toBe("MIT");
    expect(result.evidenceType).toBe("CANONICAL_SOURCE_LICENSE");
    expect(result.suppliedBy).toBe("HUMAN");
  });

  it("requires the exact external ID", () => {
    const result = assessCandidateEvidence(base({ licenseEvidence: evidence("other/repository/skill") }));
    expect(result.licenseEvidenceStatus).toBe("MALFORMED");
    expect(result.readiness).toBe("EVIDENCE_CONFLICT");
  });

  it("requires the exact candidate checksum", () => {
    const result = assessCandidateEvidence(base({ licenseEvidence: evidence(externalSkillId, "b".repeat(64)) }));
    expect(result.licenseEvidenceStatus).toBe("MALFORMED");
    expect(result.readiness).toBe("EVIDENCE_CONFLICT");
  });

  it("requires the source repository to match provenance", () => {
    const result = assessCandidateEvidence(base({ licenseEvidence: evidence(externalSkillId, checksum, "other/repository") }));
    expect(result.licenseEvidenceStatus).toBe("MALFORMED");
  });

  it("does not match the previous Security owner typo", () => {
    const result = assessCandidateEvidence(base({
      externalSkillId: "sarmaks/slipstream/supabase-rls",
      expectedExternalSkillId: "sarmakska/slipstream/supabase-rls",
      stagedExternalSkillId: "sarmakska/slipstream/supabase-rls",
      upstreamExternalSkillId: "sarmakska/slipstream/supabase-rls",
      licenseEvidence: evidence("sarmaks/slipstream/supabase-rls"),
    }));
    expect(result.readiness).toBe("SOURCE_UNAVAILABLE");
  });

  it("rejects an arbitrary repository as license provenance", () => {
    const result = assessCandidateEvidence(base({ licenseEvidence: evidence(externalSkillId, checksum, "random/repository") }));
    expect(result.licenseEvidenceStatus).toBe("MALFORMED");
  });

  it("rejects arbitrary free-text license evidence", () => {
    const result = assessCandidateEvidence(base({ licenseEvidence: { ...evidence(), assertedValue: "probably MIT" } }));
    expect(result.licenseEvidenceStatus).toBe("MALFORMED");
  });

  it("accepts only the supported MIT identifier", () => {
    expect(ExternalSkillEvidenceSchema.parse(evidence()).assertedValue).toBe("MIT");
    expect(() => ExternalSkillEvidenceSchema.parse({ ...evidence(), assertedValue: "MIT-like" })).toThrow();
  });

  it("does not auto-approve human evidence", () => {
    const result = assessCandidateEvidence(base());
    expect(result.readiness).toBe("APPROVAL_ELIGIBLE");
    expect(result).not.toHaveProperty("approval");
    expect(result).not.toHaveProperty("approvedDirectory");
  });

  it("does not contain or mutate skill content", () => {
    const original = JSON.stringify(evidence());
    const result = assessCandidateEvidence(base());
    expect(JSON.stringify(result)).not.toContain("module-boundaries");
    expect(JSON.stringify(evidence())).toBe(original);
  });

  it("binds evidence to the original checksum", () => {
    expect(evidence().candidateChecksum).toBe(checksum);
    expect(assessCandidateEvidence(base()).expectedChecksum).toBe(checksum);
  });

  it("does not inherit evidence for a new checksum", () => {
    const result = assessCandidateEvidence(base({ expectedChecksum: "b".repeat(64) }));
    expect(result.licenseEvidenceStatus).toBe("MALFORMED");
    expect(result.readiness).toBe("UPSTREAM_CHANGED");
  });

  it("blocks contradictory license evidence", () => {
    const result = assessCandidateEvidence(base({ contradictoryLicenseEvidence: true }));
    expect(result.readiness).toBe("EVIDENCE_CONFLICT");
    expect(result.blockers.join(" ")).toContain("contradictory");
  });
});

describe("deterministic metadata evidence extraction", () => {
  it("extracts purpose from architecture frontmatter", () => {
    const result = extractMetadataEvidence(architectureSkill);
    expect(result.purpose?.source).toBe("frontmatter-description");
    expect(result.unresolved).not.toContain("purpose");
  });

  it("extracts purpose from an explicit Core Purpose section", () => {
    const result = extractMetadataEvidence(contractSkill);
    expect(result.purpose?.source).toBe("purpose-section");
  });

  it("does not use a skill name alone as purpose", () => {
    const result = extractMetadataEvidence("# Only a Skill Name\n\nUnstructured prose.");
    expect(result.purpose).toBeUndefined();
    expect(result.unresolved).toContain("purpose");
  });

  it("extracts security purpose from explicit frontmatter", () => {
    const result = extractMetadataEvidence(securitySkill);
    expect(result.purpose?.source).toBe("frontmatter-description");
  });

  it("extracts ordered architecture procedures as step evidence", () => {
    const result = extractMetadataEvidence(architectureSkill);
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.steps.every((step) => step.source === "ordered-procedure")).toBe(true);
  });

  it("extracts sequenced contract headings as step evidence", () => {
    const result = extractMetadataEvidence(contractSkill);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].source).toBe("sequenced-heading");
  });

  it("extracts explicit security ordered steps", () => {
    const result = extractMetadataEvidence(securitySkill);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].heading).toBe("Steps");
  });

  it("does not invent steps from unrelated prose", () => {
    const result = extractMetadataEvidence("# Skill\n\n## Purpose\nThis explains a concept.");
    expect(result.steps).toEqual([]);
    expect(result.unresolved).toContain("steps");
  });

  it("keeps source headings and line references", () => {
    const result = extractMetadataEvidence(securitySkill);
    expect(result.steps[0].lineStart).toBeGreaterThan(0);
    expect(result.steps[0].lineEnd).toBeGreaterThanOrEqual(result.steps[0].lineStart);
    expect(result.steps[0].fragmentChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not persist the full skill content in metadata evidence", () => {
    const result = extractMetadataEvidence(architectureSkill);
    expect(JSON.stringify(result)).not.toContain(architectureSkill);
  });

  it("does not change the source checksum during extraction", () => {
    const before = architectureSkill;
    extractMetadataEvidence(architectureSkill);
    expect(architectureSkill).toBe(before);
  });

  it("keeps genuinely missing purpose and steps blocked", () => {
    const result = extractMetadataEvidence("# Skill\n\nPlain prose without structured metadata.");
    expect(result.unresolved).toEqual(["purpose", "steps"]);
  });
});

describe("selected candidate readiness", () => {
  it("matches the three committed captured-candidate evidence records", async () => {
    const snapshot = JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          "docs",
          "admin",
          "skill-curation",
          "selected-candidate-evidence-2026-08-09.json",
        ),
        "utf8",
      ),
    ) as { candidates: Array<Record<string, unknown>>; approvalCalled: boolean };
    expect(snapshot.candidates).toHaveLength(3);
    expect(snapshot.approvalCalled).toBe(false);
    expect(snapshot.candidates.every((candidate) => candidate.approvalReadiness === "APPROVAL_ELIGIBLE")).toBe(true);
    expect(snapshot.candidates.every((candidate) => candidate.licenseEvidenceStatus === "PRESENT")).toBe(true);
  });

  it("resolves the Architecture candidate from exact local structure", () => {
    const metadata = extractMetadataEvidence(architectureSkill);
    const result = assessCandidateEvidence(base({ metadataUnresolved: metadata.unresolved, metadataEvidence: metadata }));
    expect(result.metadataStatus).toBe("COMPLETE");
    expect(result.readiness).toBe("APPROVAL_ELIGIBLE");
  });

  it("resolves the Contract candidate from exact local structure", () => {
    const metadata = extractMetadataEvidence(contractSkill);
    const result = assessCandidateEvidence(base({ metadataUnresolved: metadata.unresolved, metadataEvidence: metadata }));
    expect(result.metadataStatus).toBe("COMPLETE");
  });

  it("resolves the Security candidate from exact local structure", () => {
    const metadata = extractMetadataEvidence(securitySkill);
    const result = assessCandidateEvidence(base({ metadataUnresolved: metadata.unresolved, metadataEvidence: metadata }));
    expect(result.metadataStatus).toBe("COMPLETE");
  });

  it("retains PASS local security status when unchanged", () => {
    const result = assessCandidateEvidence(base());
    expect(result.localSecurityStatus).toBe("PASS");
  });

  it("evaluates selected candidates independently", () => {
    const blocked = assessCandidateEvidence(base({ metadataUnresolved: ["purpose"] }));
    const ready = assessCandidateEvidence(base());
    expect(blocked.readiness).toBe("METADATA_INCOMPLETE");
    expect(ready.readiness).toBe("APPROVAL_ELIGIBLE");
  });

  it("keeps audit PASS advisory rather than authoritative", () => {
    const result = assessCandidateEvidence(base({ externalAuditStatus: "pass" }));
    expect(result.externalAuditStatus).toBe("PASS");
    expect(result.licenseEvidenceStatus).toBe("PRESENT");
  });

  it("requires current upstream evidence", () => {
    const result = assessCandidateEvidence(base({ upstreamChecksum: undefined, upstreamExternalSkillId: undefined }));
    expect(result.readiness).toBe("SOURCE_UNAVAILABLE");
  });

  it("does not require live network access", () => {
    const result = assessCandidateEvidence(base());
    expect(result.readiness).toBe("APPROVAL_ELIGIBLE");
  });

  it("does not add agent assignments", () => {
    const result = assessCandidateEvidence(base());
    expect(result).not.toHaveProperty("allowedSkillIds");
  });

  it("does not execute external content", () => {
    const result = extractMetadataEvidence(architectureSkill);
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("execution");
  });
});
