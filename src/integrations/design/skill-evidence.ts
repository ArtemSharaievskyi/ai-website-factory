import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ApprovedDesignSkillEvidenceSchema, type ApprovedDesignSkillEvidence } from "./contracts";

export type { ApprovedDesignSkillEvidence } from "./contracts";

export const REQUIRED_OFFICIAL_DESIGN_SKILLS = [
  { skillId: "impeccable", officialRepository: "pbakaus/impeccable" },
  { skillId: "emil-design-eng", officialRepository: "emilkowalski/skills" },
  { skillId: "review-animations", officialRepository: "emilkowalski/skills" },
  { skillId: "improve-animations", officialRepository: "emilkowalski/skills" },
  { skillId: "find-animation-opportunities", officialRepository: "emilkowalski/skills" },
  { skillId: "animation-vocabulary", officialRepository: "emilkowalski/skills" },
  { skillId: "transitions-dev", officialRepository: "Jakubantalik/transitions.dev" },
  { skillId: "transitions-polish", officialRepository: "Jakubantalik/transitions.dev" },
] as const;

export async function inspectApprovedDesignSkills(root = process.cwd()): Promise<ApprovedDesignSkillEvidence[]> {
  const recordsRoot = path.join(root, "skills", "registry"); const records = new Map<string, { sourceChecksum?: string; approvedDirectory?: string; sourceRepository?: string; status?: string }>();
  try {
    for (const file of await readdir(recordsRoot)) {
      if (!file.endsWith(".json") || file.startsWith("idempotency-")) continue;
      const raw = JSON.parse(await readFile(path.join(recordsRoot, file), "utf8")) as { definition?: { id?: string; status?: string; sourceChecksum?: string }; approvedDirectory?: string; source?: { sourceRepository?: string } };
      if (raw.definition?.id) records.set(raw.definition.id, { sourceChecksum: raw.definition.sourceChecksum, approvedDirectory: raw.approvedDirectory, sourceRepository: raw.source?.sourceRepository, status: raw.definition.status });
    }
  } catch { return REQUIRED_OFFICIAL_DESIGN_SKILLS.map((item) => ApprovedDesignSkillEvidenceSchema.parse({ ...item, status: "NOT_AVAILABLE" })); }
  return REQUIRED_OFFICIAL_DESIGN_SKILLS.map((item) => { const record = records.get(item.skillId); return ApprovedDesignSkillEvidenceSchema.parse({ ...item, status: record?.status === "approved" && record.approvedDirectory && record.sourceChecksum ? "APPROVED_IMMUTABLE" : "NOT_AVAILABLE", ...(record?.sourceChecksum ? { sourceChecksum: record.sourceChecksum } : {}), ...(record?.approvedDirectory ? { approvedDirectory: record.approvedDirectory } : {}) }); });
}
