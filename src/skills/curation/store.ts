import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CURATION_POLICY_VERSION,
  SkillCandidateEvaluationSchema,
  type SkillCandidateEvaluation,
} from "./contracts";

export class SkillCurationEvaluationStore {
  readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  private fileFor(checksum: string) {
    return path.join(this.root, `${checksum}.json`);
  }
  async save(evaluation: SkillCandidateEvaluation) {
    const parsed = SkillCandidateEvaluationSchema.parse(evaluation);
    await mkdir(this.root, { recursive: true });
    const target = this.fileFor(parsed.candidateChecksum);
    try {
      const existing = SkillCandidateEvaluationSchema.parse(
        JSON.parse(await readFile(target, "utf8")),
      );
      if (
        existing.externalSkillId !== parsed.externalSkillId ||
        existing.policyVersion !== CURATION_POLICY_VERSION
      )
        throw new Error("Evaluation checksum collision or policy mismatch.");
      if (!existing.externalAudit.available && parsed.externalAudit.available) {
        await writeFile(target, `${JSON.stringify(parsed, null, 2)}\n`, {
          flag: "w",
          mode: 0o600,
        });
        return parsed;
      }
      return existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(target, `${JSON.stringify(parsed, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return parsed;
  }
  async findByExternalSkillId(externalSkillId: string) {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: SkillCandidateEvaluation[] = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      try {
        const record = SkillCandidateEvaluationSchema.parse(
          JSON.parse(await readFile(path.join(this.root, name), "utf8")),
        );
        if (record.externalSkillId === externalSkillId) records.push(record);
      } catch {
        // Ignore unrelated admin files; an evaluation record is never trusted implicitly.
      }
    }
    return records.sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt));
  }
  async getCurrent(externalSkillId: string, candidateChecksum: string) {
    const records = await this.findByExternalSkillId(externalSkillId);
    const exact = records.find(
      (record) => record.candidateChecksum === candidateChecksum,
    );
    return {
      evaluation: exact,
      stale: records.some(
        (record) => record.candidateChecksum !== candidateChecksum,
      ),
    };
  }
}
