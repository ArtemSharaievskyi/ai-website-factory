import { SkillsShSourceAdapter } from "@/integrations/skills-sh/adapter";
import { CURRENT_OFFICIAL_DESIGN_SKILLS } from "@/integrations/design/skill-evidence";
import { extractMetadataEvidence, createHumanLicenseEvidence } from "@/skills/curation/evidence";
import { SkillRegistry } from "@/skills/registry/registry";
import path from "node:path";

const registry = new SkillRegistry(path.join(process.cwd(), "skills"));
const source = new SkillsShSourceAdapter({ requireAuthentication: false });
const now = new Date().toISOString();
const capabilityKeys: Record<string, string[]> = {
  impeccable: ["impeccable-semantic-skill", "impeccable-critique"],
  "emil-design-eng": ["emil-design-review"],
  "find-animation-opportunities": ["emil-animation-opportunities"],
  "review-animations": ["emil-animation-review"],
  "improve-animations": ["emil-animation-review"],
  "animation-vocabulary": ["emil-animation-opportunities"],
  "transitions-dev": ["transitions-pattern-mapping", "transitions-polish"],
};

async function main() {
  for (const item of CURRENT_OFFICIAL_DESIGN_SKILLS) {
    try {
      const existing = await registry.getRuntimeMetadata(item.skillId);
      if (existing.definition.status === "approved") {
        console.log(JSON.stringify({ skillId: item.skillId, status: "already-approved", sourceChecksum: existing.definition.sourceChecksum, normalizedContentChecksum: existing.normalizedContentChecksum }, null, 2));
        continue;
      }
    } catch {
      // The registry has no current candidate; continue through the bounded import path.
    }
    const candidate = await source.fetchPublicSkillCandidate(item.externalSkillId);
    const staged = await source.stageSkillCandidate(candidate, registry, {
      skillId: item.skillId,
      idempotencyKey: `phase7f-design-skill-${item.skillId}`,
      reviewer: "phase-7f-reconciliation",
      license: "MIT",
    });
    const metadata = extractMetadataEvidence(candidate.files[0]?.contents ?? "");
    if (metadata.unresolved.length) throw new Error(`SKILL_METADATA_UNRESOLVED:${item.skillId}:${metadata.unresolved.join(",")}`);
    await registry.recordCurationEvidence(staged.definition.id, {
      evidence: {
        license: createHumanLicenseEvidence({
          externalSkillId: item.externalSkillId,
          candidateChecksum: candidate.normalizedContentChecksum,
          sourceRepository: item.officialRepository,
          recordedAt: now,
        }),
        metadata,
      },
      expectedExternalSkillId: item.externalSkillId,
      expectedNormalizedChecksum: candidate.normalizedContentChecksum,
      expectedSourceRepository: item.officialRepository,
    });
    await registry.createApproval(staged.definition.id, {
      id: `approval-phase7f-${item.skillId}`,
      reviewedBy: "phase-7f-reconciliation",
      reviewedAt: now,
      decision: "approved",
      candidateChecksum: candidate.normalizedContentChecksum,
      approvedVersion: candidate.descriptor.sourceVersion,
      approvedCommit: candidate.retrievedContentChecksum,
      allowedRoles: ["design"],
      allowedTaskTypes: ["create-design-directions"],
      allowedTools: [],
      deniedTools: ["*"],
      allowedCommandPatterns: [],
      deniedCommandPatterns: ["*"],
      notes: "Approved immutable, bounded public design guidance. Source content was read through skills.sh, statically scanned, checksum-bound, and assigned only to Design.",
      applicability: {
        capability: "design.directions",
        taskType: "create-design-directions",
        coverageKeys: capabilityKeys[item.skillId] ?? [],
        projectSurfaces: ["design", "motion"],
        conflictsWithSkillIds: [],
        overlapsWithSkillIds: [],
        priority: 10,
      },
    });
    const approved = await registry.promoteApproved(staged.definition.id);
    console.log(JSON.stringify({ skillId: item.skillId, externalSkillId: item.externalSkillId, sourceChecksum: approved.definition.sourceChecksum, normalizedContentChecksum: candidate.normalizedContentChecksum, approvedDirectory: approved.approvedDirectory }, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}:${error.message}` : "PHASE7F_SKILL_APPROVAL_FAILED");
  process.exitCode = 1;
});
