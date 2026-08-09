import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessCandidateEvidence,
  createHumanLicenseEvidence,
  ExternalSkillEvidenceSchema,
  extractMetadataEvidence,
} from "./evidence";
import { ExternalAdvanceEvidenceArtifactSchema } from "./external-advance-evidence";
import { SkillRegistry } from "@/skills/registry/registry";

const checksum = "a".repeat(64);
const externalSkillId = "owner/repository/skill";
const sourceRepository = "owner/repository";

const humanEvidence = (overrides: Record<string, unknown> = {}) =>
  createHumanLicenseEvidence({
    externalSkillId,
    candidateChecksum: checksum,
    sourceRepository,
    recordedAt: "2026-08-09T16:30:00.000Z",
    ...overrides,
  });

const base = (overrides: Record<string, unknown> = {}) => {
  const licenseEvidence = humanEvidence();
  return {
    externalSkillId,
    expectedExternalSkillId: externalSkillId,
    expectedChecksum: checksum,
    expectedSourceRepository: sourceRepository,
    expectedSourceRef: licenseEvidence.sourceRef,
    stagedExternalSkillId: externalSkillId,
    stagedChecksum: checksum,
    evaluationChecksum: checksum,
    upstreamExternalSkillId: externalSkillId,
    upstreamChecksum: checksum,
    metadataUnresolved: [],
    metadataEvidence: {
      steps: [],
      unresolved: [],
    },
    licenseEvidence,
    hasApprovalBlockingFinding: false,
    externalAuditStatus: "pass" as const,
    ...overrides,
  };
};

