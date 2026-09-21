import { readFile } from "node:fs/promises";
import { readDirectory } from "@/runtime/filesystem/directory";
import path from "node:path";
import { ApprovedDesignSkillEvidenceSchema, type ApprovedDesignSkillEvidence } from "./contracts";
import { EMIL_SKILL_PROVENANCE } from "./emil";

export type { ApprovedDesignSkillEvidence } from "./contracts";

export const CURRENT_OFFICIAL_DESIGN_SKILLS = [
  { externalSkillId: "pbakaus/impeccable/impeccable", skillId: "impeccable", registrySkillId: undefined, officialRepository: "pbakaus/impeccable", capabilities: ["impeccable-critique", "impeccable-semantic-skill"] },
  { externalSkillId: "emilkowalski/skills/emil-design-eng", skillId: "emil-design-eng", registrySkillId: EMIL_SKILL_PROVENANCE[0].registrySkillId, officialRepository: "emilkowalski/skills", capabilities: ["emil-design-review"] },
  { externalSkillId: "emilkowalski/skills/animate", skillId: "animate", registrySkillId: EMIL_SKILL_PROVENANCE[1].registrySkillId, officialRepository: "emilkowalski/skills", capabilities: ["emil-animation-construction"] },
  { externalSkillId: "emilkowalski/skills/find-animation-opportunities", skillId: "find-animation-opportunities", registrySkillId: EMIL_SKILL_PROVENANCE[4].registrySkillId, officialRepository: "emilkowalski/skills", capabilities: ["emil-animation-opportunities"] },
  { externalSkillId: "emilkowalski/skills/review-animations", skillId: "review-animations", registrySkillId: EMIL_SKILL_PROVENANCE[2].registrySkillId, officialRepository: "emilkowalski/skills", capabilities: ["emil-animation-review"] },
  { externalSkillId: "emilkowalski/skills/improve-animations", skillId: "improve-animations", registrySkillId: EMIL_SKILL_PROVENANCE[3].registrySkillId, officialRepository: "emilkowalski/skills", capabilities: ["emil-animation-audit"] },
  { externalSkillId: "emilkowalski/skills/animation-vocabulary", skillId: "animation-vocabulary", registrySkillId: undefined, officialRepository: "emilkowalski/skills", capabilities: ["emil-animation-opportunities"] },
  { externalSkillId: "Jakubantalik/transitions.dev/transitions-dev", skillId: "transitions-dev", registrySkillId: undefined, officialRepository: "Jakubantalik/transitions.dev", capabilities: ["transitions-pattern-mapping", "transitions-polish"] },
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

type RegistryRecord = { definition?: { id?: string; status?: string; sourceChecksum?: string; license?: string; reviewedAt?: string }; approvedDirectory?: string; source?: { sourceRepository?: string; externalSkillId?: string; commitSha?: string; normalizedContentChecksum?: string } };

export async function inspectApprovedDesignSkills(root = process.cwd()): Promise<ApprovedDesignSkillEvidence[]> {
  const recordsRoot = path.join(root, "skills", "registry");
  const records = new Map<string, RegistryRecord>();
  try {
    for (const entry of await readDirectory(recordsRoot)) {
      const file = entry.name;
      if (!file.endsWith(".json") || file.startsWith("idempotency-")) continue;
      const raw = JSON.parse(await readFile(path.join(recordsRoot, file), "utf8")) as RegistryRecord;
      if (raw.source?.externalSkillId) {
        const current = records.get(raw.source.externalSkillId);
        const currentRevision = EMIL_SKILL_PROVENANCE.find((item) => `emilkowalski/skills/${item.skillId}` === raw.source?.externalSkillId)?.reviewedRevision;
        const isCurrent = currentRevision !== undefined && raw.source.commitSha === currentRevision;
        const currentIsApproved = current?.definition?.status === "approved";
        if (!current || (isCurrent && (!currentIsApproved || raw.definition?.status === "approved"))) records.set(raw.source.externalSkillId, raw);
      }
    }
  } catch {
    return [];
  }
  return CURRENT_OFFICIAL_DESIGN_SKILLS.flatMap((item) => {
    const record = records.get(item.externalSkillId);
    if (record?.definition?.status !== "approved" || !record.approvedDirectory || !record.definition.sourceChecksum) return [];
    const provenance = EMIL_SKILL_PROVENANCE.find((candidate) => `emilkowalski/skills/${candidate.skillId}` === item.externalSkillId);
    const normalizedMatches = !provenance || record.source?.normalizedContentChecksum === provenance.approvedContentChecksum;
    return [ApprovedDesignSkillEvidenceSchema.parse({ skillId: record.definition.id ?? item.registrySkillId ?? item.skillId, officialRepository: item.officialRepository, externalSkillId: item.externalSkillId, status: normalizedMatches ? "APPROVED_IMMUTABLE" : "CHECKSUM_MISMATCH", sourceChecksum: record.definition.sourceChecksum, normalizedContentChecksum: record.source?.normalizedContentChecksum, sourceCommit: record.source?.commitSha, license: record.definition.license, reviewedAt: record.definition.reviewedAt, approvedDirectory: record.approvedDirectory })];
  });
}

export function validateDesignSkillCoverage(evidence: readonly ApprovedDesignSkillEvidence[]) {
  const approvedRepositories = new Set(evidence.filter((item) => item.status === "APPROVED_IMMUTABLE").flatMap((item) => [item.skillId, ...(item.externalSkillId ? [item.externalSkillId.split("/").at(-1)!] : [])]));
  const missing = REQUIRED_DESIGN_SKILL_CAPABILITIES.filter((capability) => {
    return !CURRENT_OFFICIAL_DESIGN_SKILLS.some((skill) => skill.capabilities.some((supported) => supported === capability) && approvedRepositories.has(skill.skillId));
  });
  return { valid: missing.length === 0, missing, approvedSkillCount: evidence.filter((item) => item.status === "APPROVED_IMMUTABLE").length };
}
