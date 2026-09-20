import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canonicalInternalSkillChecksum } from "@/skills/curation/internal-skill-evidence";
import { SkillApplicabilitySchema, SkillRoleSchema, SkillTaskTypeSchema } from "@/skills/registry/contracts";
import { SkillRegistry } from "@/skills/registry/registry";

const root = process.cwd();
const skillsRoot = path.join(root, "skills");
const registry = new SkillRegistry(skillsRoot);
const reviewedAt = "2026-09-20T00:00:00.000Z";

type FrontendCapabilitySpec = {
  skillId: string;
  displayName: string;
  version: string;
  role: z.infer<typeof SkillRoleSchema>;
  allowedTaskTypes: z.infer<typeof SkillTaskTypeSchema>[];
  applicability: z.input<typeof SkillApplicabilitySchema>;
};

const specs: FrontendCapabilitySpec[] = [
  {
    skillId: "ui-ux-pro-max-frontend",
    displayName: "UI UX Pro Max Frontend Direction",
    version: "1.0.0",
    role: "design" as const,
    allowedTaskTypes: ["create-design-directions"] as const,
    applicability: {
      capability: "design.directions",
      taskType: "create-design-directions" as const,
      coverageKeys: ["ui-ux-pro-max", "ux-guidelines", "design-system-synthesis"],
      projectSurfaces: ["design", "typography", "palette", "ux", "frontend"],
      conflictsWithSkillIds: [],
      overlapsWithSkillIds: [],
      priority: 120,
    },
  },
  {
    skillId: "taste-frontend-direction",
    displayName: "Taste Frontend Direction",
    version: "1.0.0",
    role: "design" as const,
    allowedTaskTypes: ["create-design-directions"] as const,
    applicability: {
      capability: "design.directions",
      taskType: "create-design-directions" as const,
      coverageKeys: ["design-taste", "visual-variance", "visual-density"],
      projectSurfaces: ["design", "typography", "palette", "ux", "frontend"],
      conflictsWithSkillIds: [],
      overlapsWithSkillIds: [],
      priority: 115,
    },
  },
  {
    skillId: "design-motion-principles",
    displayName: "Design Motion Principles",
    version: "2.1.1",
    role: "implementation" as const,
    allowedTaskTypes: ["implement-frontend", "review-animation", "audit-animation", "find-animation-opportunities"] as const,
    applicability: {
      capability: "implementation.code",
      capabilities: ["implementation.code", "review.animation"],
      taskType: "implement-frontend" as const,
      taskTypes: ["implement-frontend", "review-animation", "audit-animation", "find-animation-opportunities"],
      coverageKeys: ["motion-frequency-gate", "motion-accessibility", "motion-create-audit"],
      projectSurfaces: ["motion", "frontend", "implementation"],
      conflictsWithSkillIds: [],
      overlapsWithSkillIds: [],
      priority: 25,
    },
  },
  {
    skillId: "magic-ui-adaptation",
    displayName: "Magic UI Adaptation",
    version: "1.0.0",
    role: "implementation" as const,
    allowedTaskTypes: ["implement-frontend"] as const,
    applicability: {
      capability: "implementation.code",
      taskType: "implement-frontend" as const,
      coverageKeys: ["magic-ui-adaptation", "component-provenance"],
      projectSurfaces: ["magic-ui", "frontend"],
      conflictsWithSkillIds: [],
      overlapsWithSkillIds: [],
      priority: 30,
    },
  },
  {
    skillId: "daisyui-tailwind-v4",
    displayName: "daisyUI Tailwind v4 Integration",
    version: "5.7.42",
    role: "implementation" as const,
    allowedTaskTypes: ["implement-frontend"] as const,
    applicability: {
      capability: "implementation.code",
      taskType: "implement-frontend" as const,
      coverageKeys: ["daisyui-tailwind-v4", "daisyui-theme-tokens"],
      projectSurfaces: ["daisyui", "tailwind", "frontend"],
      conflictsWithSkillIds: [],
      overlapsWithSkillIds: [],
      priority: 30,
    },
  },
];