describe("Phase 4D2 external advance evidence", () => {
  it("contains exactly the four selected candidates and exact checksums", async () => {
    const artifact = ExternalAdvanceEvidenceArtifactSchema.parse(
      JSON.parse(
        await readFile(
          "docs/admin/skill-curation/external-advance-evidence-2026-08-09.json",
          "utf8",
        ),
      ),
    );
    expect(artifact.candidates.map((candidate) => candidate.externalSkillId)).toEqual([
      "fr-e-d/gaai-framework/ambiguity-detector",
      "bradyhazell/brady-plugins/review-maintainability",
      "owasp/secure-agent-playbook/web-security-review",
      "djankies/claude-configs/reviewing-test-quality",
    ]);
    expect(artifact.candidates.every((candidate) => candidate.currentness.status === "CURRENT")).toBe(true);
  });

  it("records exact Elastic-2.0 evidence without treating it as MIT", async () => {
    const artifact = JSON.parse(
      await readFile(
        "docs/admin/skill-curation/external-advance-evidence-2026-08-09.json",
        "utf8",
      ),
    ) as { candidates: Array<Record<string, unknown>> };
    const candidate = artifact.candidates[0];
    expect(candidate.licenseId).toBe("Elastic-2.0");
    expect(candidate.licensePolicyStatus).toBe("LICENSE_POLICY_REVIEW_REQUIRED");
    expect(candidate.approvalReadiness).toBe("LICENSE_POLICY_REVIEW_REQUIRED");
  });

  it("records CC-BY attribution obligations and policy review", async () => {
    const artifact = JSON.parse(
      await readFile(
        "docs/admin/skill-curation/external-advance-evidence-2026-08-09.json",
        "utf8",
      ),
    ) as { candidates: Array<Record<string, unknown>> };
    const candidate = artifact.candidates.find(
      (item) => item.externalSkillId === "owasp/secure-agent-playbook/web-security-review",
    );
    expect(candidate?.licenseId).toBe("CC-BY-4.0");
    expect(candidate?.attributionObligations).toEqual(["ATTRIBUTION_REQUIRED"]);
    expect(candidate?.licensePolicyStatus).toBe("LICENSE_POLICY_REVIEW_REQUIRED");
  });

  it("keeps djankies MIT evidence scoped pending the path-specific license check", async () => {
    const artifact = JSON.parse(
      await readFile(
        "docs/admin/skill-curation/external-advance-evidence-2026-08-09.json",
        "utf8",
      ),
    ) as { candidates: Array<Record<string, unknown>> };
    const candidate = artifact.candidates.find(
      (item) => item.externalSkillId === "djankies/claude-configs/reviewing-test-quality",
    );
    expect(candidate?.licenseId).toBe("MIT");
    expect(candidate?.licenseScope).toBe("repository-inherited-no-narrower-local-evidence");
    expect(candidate?.licensePolicyStatus).toBe("LICENSE_SCOPE_REVIEW_REQUIRED");
  });

  it.each([
    ["wrong external ID", { licenseEvidence: humanEvidence({ externalSkillId: "other/repository/skill" }) }],
    ["wrong checksum", { licenseEvidence: humanEvidence({ candidateChecksum: "b".repeat(64) }) }],
    ["wrong repository", { licenseEvidence: humanEvidence({ sourceRepository: "other/repository" }) }],
  ])("rejects %s license evidence", (_label, overrides) => {
    const result = assessCandidateEvidence(base(overrides));
    expect(result.licenseEvidenceStatus).toBe("MALFORMED");
    expect(result.readiness).toBe("EVIDENCE_CONFLICT");
  });

  it("rejects owner aliases and unsupported licenses instead of normalizing them", () => {
    const alias = assessCandidateEvidence(
      base({
        externalSkillId: "Owner/repository/skill",
        licenseEvidence: humanEvidence({ externalSkillId: "Owner/repository/skill" }),
      }),
    );
    expect(alias.readiness).toBe("SOURCE_UNAVAILABLE");
    expect(() =>
      ExternalSkillEvidenceSchema.parse({
        ...humanEvidence(),
        assertedValue: "Apache-2.0",
      }),
    ).toThrow();
  });

  it("distinguishes identified licenses from policy approval", () => {
    const elastic = assessCandidateEvidence(
      base({
        licenseEvidence: humanEvidence({
          licenseId: "Elastic-2.0",
          licensePolicyStatus: "LICENSE_POLICY_REVIEW_REQUIRED",
        }),
      }),
    );
    const mit = assessCandidateEvidence(base());
    expect(elastic.licenseEvidenceStatus).toBe("PRESENT");
    expect(elastic.readiness).toBe("LICENSE_POLICY_REVIEW_REQUIRED");
    expect(mit.readiness).toBe("APPROVAL_ELIGIBLE");
  });

  it("blocks registry approval when curation policy review is unresolved", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "external-evidence-policy-"));
    try {
      const source = path.join(root, "candidate");
      await mkdir(source, { recursive: true });
      await writeFile(
        path.join(source, "SKILL.md"),
        "---\nname: policy-test\ndescription: Policy test.\n---\n\n## Steps\n\n1. Inspect.\n2. Report.\n",
        "utf8",
      );
      const registry = new SkillRegistry(path.join(root, "registry"));
      const staged = await registry.stageLocalImport(source, {
        sourceType: "skills-sh",
        externalSkillId,
        sourceRepository: "https://github.com/owner/repository",
        normalizedContentChecksum: checksum,
        retrievedContentChecksum: checksum,
      });
      const licenseEvidence = humanEvidence({
        licenseId: "Elastic-2.0",
        licensePolicyStatus: "LICENSE_POLICY_REVIEW_REQUIRED",
      });
      await registry.recordCurationEvidence(staged.definition.id, {
        evidence: {
          license: licenseEvidence,
          metadata: {
            purpose: {
              field: "purpose",
              source: "frontmatter-description",
              lineStart: 3,
              lineEnd: 3,
              fragmentChecksum: checksum,
              summary: "Policy test.",
            },
            steps: [
              {
                field: "steps",
                source: "ordered-procedure",
                heading: "Steps",
                lineStart: 7,
                lineEnd: 8,
                fragmentChecksum: checksum,
                summary: "Inspect and report.",
              },
            ],
            unresolved: [],
          },
        },
        expectedExternalSkillId: externalSkillId,
        expectedNormalizedChecksum: checksum,
        expectedSourceRepository: sourceRepository,
      });
      await expect(
        registry.createApproval(staged.definition.id, {
          id: "policy-review-required",
          reviewedBy: "test",
          reviewedAt: "2026-08-09T16:30:00.000Z",
          decision: "approved",
          allowedRoles: ["review"],
          allowedTaskTypes: ["review-architecture"],
          allowedTools: [],
          deniedTools: [],
          allowedCommandPatterns: [],
          deniedCommandPatterns: [],
          notes: "Must remain blocked.",
        }),
      ).rejects.toMatchObject({ code: "SKILL_APPROVAL_REQUIRED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not inherit license evidence across a changed checksum", () => {
    const result = assessCandidateEvidence(base({ expectedChecksum: "b".repeat(64) }));
    expect(result.licenseEvidenceStatus).toBe("MALFORMED");
    expect(result.readiness).toBe("UPSTREAM_CHANGED");
  });

  it("extracts purpose and explicit procedures from exact local content", () => {
    const content = `---\ndescription: Review behavior.\n---\n\n## Steps\n\n1. Inspect behavior.\n2. Return evidence.\n`;
    const metadata = extractMetadataEvidence(content);
    expect(metadata.purpose?.source).toBe("frontmatter-description");
    expect(metadata.steps).toHaveLength(1);
    expect(metadata.unresolved).toEqual([]);
    expect(metadata.steps[0].fragmentChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not use a filename or prose alone as metadata evidence", () => {
    const metadata = extractMetadataEvidence("# reviewing-test-quality\n\nThis is a useful review.");
    expect(metadata.purpose).toBeUndefined();
    expect(metadata.steps).toEqual([]);
    expect(metadata.unresolved).toEqual(["purpose", "steps"]);
  });

  it("keeps optional Python inert and never grants tools", () => {
    const optional = assessCandidateEvidence(base({ toolCompatibility: "OPTIONAL_ONLY" }));
    const incompatible = assessCandidateEvidence(base({ toolCompatibility: "INCOMPATIBLE" }));
    expect(optional.readiness).toBe("APPROVAL_ELIGIBLE");
    expect(optional.toolCompatibility).toBe("OPTIONAL_ONLY");
    expect(incompatible.readiness).toBe("TOOL_INCOMPATIBLE");
    expect(optional).not.toHaveProperty("allowedTools");
  });

  it("keeps role and overlap boundaries explicit", () => {
    expect(assessCandidateEvidence(base({ roleFit: "MISMATCH" })).readiness).toBe("ROLE_MISMATCH");
    expect(assessCandidateEvidence(base({ overlapStatus: "NOT_JUSTIFIED" })).readiness).toBe(
      "OVERLAP_NO_LONGER_JUSTIFIED",
    );
  });

  it("preserves the no-approval invariants in the artifact", async () => {
    const artifact = ExternalAdvanceEvidenceArtifactSchema.parse(
      JSON.parse(
        await readFile(
          "docs/admin/skill-curation/external-advance-evidence-2026-08-09.json",
          "utf8",
        ),
      ),
    );
    expect(artifact.approvalCalled).toBe(false);
    expect(artifact.assignmentsChanged).toBe(false);
    expect(artifact.approvedExternalSkillCount).toBe(3);
    expect(artifact.assignedExternalSkillCount).toBe(3);
    expect(artifact.approvedInternalSkillCount).toBe(0);
    expect(artifact.assignedInternalSkillCount).toBe(0);
    expect(JSON.stringify(artifact)).not.toContain("SKILL.md");
  });
});
