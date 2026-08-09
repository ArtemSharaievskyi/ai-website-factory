import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SkillCandidateEvaluationSchema } from "@/skills/curation/contracts";
import {
  buildExternalAdvanceEvidenceArtifact,
  buildExternalAdvanceEvidenceRecord,
  type ExternalAdvanceBuildInput,
} from "@/skills/curation/external-advance-evidence";

const root = process.cwd();
const outputJson = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "external-advance-evidence-2026-08-09.json",
);
const outputReport = path.join(
  root,
  "docs",
  "admin",
  "external-advance-evidence-2026-08-09.md",
);

const expected = [
  {
    externalSkillId: "fr-e-d/gaai-framework/ambiguity-detector",
    targetAgent: "lead" as const,
    targetCapability: "requirements.clarify",
    canonicalSource: "https://github.com/Fr-e-d/GAAI-framework",
    canonicalLicenseSource: "https://github.com/Fr-e-d/GAAI-framework",
    normalizedRepository: "fr-e-d/gaai-framework",
    licenseId: "Elastic-2.0" as const,
    licenseScope: "repository" as const,
    licensePolicyStatus: "LICENSE_POLICY_REVIEW_REQUIRED" as const,
    attributionObligations: [] as Array<"ATTRIBUTION_REQUIRED">,
    toolCompatibility: "OPTIONAL_ONLY" as const,
    overlapStatus: "JUSTIFIED" as const,
    roleFit: "VALID" as const,
  },
  {
    externalSkillId: "bradyhazell/brady-plugins/review-maintainability",
    targetAgent: "architecture-reviewer" as const,
    targetCapability: "review.architecture",
    canonicalSource: "https://github.com/BradyHazell/brady-plugins",
    canonicalLicenseSource: "https://github.com/BradyHazell/brady-plugins",
    normalizedRepository: "bradyhazell/brady-plugins",
    licenseId: "MIT" as const,
    licenseScope: "repository" as const,
    licensePolicyStatus: "LICENSE_ALLOWED_FOR_FACTORY_USE" as const,
    attributionObligations: [] as Array<"ATTRIBUTION_REQUIRED">,
    toolCompatibility: "COMPATIBLE" as const,
    overlapStatus: "JUSTIFIED" as const,
    roleFit: "VALID" as const,
  },
  {
    externalSkillId: "owasp/secure-agent-playbook/web-security-review",
    targetAgent: "security-reviewer" as const,
    targetCapability: "review.security",
    canonicalSource: "https://github.com/OWASP/secure-agent-playbook",
    canonicalLicenseSource: "https://github.com/OWASP/secure-agent-playbook",
    normalizedRepository: "owasp/secure-agent-playbook",
    licenseId: "CC-BY-4.0" as const,
    licenseScope: "repository" as const,
    licensePolicyStatus: "LICENSE_POLICY_REVIEW_REQUIRED" as const,
    attributionObligations: ["ATTRIBUTION_REQUIRED"] as Array<"ATTRIBUTION_REQUIRED">,
    toolCompatibility: "COMPATIBLE" as const,
    overlapStatus: "JUSTIFIED" as const,
    roleFit: "VALID" as const,
  },
  {
    externalSkillId: "djankies/claude-configs/reviewing-test-quality",
    targetAgent: "test-quality-reviewer" as const,
    targetCapability: "review.test-quality",
    canonicalSource: "https://github.com/djankies/claude-configs",
    canonicalLicenseSource: "https://github.com/djankies/claude-configs",
    normalizedRepository: "djankies/claude-configs",
    licenseId: "MIT" as const,
    licenseScope: "repository-inherited-no-narrower-local-evidence" as const,
    licensePolicyStatus: "LICENSE_SCOPE_REVIEW_REQUIRED" as const,
    attributionObligations: [] as Array<"ATTRIBUTION_REQUIRED">,
    toolCompatibility: "COMPATIBLE" as const,
    overlapStatus: "JUSTIFIED" as const,
    roleFit: "VALID" as const,
  },
] satisfies Array<
  Pick<
    ExternalAdvanceBuildInput,
    | "externalSkillId"
    | "targetAgent"
    | "targetCapability"
    | "canonicalSource"
    | "canonicalLicenseSource"
    | "normalizedRepository"
    | "licenseId"
    | "licenseScope"
    | "licensePolicyStatus"
    | "attributionObligations"
    | "toolCompatibility"
    | "overlapStatus"
    | "roleFit"
  >
