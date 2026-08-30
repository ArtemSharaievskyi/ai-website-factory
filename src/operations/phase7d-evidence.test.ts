import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

type CandidateFile = { relativePath: string; sha256: string };
type EvidenceReference = { evidenceRefs: string[] };
type Phase7DResult = {
  status: string;
  candidate: { candidateChecksum: string; files: CandidateFile[] };
  acceptance: Array<{ id: string; status: string } & EvidenceReference>;
  changedFiles: string[];
  evidence: { evidenceManifestChecksum: string; referenceValidation: { format: string; invalidReferenceCount: number; evidenceValid: boolean } };
};
const LaterPhaseDriftSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("LATER_PHASE_DRIFT_SNAPSHOT"),
  sourceEvidence: z.literal("docs/admin/phase-7d/phase-7d-controlled-ast-aware-patching-result-2026-08-12.json"),
  reason: z.string().min(1).max(1000),
  files: z.array(z.object({ relativePath: z.literal("src/integrations/openai/adapters.ts"), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).length(1),
  snapshotChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type LaterPhaseDriftSnapshot = z.infer<typeof LaterPhaseDriftSnapshotSchema>;

const root = process.cwd();
const fileChecksum = (content: Buffer) => createHash("sha256").update(content).digest("hex");
const manifestChecksum = (files: readonly CandidateFile[]) =>
  fileChecksum(Buffer.from(JSON.stringify(files.map(({ relativePath, sha256 }) => ({ relativePath, checksum: sha256 }))), "utf8"));

async function loadResult(): Promise<Phase7DResult> {
  const content = await readFile(resolve(root, "docs/admin/phase-7d/phase-7d-controlled-ast-aware-patching-result-2026-08-12.json"), "utf8");
  return JSON.parse(content) as Phase7DResult;
}

async function loadLaterPhaseDriftSnapshot(): Promise<LaterPhaseDriftSnapshot> {
  const content = await readFile(resolve(root, "docs/admin/phase-8/planning-recovery-semantic-repair-evidence-2026-08-30.json"), "utf8");
  const parsed = LaterPhaseDriftSnapshotSchema.parse(JSON.parse(content));
  const payload = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "snapshotChecksum"));
  expect(fileChecksum(Buffer.from(JSON.stringify(payload), "utf8"))).toBe(parsed.snapshotChecksum);
  return parsed;
}

describe("Phase 7D evidence closure", () => {
  it("verifies the frozen candidate manifest, D1-D40, and every repository reference", async () => {
    const result = await loadResult();
    expect(result.status).toBe("COMPLETE");
    expect(result.candidate.files).toHaveLength(22);
    expect(manifestChecksum(result.candidate.files)).toBe(result.candidate.candidateChecksum);
    expect(result.evidence.evidenceManifestChecksum).toBe(result.candidate.candidateChecksum);
    expect(result.evidence.referenceValidation).toMatchObject({ invalidReferenceCount: 0, evidenceValid: true });
    expect(result.changedFiles).toEqual(result.candidate.files.map((file) => file.relativePath));
    expect(result.acceptance.map((item) => item.id)).toEqual(Array.from({ length: 40 }, (_, index) => `D${index + 1}`));
    expect(result.acceptance.every((item) => item.status === "PASS")).toBe(true);

    const laterPhase = await loadLaterPhaseDriftSnapshot();
    expect(laterPhase).toMatchObject({ schemaVersion: 1, kind: "LATER_PHASE_DRIFT_SNAPSHOT", sourceEvidence: "docs/admin/phase-7d/phase-7d-controlled-ast-aware-patching-result-2026-08-12.json" });
    expect(new Set(laterPhase.files.map((file) => file.relativePath)).size).toBe(laterPhase.files.length);
    const laterPhaseFiles = new Map<string, CandidateFile>(laterPhase.files.map((file) => [file.relativePath, file]));
    const frozenFiles = new Map(result.candidate.files.map((file) => [file.relativePath, file]));
    for (const [relativePath, file] of laterPhaseFiles) {
      expect(frozenFiles.has(relativePath)).toBe(true);
      const content = await readFile(resolve(root, relativePath));
      expect(fileChecksum(content), relativePath).toBe(file.sha256);
    }
    for (const file of result.candidate.files.filter((candidate) => !laterPhaseFiles.has(candidate.relativePath))) {
      const content = await readFile(resolve(root, file.relativePath));
      expect(fileChecksum(content), file.relativePath).toBe(file.sha256);
    }

    const references = result.acceptance.flatMap((item) => item.evidenceRefs);
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
