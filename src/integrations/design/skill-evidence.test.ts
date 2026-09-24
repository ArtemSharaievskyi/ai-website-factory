import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_OFFICIAL_DESIGN_SKILLS, inspectApprovedDesignSkills, normalizeDesignSkillSourceProvenance, validateDesignSkillCoverage } from "./skill-evidence";
import { EMIL_SKILL_PROVENANCE } from "./emil";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Design skill provenance", () => {
  it("preserves a legacy skills.sh content digest without treating it as a Git commit", () => {
    const checksum = "a".repeat(64);
    expect(normalizeDesignSkillSourceProvenance({ source: { sourceType: "skills-sh", commitSha: checksum, retrievedContentChecksum: checksum } })).toEqual({ sourceCommit: undefined, retrievedContentChecksum: checksum });
  });

  it("rejects mismatched or fabricated skills.sh provenance", () => {
    expect(() => normalizeDesignSkillSourceProvenance({ source: { sourceType: "skills-sh", commitSha: "a".repeat(64), retrievedContentChecksum: "b".repeat(64) } })).toThrow("DESIGN_SKILL_PROVENANCE_INVALID");
    expect(() => normalizeDesignSkillSourceProvenance({ source: { sourceType: "git-repository", commitSha: "a".repeat(64) } })).toThrow("DESIGN_SKILL_PROVENANCE_INVALID");
  });

  it("loads the approved registry record shape and retains required capability coverage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "design-skill-evidence-"));
    roots.push(root);
    const registryRoot = path.join(root, "skills", "registry");
    await mkdir(registryRoot, { recursive: true });
    for (const item of CURRENT_OFFICIAL_DESIGN_SKILLS) {
      const emil = EMIL_SKILL_PROVENANCE.find((candidate) => `emilkowalski/skills/${candidate.skillId}` === item.externalSkillId);
      const normalized = emil?.approvedContentChecksum ?? "b".repeat(64);
      const retrieved = "c".repeat(64);
      const skillsSh = !emil;
      const record = {
        definition: { id: item.registrySkillId ?? item.skillId, status: "approved", sourceChecksum: "d".repeat(64), license: "MIT", reviewedAt: "2026-09-24T00:00:00.000Z" },
        source: { sourceType: skillsSh ? "skills-sh" : "git-repository", externalSkillId: item.externalSkillId, ...(skillsSh ? { commitSha: retrieved, retrievedContentChecksum: retrieved } : { commitSha: "e".repeat(40) }), normalizedContentChecksum: normalized },
        approvedDirectory: `skills/approved/${item.skillId}`,
      };
      await writeFile(path.join(registryRoot, `${item.skillId}.json`), JSON.stringify(record));
    }
    const evidence = await inspectApprovedDesignSkills(root);
    expect(evidence).toHaveLength(CURRENT_OFFICIAL_DESIGN_SKILLS.length);
    expect(evidence.find((item) => item.skillId === "impeccable")).toMatchObject({ retrievedContentChecksum: "c".repeat(64), sourceCommit: undefined });
    expect(validateDesignSkillCoverage(evidence)).toMatchObject({ valid: true, missing: [] });
  });
});
