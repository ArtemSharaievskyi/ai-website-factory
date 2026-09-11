import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractMetadataEvidence, createHumanLicenseEvidence } from "@/skills/curation/evidence";
import { SkillRegistry } from "@/skills/registry/registry";
import { SkillError } from "@/skills/registry/errors";
import {
  EMIL_ANIMATE_SKILL_ID,
  EMIL_ANIMATION_IMPROVEMENT_SKILL_ID,
  EMIL_ANIMATION_OPPORTUNITY_SKILL_ID,
  EMIL_ANIMATION_REVIEW_SKILL_ID,
  EMIL_DESIGN_ENGINEERING_SKILL_ID,
  EMIL_LICENSE,
  EMIL_UPSTREAM_REPOSITORY,
  EMIL_UPSTREAM_REVISION,
  EMIL_UPSTREAM_URL,
} from "@/integrations/design/emil";

const upstreamRoot = process.env.EMIL_SKILLS_UPSTREAM_ROOT;
if (!upstreamRoot) throw new Error("EMIL_SKILLS_UPSTREAM_ROOT is required and must point to the audited upstream checkout.");
const sourceRoot = upstreamRoot;

const registry = new SkillRegistry(path.join(process.cwd(), "skills"));
const now = new Date().toISOString();
const shortRevision = EMIL_UPSTREAM_REVISION.slice(0, 12);
const filesFor = async (skillId: string) => {
  const root = path.join(upstreamRoot, "skills", skillId);
  const paths: string[] = [];
  const walk = async (current: string, relative = "") => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(child, childRelative);
      else paths.push(childRelative);
    }
  };
  await walk(root);
  return Promise.all(paths.map(async (relativePath) => ({
    path: relativePath,
    contents: await readFile(path.join(root, relativePath), "utf8"),
  })));
};

const normalizedChecksum = (externalSkillId: string, skillId: string, files: Array<{ path: string; contents: string }>) => {
  const slug = skillId;
  const sourceVersion = EMIL_UPSTREAM_REVISION;
  return createHash("sha256").update(JSON.stringify({
    descriptor: {
      externalSkillId,
      slug,
      source: EMIL_UPSTREAM_REPOSITORY,
      sourceVersion,
    },
    files,
  }), "utf8").digest("hex");
};

const retrievedChecksum = (externalSkillId: string, files: Array<{ path: string; contents: string }>) =>
  createHash("sha256").update(JSON.stringify({ id: externalSkillId, files }), "utf8").digest("hex");

const entries = [
  {
    skillId: "emil-design-eng",
    registrySkillId: EMIL_DESIGN_ENGINEERING_SKILL_ID,
    roles: ["design", "implementation", "review"] as const,
    taskTypes: ["create-design-directions", "implement-frontend", "review-design"] as const,
    capabilities: ["design.directions", "implementation.code", "review.design"],
    coverageKeys: ["emil-design-engineering", "emil-design-review", "interaction-craft", "typography", "spacing", "responsive-craft"],
    projectSurfaces: ["design", "motion", "frontend"],
    notes: "Current official Emil design-engineering guidance. Context-only for Design/Frontend implementation and read-only Design review; it cannot mutate canonical artifacts or approve itself.",
  },
  {
    skillId: "animate",
    registrySkillId: EMIL_ANIMATE_SKILL_ID,
    roles: ["implementation"] as const,
    taskTypes: ["implement-frontend"] as const,
    capabilities: ["implementation.code"],
    coverageKeys: ["emil-animation-construction", "motion-tokens", "reduced-motion", "interruptibility"],
    projectSurfaces: ["frontend", "motion"],
    notes: "Current official animation-construction guidance. It is eligible only for an approved motion task and cannot add production dependencies or bypass motion decisions.",
  },
  {
    skillId: "review-animations",
    registrySkillId: EMIL_ANIMATION_REVIEW_SKILL_ID,
    roles: ["review"] as const,
    taskTypes: ["review-animation"] as const,
    capabilities: ["review.animation"],
    coverageKeys: ["emil-animation-review"],
    projectSurfaces: ["review", "motion"],
    notes: "Current official animation-review standards. Read-only independent review context; no source writes, canonical mutation, repair, or approval authority.",
  },
  {
    skillId: "improve-animations",
    registrySkillId: EMIL_ANIMATION_IMPROVEMENT_SKILL_ID,
    roles: ["review"] as const,
    taskTypes: ["audit-animation"] as const,
    capabilities: ["review.animation"],
    coverageKeys: ["emil-animation-audit"],
    projectSurfaces: ["review", "motion"],
    notes: "Current official whole-codebase animation audit guidance. It produces bounded improvement plans only and has no source-write or canonical mutation authority.",
  },
  {
    skillId: "find-animation-opportunities",
    registrySkillId: EMIL_ANIMATION_OPPORTUNITY_SKILL_ID,
    roles: ["review"] as const,
    taskTypes: ["find-animation-opportunities"] as const,
    capabilities: ["review.animation"],
    coverageKeys: ["emil-animation-opportunities"],
    projectSurfaces: ["review", "motion"],
    notes: "Current official bounded motion-opportunity guidance. Zero-motion is a valid result and high-frequency interactions remain rejected.",
  },
] as const;