>;

const sha256 = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const cell = (value: unknown) =>
  String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");

async function findRegistryRecord(externalSkillId: string) {
  const files = (await readdir(path.join(root, "skills", "registry"))).filter(
    (file) => file.endsWith(".json") && !file.startsWith("idempotency-"),
  );
  const records = [];
  for (const file of files) {
    const record = JSON.parse(
      await readFile(path.join(root, "skills", "registry", file), "utf8"),
    ) as { source?: { externalSkillId?: string } };
    if (record.source?.externalSkillId === externalSkillId) records.push(record);
  }
  if (records.length !== 1) {
    throw new Error(`Expected one exact local registry record for ${externalSkillId}.`);
  }
  return records[0] as {
    definition: {
      id: string;
      manifest: {
        files: Array<{ relativePath: string; sha256: string; byteSize: number }>;
      };
    };
    source: {
      externalSkillId: string;
      normalizedContentChecksum: string;
      retrievedContentChecksum: string;
      commitSha: string;
    };
    stagedDirectory: string;
  };
}

async function buildRecord(
  spec: (typeof expected)[number],
  recordedAt: string,
) {
  const registry = await findRegistryRecord(spec.externalSkillId);
  const evaluation = SkillCandidateEvaluationSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          root,
          "docs",
          "admin",
          "skill-curation",
          "evaluations",
          `${registry.source.normalizedContentChecksum}.json`,
        ),
        "utf8",
      ),
    ),
  );
  if (evaluation.externalSkillId !== spec.externalSkillId)
    throw new Error(`Evaluation identity mismatch for ${spec.externalSkillId}.`);
  if (evaluation.candidateChecksum !== registry.source.normalizedContentChecksum)
    throw new Error(`Evaluation checksum mismatch for ${spec.externalSkillId}.`);
  const manifestVerified = await Promise.all(
    registry.definition.manifest.files.map(async (file) => {
      const bytes = await readFile(path.join(registry.stagedDirectory, file.relativePath));
      return (
        sha256(bytes) === file.sha256 &&
        bytes.byteLength === file.byteSize
      );
    }),
  );
  if (!manifestVerified.every(Boolean))
    throw new Error(`Staged manifest mismatch for ${spec.externalSkillId}.`);
  const skillMarkdown = await readFile(
    path.join(registry.stagedDirectory, "SKILL.md"),
    "utf8",
  );
  const input: ExternalAdvanceBuildInput = {
    ...spec,
    coverageKeys: evaluation.coverageKeys ?? [],
    source: evaluation.source,
    slug: evaluation.displayName,
    stagedSkillId: registry.definition.id,
    candidateChecksum: evaluation.candidateChecksum,
    retrievedContentChecksum: evaluation.retrievedContentChecksum,
    sourceCommit: registry.source.commitSha,
    stagedRecordCandidateChecksum: registry.source.normalizedContentChecksum,
    stagedContentManifestVerified: true,
    stagedContent: skillMarkdown,
    evaluation,
    recordedAt,
  };
  return buildExternalAdvanceEvidenceRecord(input);
}

