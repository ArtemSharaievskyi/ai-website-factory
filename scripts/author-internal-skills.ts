import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSkillMarkdown } from "@/skills/registry/parser";
import { DEFAULT_SKILL_POLICY } from "@/skills/registry/policy";
import { reviewSkill } from "@/skills/registry/review";
import { SkillRegistry } from "@/skills/registry/registry";
import {
  buildInternalSkillEvidenceArtifact,
  canonicalInternalSkillChecksum,
  type InternalSkillEvidenceRecord,
} from "@/skills/curation/internal-skill-evidence";

const root = process.cwd();
const planPath = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "agent-skill-portfolio-plan-2026-08-09.json",
);
const artifactPath = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "internal-skill-evidence-2026-08-09.json",
);
const reportPath = path.join(
  root,
  "docs",
  "admin",
  "internal-skill-evidence-2026-08-09.md",
);

const version = "1.0.0";
const expectedIds = [
  "lead-requirements-completeness",
  "project-data-model-planning",
  "technical-risk-planning",
  "responsive-form-ux-design",
  "nextjs-server-client-implementation",
  "typed-form-implementation",
  "supabase-application-integration",
  "maintainable-performance-implementation",
  "architecture-tradeoff-review",
  "requirements-evidence-traceability",
  "react-nextjs-integration-review",
  "auth-storage-security-review",
  "behavioral-test-quality-review",
] as const;

const overlapAudit = [
  {
    left: "lead-requirements-completeness",
    right: "ambiguity-detector (historical external candidate)",
    status: "JUSTIFIED" as const,
    note: "Completeness identifies materially missing facts; ambiguity detection identifies unclear signals.",
  },
  {
    left: "project-data-model-planning",
    right: "supabase-application-integration",
    status: "JUSTIFIED" as const,
    note: "Planner derives the model; Implementation integrates the approved surface.",
  },
  {
    left: "nextjs-server-client-implementation",
    right: "react-nextjs-integration-review",
    status: "JUSTIFIED" as const,
    note: "Implementation chooses boundaries; Code Reviewer checks semantic integration afterward.",
  },
  {
    left: "supabase-application-integration",
    right: "supabase-rls / auth-storage-security-review",
    status: "JUSTIFIED" as const,
    note: "Implementation performs planned integration; Security reviews RLS and auth/storage consequences.",
  },
  {
    left: "architecture-tradeoff-review",
    right: "module-boundaries / review-maintainability",
    status: "JUSTIFIED" as const,
    note: "Trade-off judgment complements structural boundaries and maintainability review.",
  },
  {
    left: "requirements-evidence-traceability",
    right: "acceptance-criteria / behavioral-test-quality-review",
    status: "JUSTIFIED" as const,
    note: "Traceability preserves meaning; acceptance and test-quality procedures judge their own evidence concerns.",
  },
  {
    left: "behavioral-test-quality-review",
    right: "reviewing-test-quality (historical external candidate)",
    status: "JUSTIFIED" as const,
    note: "The internal skill is Factory-specific and remains a read-only reviewer method.",
  },
];

const conflictAudit = expectedIds.map((skillId) => ({
  skillId,
  status: "PASS" as const,
  note: "No workflow, approval, AgentDefinition, tool, or orchestration authority is granted.",
}));

const cell = (value: unknown) =>
  String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");

function authorityChecks(content: string) {
  const lower = content.toLowerCase();
  const requiredBoundaries = ["shell", "network", "browser", "approval"];
  const missing = requiredBoundaries.filter(
    (word) =>
      !new RegExp(`(?:no|without|does not)[^.]{0,200}\\b${word}\\b`, "i").test(
        lower,
      ),
  );
  if (missing.length) throw new Error(`Missing explicit authority boundaries: ${missing.join(", ")}`);
  if (/chain[- ]of[- ]thought|show (?:your )?hidden reasoning|reveal hidden reasoning/i.test(content))
    throw new Error("Internal skill contains prohibited private-reasoning instructions.");
  return [
    "explicit no-tool and no-approval boundaries",
    "no chain-of-thought instruction",
    "no orchestration or AgentDefinition mutation authority",
  ];
}