async function main() {
  for (const entry of entries) {
    const externalSkillId = `${EMIL_UPSTREAM_REPOSITORY}/${entry.skillId}`;
    const files = await filesFor(entry.skillId);
    const candidateChecksum = normalizedChecksum(externalSkillId, entry.skillId, files);
    const retrievedContentChecksum = retrievedChecksum(externalSkillId, files);
    let runtime;
    try {
      runtime = await registry.getRuntimeMetadata(entry.registrySkillId);
    } catch {
      runtime = undefined;
    }
    if (runtime?.definition.status === "approved") {
      if (runtime.normalizedContentChecksum !== candidateChecksum || runtime.definition.sourceCommit !== EMIL_UPSTREAM_REVISION)
        throw new Error(`EMIL_APPROVED_CONTENT_MISMATCH:${entry.skillId}`);
      console.log(JSON.stringify({ skillId: entry.skillId, status: "already-approved", registrySkillId: entry.registrySkillId, normalizedContentChecksum: candidateChecksum }, null, 2));
      continue;
    }
    if (runtime) {
      if (runtime.definition.status !== "under-review" || runtime.normalizedContentChecksum !== candidateChecksum || runtime.definition.sourceCommit !== EMIL_UPSTREAM_REVISION)
        throw new Error(`EMIL_STAGED_CONTENT_MISMATCH:${entry.skillId}`);
    } else {
      runtime = await registry.stageLocalImport(path.join(sourceRoot, "skills", entry.skillId), {
        idempotencyKey: `phase8-emil-${entry.registrySkillId}`,
        sourceType: "git-repository",
        skillId: entry.registrySkillId,
        displayName: entry.skillId,
        version: `upstream-${shortRevision}`,
        license: EMIL_LICENSE,
        sourceRepository: EMIL_UPSTREAM_URL,
        sourceCommit: EMIL_UPSTREAM_REVISION,
        reviewer: "phase-8-emil-motion-design",
        externalSkillId,
        canonicalSourceRef: `${EMIL_UPSTREAM_URL}/tree/${EMIL_UPSTREAM_REVISION}/skills/${entry.skillId}`,
        retrievedContentChecksum,
        normalizedContentChecksum: candidateChecksum,
      });
    }
    const markdown = files.find((file) => file.path === "SKILL.md")?.contents ?? "";
    const metadata = extractMetadataEvidence(markdown);
    if (metadata.unresolved.length) throw new Error(`EMIL_METADATA_UNRESOLVED:${entry.skillId}:${metadata.unresolved.join(",")}`);
    try {
      await registry.recordCurationEvidence(entry.registrySkillId, {
        evidence: {
          license: createHumanLicenseEvidence({
            externalSkillId,
            candidateChecksum,
            sourceRepository: EMIL_UPSTREAM_REPOSITORY,
            recordedAt: now,
            licenseId: EMIL_LICENSE,
          }),
          metadata,
        },
        expectedExternalSkillId: externalSkillId,
        expectedNormalizedChecksum: candidateChecksum,
        expectedSourceRepository: EMIL_UPSTREAM_REPOSITORY,
      });
    } catch (error) {
      if (!(error instanceof SkillError) || error.code !== "SKILL_IMMUTABLE") throw error;
    }
    await registry.createApproval(entry.registrySkillId, {
      id: `approval-phase8-${shortRevision}-${entry.skillId}`,
      reviewedBy: "phase-8-emil-motion-design",
      reviewedAt: now,
      decision: "approved",
      candidateChecksum,
      approvedVersion: `upstream-${shortRevision}`,
      approvedCommit: EMIL_UPSTREAM_REVISION,
      allowedRoles: [...entry.roles],
      allowedTaskTypes: [...entry.taskTypes],
      allowedTools: [],
      deniedTools: ["*"],
      allowedCommandPatterns: [],
      deniedCommandPatterns: ["*"],
      notes: entry.notes,
      applicability: {
        capability: entry.capabilities[0],
        capabilities: [...entry.capabilities],
        taskType: entry.taskTypes[0],
        taskTypes: [...entry.taskTypes],
        coverageKeys: [...entry.coverageKeys],
        projectSurfaces: [...entry.projectSurfaces],
        conflictsWithSkillIds: [],
        overlapsWithSkillIds: [],
        priority: 10,
      },
    });
    const approved = await registry.promoteApproved(entry.registrySkillId);
    console.log(JSON.stringify({ skillId: entry.skillId, status: "approved", registrySkillId: entry.registrySkillId, sourceCommit: EMIL_UPSTREAM_REVISION, sourceChecksum: approved.definition.sourceChecksum, normalizedContentChecksum: candidateChecksum, approvedDirectory: approved.approvedDirectory }, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}:${error.message}` : "PHASE8_EMIL_SKILL_APPROVAL_FAILED");
  process.exitCode = 1;
});
