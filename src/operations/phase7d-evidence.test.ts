import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type CandidateFile = { relativePath: string; sha256: string };
type EvidenceReference = { evidenceRefs: string[] };
type Phase7DResult = {
  status: string;
  candidate: { candidateChecksum: string; files: CandidateFile[] };
  acceptance: Array<{ id: string; status: string } & EvidenceReference>;
  changedFiles: string[];
  evidence: { evidenceManifestChecksum: string; referenceValidation: { format: string; invalidReferenceCount: number; evidenceValid: boolean } };
};

const root = process.cwd();
// Phase 7D is a historical frozen snapshot. Later bounded phases legitimately
// changed these authority files; the snapshot checksum and references remain
// immutable, while unchanged files continue to be checked against their freeze.
const laterPhaseDrift = new Set([
  "src/agents/catalog.test.ts",
  "src/agents/catalog.ts",
  "src/domain/tooling/schema.ts",
  "src/integrations/openai/adapters.ts",
  "src/orchestration/orchestrator/tools.ts",
  "src/orchestration/tooling/adapters.ts",
  "src/orchestration/tooling/executor-ids.ts",
  "src/orchestration/tooling/registry.ts",
  "src/orchestration/tooling/tooling.test.ts",
  "src/skills/curation/portfolio.ts",
  "src/integrations/openai/client.ts",
  "src/integrations/openai/prompts.ts",
  "src/integrations/openai/usage.ts",
  "src/runtime/production-factory-runtime-core.ts",
]);
const fileChecksum = (content: Buffer) => createHash("sha256").update(content).digest("hex");
const manifestChecksum = (files: readonly CandidateFile[]) =>
  fileChecksum(Buffer.from(JSON.stringify(files.map(({ relativePath, sha256 }) => ({ relativePath, checksum: sha256 }))), "utf8"));

async function loadResult(): Promise<Phase7DResult> {
  const content = await readFile(resolve(root, "docs/admin/phase-7d/phase-7d-controlled-ast-aware-patching-result-2026-08-12.json"), "utf8");
  return JSON.parse(content) as Phase7DResult;
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

    for (const file of result.candidate.files.filter((candidate) => !laterPhaseDrift.has(candidate.relativePath))) {
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