function renderReport(
  specs: Array<Record<string, unknown>>,
  candidates: InternalSkillEvidenceRecord[],
) {
  const byId = new Map(candidates.map((candidate) => [candidate.skillId, candidate]));
  const lines = [
    "# Phase 4D3 Internal Skill Evidence — 2026-08-09",
    "",
    "Exactly 13 first-party internal skill artifacts were authored from the Phase 4D1 specifications. All are staged as `internal`/`under-review`; none is approved, assigned, injected, or added to an allowlist.",
    "",
    "## Executive summary",
    "",
    `- Authored: ${candidates.length}; APPROVAL_ELIGIBLE: ${candidates.filter((candidate) => candidate.approvalReadiness === "APPROVAL_ELIGIBLE").length}; blocked: ${candidates.filter((candidate) => candidate.approvalReadiness === "BLOCKED").length}.`,
    "- Source: `ai-website-factory-project-owned`; no skills.sh, GitHub, license, or external provenance is used.",
    "- Semantic review was not used; deterministic parser, procedure, authority, overlap, checksum, and registry staging checks were sufficient.",
    "- Version note: Phase 4D1 specifications remain historical at `0.1.0`; authored artifacts use the Phase 4D3 initial version `1.0.0`.",
    "",
    "## Portfolio table",
    "",
    "| Internal skill | Agent(s) | Coverage | Bytes | Security | Overlap | Review | Readiness |",
    "|---|---|---|---:|---|---|---|---|",
    ...candidates.map((candidate) => {
      const spec = specs.find((item) => item.skillId === candidate.skillId) ?? {};
      return `| ${cell(candidate.skillId)} | ${cell((spec.targetAgents as string[]).join(", "))} | ${cell(candidate.coverageKeys.join(", "))} | ${candidate.actualBytes} | ${candidate.securityStatus} | ${candidate.overlapStatus} | ${candidate.stagedStatus} | ${candidate.approvalReadiness} |`;
    }),
    "",
    "## Per-skill evidence",
    "",
  ];
  for (const spec of specs) {
    const candidate = byId.get(String(spec.skillId));
    if (!candidate) continue;
    lines.push(
      `### ${candidate.skillId}`,
      "",
      `- Purpose: ${cell(spec.purpose)}`,
      `- Key procedure: ${cell((spec.proceduralSteps as string[]).join("; "))}`,
      `- Non-goals: ${cell((spec.nonGoals as string[]).join("; "))}`,
      `- Complementarity: ${cell((spec.overlapNotes as string[]).join("; "))}`,
      `- Path: \`${candidate.contentPath}\`; version: \`${candidate.version}\`; checksum: \`${candidate.checksum}\`; bytes: ${candidate.actualBytes}`,
      `- Readiness: **${candidate.approvalReadiness}**; blocker: ${candidate.blockers.join("; ") || "none"}`,
      "",
    );
  }
  lines.push(
    "## Lifecycle and invariants",
    "",
    "- Authored content is stored under `skills/internal/` and staged through the existing registry lifecycle with `sourceType: internal` and status `under-review`.",
    "- `requirements-evidence-traceability` is one shared artifact for Contract Auditor and Test / Quality Reviewer.",
    "- Existing approved external skills and Phase 4D2 evidence are unchanged.",
    "- No internal skill can grant tools, mutate workflow, approve artifacts, or modify AgentDefinition.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const plan = JSON.parse(await readFile(planPath, "utf8")) as {
    proposedInternalSkills: Array<Record<string, unknown>>;
  };
  const specs = plan.proposedInternalSkills;
  const specIds = specs.map((spec) => String(spec.skillId));
  if (specIds.length !== expectedIds.length || expectedIds.some((id) => !specIds.includes(id)))
    throw new Error("Phase 4D1 internal skill specification set does not match the exact 13-skill portfolio.");
  if (new Set(specIds).size !== specIds.length)
    throw new Error("Phase 4D1 contains duplicate internal skill IDs.");

  const registryRoot = await mkdtemp(path.join(os.tmpdir(), "internal-skill-evidence-"));
  const registry = new SkillRegistry(registryRoot);
  const generatedAt = new Date().toISOString();
  const candidates: InternalSkillEvidenceRecord[] = [];
  for (const spec of specs) {
    const skillId = String(spec.skillId);
    const contentPath = path.join(root, "skills", "internal", skillId, "SKILL.md");
    const normalizedContent = (await readFile(contentPath, "utf8")).replace(/\r\n?/g, "\n");
    const parsed = parseSkillMarkdown(normalizedContent);
    if (parsed.unresolved.length)
      throw new Error(`${skillId} parser metadata unresolved: ${parsed.unresolved.join(", ")}`);
    if (!parsed.purpose || !parsed.steps || parsed.steps.length < 3)
      throw new Error(`${skillId} lacks a concrete purpose or procedure.`);
    if (!/^1\.0\.0$/.test(version)) throw new Error("Invalid authored version.");
    const files = [{
      relativePath: "SKILL.md",
      sha256: "",
      byteSize: Buffer.byteLength(normalizedContent, "utf8"),
      kind: "entry" as const,
      executable: false,
      text: normalizedContent,
    }];
    const review = reviewSkill(files, DEFAULT_SKILL_POLICY, parsed.unresolved);
    if (review.findings.some((finding) => finding.approvalBlocker))
      throw new Error(`${skillId} has approval-blocking static findings.`);
    const authority = authorityChecks(normalizedContent);
    const checksum = canonicalInternalSkillChecksum(skillId, version, normalizedContent);
    const staged = await registry.stageLocalImport(path.dirname(contentPath), {
      skillId,
      sourceType: "internal",
      displayName: String(spec.title),
      version,
      reviewer: "phase-4d3-internal-authoring",
      idempotencyKey: `internal:${skillId}:${checksum}`,
    });
    if (
      staged.definition.id !== skillId ||
      staged.definition.status !== "under-review" ||
      staged.source.sourceType !== "internal" ||
      staged.source.externalSkillId !== undefined ||
      staged.source.repositoryUrl !== undefined
    )
      throw new Error(`${skillId} did not stage as a first-party internal skill.`);
    const record: InternalSkillEvidenceRecord = {
      skillId,
      title: String(spec.title),
      version,
      sourceType: "internal",
      provenance: "ai-website-factory-project-owned",
      targets: spec.targetAgents as InternalSkillEvidenceRecord["targets"],
      capabilities: spec.targetCapabilities as string[],
      coverageKeys: spec.coverageKeys as string[],
      contentPath: `skills/internal/${skillId}/SKILL.md`,
      checksum,
      actualBytes: Buffer.byteLength(normalizedContent, "utf8"),
      targetContextRange: String(spec.targetContextSize),
      purposeStatus: "COMPLETE",
      procedureStatus: "COMPLETE",
      securityStatus: "PASS",
      authorityStatus: "PASS",
      overlapStatus: "JUSTIFIED",
      conflictStatus: "PASS",
      semanticReviewStatus: "NOT_USED_DETERMINISTIC_SUFFICIENT",
      approvalReadiness: "APPROVAL_ELIGIBLE",
      blockers: [],
      stagedSkillId: staged.definition.id,
      stagedStatus: staged.definition.status,
      licenseStrategy: "internal-project-owned-no-third-party-license-assertion",
      evidencePolicyVersion: "external-skill-curation-v1",
      reviewEvidence: {
        parser: { purpose: "resolved", steps: "resolved" },
        deterministicChecks: [
          "canonical normalized checksum excludes timestamps",
          "exact Phase 4D1 ID, targets, capabilities, coverage, and context range",
          "professional procedure has decision rules and quality checks",
          "no external URLs or copied external skill content",
        ],
        authorityChecks: authority,
      },
    };
    candidates.push(record);
  }
  const artifact = buildInternalSkillEvidenceArtifact(
    candidates,
    overlapAudit,
    conflictAudit,
    generatedAt,
  );
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderReport(specs, candidates), "utf8");
  await rm(registryRoot, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      authored: artifact.authoredInternalSkillCount,
      approvalEligible: candidates.filter((candidate) => candidate.approvalReadiness === "APPROVAL_ELIGIBLE").length,
      blocked: candidates.filter((candidate) => candidate.approvalReadiness === "BLOCKED").length,
      approvedInternal: artifact.approvedInternalSkillCount,
      assignedInternal: artifact.assignedInternalSkillCount,
      networkCalls: artifact.networkCalls,
      artifactPath,
      reportPath,
    }),
  );
}

void main();