async function activate(spec: FrontendCapabilitySpec) {
  const contentPath = path.join(skillsRoot, "internal", spec.skillId, "SKILL.md");
  const content = (await readFile(contentPath, "utf8")).replace(/\r\n?/g, "\n");
  const checksum = canonicalInternalSkillChecksum(spec.skillId, spec.version, content);
  const idempotencyKey = `frontend-capability:${spec.skillId}:${checksum}`;
  let runtime;
  try {
    runtime = await registry.getRuntimeMetadata(spec.skillId);
  } catch (error) {
    if ((error as { code?: string }).code !== "SKILL_NOT_FOUND") throw error;
    await registry.stageLocalImport(path.dirname(contentPath), {
      skillId: spec.skillId,
      sourceType: "internal",
      displayName: spec.displayName,
      version: spec.version,
      provenance: "ai-website-factory-project-owned",
      reviewer: "frontend-capabilities-integration",
      idempotencyKey,
    });
    runtime = await registry.getRuntimeMetadata(spec.skillId);
  }
  if (runtime.definition.version !== spec.version || (runtime.normalizedContentChecksum !== undefined && runtime.normalizedContentChecksum !== checksum))
    throw new Error(`Frontend capability ${spec.skillId} changed after staging; immutable approval cannot be reused.`);
  if (runtime.definition.status === "approved") {
    if (runtime.approval?.candidateChecksum !== checksum || runtime.approval.approvedVersion !== spec.version)
      throw new Error(`Approved frontend capability ${spec.skillId} is not checksum-bound to the expected artifact.`);
    return { skillId: spec.skillId, checksum, status: "approved" };
  }
  if (!runtime.normalizedContentChecksum) {
    await registry.recordInternalApprovalEvidence(spec.skillId, {
      version: spec.version,
      normalizedContentChecksum: checksum,
      provenance: "ai-website-factory-project-owned",
    });
  }
  runtime = await registry.getRuntimeMetadata(spec.skillId);
  if (!runtime.approval) {
    await registry.createApproval(spec.skillId, {
      id: `approval-frontend-capabilities-${spec.skillId}`,
      reviewedBy: "frontend-capabilities-integration",
      reviewedAt,
      decision: "approved",
      candidateChecksum: checksum,
      approvedVersion: spec.version,
      approvedCommit: "frontend-capabilities-2026-09-20",
      allowedRoles: [spec.role, ...(spec.skillId === "design-motion-principles" ? ["review" as const] : [])],
      allowedTaskTypes: [...spec.allowedTaskTypes],
      allowedTools: [],
      deniedTools: ["*"],
      allowedCommandPatterns: [],
      deniedCommandPatterns: ["*"],
      notes: "Explicit Factory-owned normalized guidance. Procedural context grants no tools, package installation, workflow, approval, network, browser, or shell authority.",
      applicability: {
        ...spec.applicability,
        ...(spec.applicability.capabilities ? { capabilities: [...spec.applicability.capabilities] } : {}),
        ...(spec.applicability.taskTypes ? { taskTypes: [...spec.applicability.taskTypes] } : {}),
        coverageKeys: [...spec.applicability.coverageKeys],
        projectSurfaces: [...spec.applicability.projectSurfaces],
        conflictsWithSkillIds: [...spec.applicability.conflictsWithSkillIds],
        overlapsWithSkillIds: [...spec.applicability.overlapsWithSkillIds],
      },
      maxContextBytes: 120_000,
    });
  }
  await registry.promoteApproved(spec.skillId);
  return { skillId: spec.skillId, checksum, status: "approved" };
}

async function main() {
  const activated = [];
  for (const spec of specs) activated.push(await activate(spec));
  console.log(JSON.stringify({ activated, registry: "skills/registry", approvalTools: 0 }));
}

void main();