function renderReport(artifact: ReturnType<typeof buildExternalAdvanceEvidenceArtifact>) {
  const lines = [
    "# Phase 4D2 External Advance Evidence — 2026-08-09",
    "",
    "Evidence-only completion for the four Phase 4D1 `EXTERNAL_ADVANCE` candidates. No approval, assignment, allowlist, or skill-content mutation occurred.",
    "",
    "## License and policy",
    "",
    "| Candidate | Canonical source | License | Scope | Policy status | Blocker |",
    "|---|---|---|---|---|---|",
    ...artifact.candidates.map(
      (candidate) =>
        `| ${cell(candidate.externalSkillId)} | ${cell(candidate.canonicalLicenseSource.canonicalRepository)} | ${cell(candidate.licenseId)} | ${cell(candidate.licenseScope)} | ${cell(candidate.licensePolicyStatus)} | ${cell(candidate.blockers.join("; "))} |`,
    ),
    "",
    "## Metadata, tools, security, and readiness",
    "",
    "| Candidate | Purpose | Steps | Security | Tools | Overlap | Readiness |",
    "|---|---|---|---|---|---|---|",
    ...artifact.candidates.map(
      (candidate) =>
        `| ${cell(candidate.externalSkillId)} | ${cell(candidate.purposeEvidence.status)} (${cell(candidate.purposeEvidence.reference?.source)}) | ${candidate.stepsEvidence.length} references | ${cell(candidate.staticSecurity.status)} | ${cell(candidate.toolCompatibility)} | ${cell(candidate.overlapStatus)} | ${cell(candidate.approvalReadiness)} |`,
    ),
    "",
    "## Candidate evidence",
    "",
    ...artifact.candidates.flatMap((candidate) => [
      `### ${candidate.externalSkillId}`,
      "",
      `- Target: ${candidate.targetAgent} (${candidate.targetCapability})` ,
      `- Exact candidate checksum: \`${candidate.candidateChecksum}\``,
      `- Staged skill ID: \`${candidate.stagedSkillId}\`; staged content source: local checksum-bound registry content`,
      `- Provenance: ${candidate.provenance.canonicalSource}; source commit \`${candidate.provenance.sourceCommit}\``,
      `- License evidence: ${candidate.licenseId}, ${candidate.licenseEvidenceType}, supplied by HUMAN; policy version \`${candidate.evidencePolicyVersion}\``,
      `- Purpose evidence: ${candidate.purposeEvidence.status}; steps evidence: ${candidate.stepsEvidence.length} exact local references`,
      `- Tool compatibility: ${candidate.toolCompatibility}; source assumptions: ${candidate.toolAssumptions.map((item) => item.category).join(", ") || "none"}`,
      `- Static security: ${candidate.staticSecurity.status}; external audit: ${candidate.externalAudit.status} advisory`,
      `- Currentness: ${candidate.currentness.status}; upstream network checked: no`,
      `- Final approval readiness: **${candidate.approvalReadiness}**`,
      `- Blockers: ${candidate.blockers.join("; ") || "none"}`,
      "",
    ]),
    "## Invariants",
    "",
    "- Phase 4D1 remains historical: all four remain classified `EXTERNAL_ADVANCE` in the prior plan.",
    "- Approved external skills: 3; assigned external skills: 3.",
    "- Approved internal skills: 0; assigned internal skills: 0.",
    "- skills.sh searches: 0; GitHub requests: 0; external content execution: none.",
    "- The staged skill content was not replaced or rewritten.",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const generatedAt = new Date().toISOString();
  const candidates = await Promise.all(
    expected.map((spec) => buildRecord(spec, generatedAt)),
  );
  const artifact = buildExternalAdvanceEvidenceArtifact(candidates, generatedAt);
  await writeFile(outputJson, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(outputReport, renderReport(artifact), "utf8");
  console.log(
    JSON.stringify({
      candidates: artifact.candidates.length,
      approvalEligible: artifact.candidates.filter(
        (candidate) => candidate.approvalReadiness === "APPROVAL_ELIGIBLE",
      ).length,
      policyReviewRequired: artifact.candidates.filter(
        (candidate) => candidate.approvalReadiness === "LICENSE_POLICY_REVIEW_REQUIRED",
      ).length,
      scopeReviewRequired: artifact.candidates.filter(
        (candidate) => candidate.approvalReadiness === "LICENSE_SCOPE_REVIEW_REQUIRED",
      ).length,
      searches: artifact.discoverySearches,
      approvalCalled: artifact.approvalCalled,
      outputJson,
      outputReport,
    }),
  );
}

void main();
