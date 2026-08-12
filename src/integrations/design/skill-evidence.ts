import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ApprovedDesignSkillEvidenceSchema, type ApprovedDesignSkillEvidence } from "./contracts";

export type { ApprovedDesignSkillEvidence } from "./contracts";

export const CURRENT_OFFICIAL_DESIGN_SKILLS = [
  { externalSkillId: "pbakaus/impeccable/impeccable", skillId: "impeccable", officialRepository: "pbakaus/impeccable", capabilities: ["impeccable-critique", "impeccable-semantic-skill"] },
  { externalSkillId: "emilkowalski/skills/emil-design-eng", skillId: "emil-design-eng", officialRepository: "emilkowalski/skills", capabilities: ["emil-design-review"] },
  { externalSkillId: "emilkowalski/skills/find-animation-opportunities", skillId: "find-animation-opportunities", officialRepository: "emilkowalski/skills", capabilities: ["emil-animation-opportunities"] },
  { externalSkillId: "emilkowalski/skills/review-animations", skillId: "review-animations", officialRepository: "emilkowalski/skills", capabilities: ["emil-animation-review"] },
  { externalSkillId: "emilkowalski/skills/improve-animations", skillId: "improve-animations", officialRepository: "emilkowalski/skills", capabilities: ["emil-animation-review"] },
  { externalSkillId: "emilkowalski/skills/animation-vocabulary", skillId: "animation-vocabulary", officialRepository: "emilkowalski/skills", capabilities: ["emil-animation-opportunities"] },
  { externalSkillId: "Jakubantalik/transitions.dev/transitions-dev", skillId: "transitions-dev", officialRepository: "Jakubantalik/transitions.dev", capabilities: ["transitions-pattern-mapping", "transitions-polish"] },
] as const;

export const REQUIRED_DESIGN_SKILL_CAPABILITIES = [
  "impeccable-semantic-skill",
  "impeccable-critique",
  "emil-design-review",
  "emil-animation-opportunities",
  "emil-animation-review",
  "transitions-pattern-mapping",
  "transitions-polish",
] as const;

type RegistryRecord = { definition?: { id?: string; status?: string; sourceChecksum?: string }; approvedDirectory?: string; source?: { sourceRepository?: string; externalSkillId?: string } };

export async function inspectApprovedDesignSkills(root = process.cwd()): Promise<ApprovedDesignSkillEvidence[]> {
  const recordsRoot = path.join(root, "skills", "registry");
  const records = new Map<string, RegistryRecord>();
  try {
    for (const file of await readdir(recordsRoot)) {
      if (!file.endsWith(".json") || file.startsWith("idempotency-")) continue;
      const raw = JSON.parse(await readFile(path.join(recordsRoot, file), "utf8")) as RegistryRecord;
      if (raw.source?.externalSkillId) records.set(raw.source.externalSkillId, raw);
    }
  } catch {
    return [];
  }
  return CURRENT_OFFICIAL_DESIGN_SKILLS.flatMap((item) => {
    const record = records.get(item.externalSkillId);
    if (record?.definition?.status !== "approved" || !record.approvedDirectory || !record.definition.sourceChecksum) return [];
    return [ApprovedDesignSkillEvidenceSchema.parse({ skillId: record.definition.id ?? item.skillId, officialRepository: item.officialRepository, status: "APPROVED_IMMUTABLE", sourceChecksum: record.definition.sourceChecksum, approvedDirectory: record.approvedDirectory })];
  });
}

export function validateDesignSkillCoverage(evidence: readonly ApprovedDesignSkillEvidence[]) {
  const approvedRepositories = new Set(evidence.filter((item) => item.status === "APPROVED_IMMUTABLE").map((item) => item.skillId));
  const missing = REQUIRED_DESIGN_SKILL_CAPABILITIES.filter((capability) => {
    return !CURRENT_OFFICIAL_DESIGN_SKILLS.some((skill) => skill.capabilities.some((supported) => supported === capability) && approvedRepositories.has(skill.skillId));
  });
  return { valid: missing.length === 0, missing, approvedSkillCount: evidence.filter((item) => item.status === "APPROVED_IMMUTABLE").length };
}
