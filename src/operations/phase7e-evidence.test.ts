import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type CandidateFile = { relativePath: string; sha256: string };
type Acceptance = { id: string; status: string; evidenceRefs: string[] };
type Phase7EResult = {
  phaseId: string;
  phase7eStatus: string;
  candidate: { candidateId: string; candidateChecksum: string; files: CandidateFile[] };
  acceptanceCriteria: Acceptance[];
  changedFiles: string[];
  evidencePackId: string;
  evidencePackChecksum: string;
  evidence: { referenceValidation: { invalidReferenceCount: number; evidenceValid: boolean } };
};

const root = process.cwd();
const fileChecksum = (content: Buffer) => createHash("sha256").update(content).digest("hex");
const manifestChecksum = (files: readonly CandidateFile[]) => fileChecksum(Buffer.from(JSON.stringify(files.map(({ relativePath, sha256 }) => ({ relativePath, checksum: sha256 }))), "utf8"));

async function loadResult(): Promise<Phase7EResult> {
  const content = await readFile(resolve(root, "docs/admin/phase-7e/phase-7e-qa-workspace-lifecycle-result-2026-08-12.json"), "utf8");
  return JSON.parse(content) as Phase7EResult;
}

describe("Phase 7E evidence closure", () => {
  it("verifies the frozen candidate manifest, E1-E68, and every repository reference", async () => {
    const result = await loadResult();
    expect(result.phaseId).toBe("PHASE_7E");
    expect(result.phase7eStatus).toBe("COMPLETE");
    expect(result.candidate.files).toHaveLength(12);
    expect(manifestChecksum(result.candidate.files)).toBe(result.candidate.candidateChecksum);
    expect(result.evidencePackChecksum).toBe(result.candidate.candidateChecksum);
    expect(result.evidence.referenceValidation).toMatchObject({ invalidReferenceCount: 0, evidenceValid: true });
    expect(result.changedFiles).toEqual(result.candidate.files.map((file) => file.relativePath));
    expect(result.acceptanceCriteria.map((item) => item.id)).toEqual(Array.from({ length: 68 }, (_, index) => `E${index + 1}`));
    expect(result.acceptanceCriteria.every((item) => item.status === "PASS")).toBe(true);

    for (const file of result.candidate.files) {
      const content = await readFile(resolve(root, file.relativePath));
      expect(fileChecksum(content), file.relativePath).toBe(file.sha256);
    }

    const references = result.acceptanceCriteria.flatMap((item) => item.evidenceRefs);
    const invalidReferences: string[] = [];
    for (const reference of references) {
      const match = /^(.*):(\d+)(?:-(\d+))?$/.exec(reference);
      if (!match) {
        invalidReferences.push(reference);
        continue;
      }
      const [, relativePath, startText, endText] = match;
      const start = Number(startText);
      const end = Number(endText ?? startText);
      try {
        const content = await readFile(resolve(root, relativePath), "utf8");
        const lineCount = content.split(/\r?\n/).length;
        if (start < 1 || end < start || end > lineCount) invalidReferences.push(reference);
      } catch {
        invalidReferences.push(reference);
      }
    }
    expect(invalidReferences).toEqual([]);
  });
});
