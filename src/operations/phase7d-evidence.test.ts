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
const Phase7DRecertificationSchema = z.object({
  schemaVersion: z.literal(1),
  documentType: z.literal("phase-7d-foundation-recertification"),
  phaseId: z.literal("PHASE_7D"),
  recertificationId: z.string().min(1),
  status: z.literal("COMPLETE"),
  verifiedOn: z.string().date(),
  historicalEvidence: z.object({ sourceEvidence: z.literal("docs/admin/phase-7d/phase-7d-controlled-ast-aware-patching-result-2026-08-12.json"), candidateId: z.string().min(1), candidateChecksum: z.string().regex(/^[a-f0-9]{64}$/), backendChecksum: z.string().regex(/^[a-f0-9]{64}$/), immutable: z.literal(true) }).strict(),
  currentArtifact: z.object({ verifiedAgainstCommit: z.string().regex(/^[a-f0-9]{40}$/), candidateChecksum: z.string().regex(/^[a-f0-9]{64}$/), backendChecksum: z.string().regex(/^[a-f0-9]{64}$/), checksumMethod: z.string().min(1), currentMismatchCount: z.literal(0) }).strict(),
  semanticDeltas: z.array(z.object({ relativePath: z.literal("src/agents/implementation/backend.ts"), classification: z.literal("AUTHORIZED_FOUNDATION_DELTA"), authorizingCommits: z.array(z.string().regex(/^[a-f0-9]{40}$/)).min(1), oldChecksum: z.string().regex(/^[a-f0-9]{64}$/), newChecksum: z.string().regex(/^[a-f0-9]{64}$/), sourceChange: z.string().min(1), behavioralConsequence: z.string().min(1), focusedTests: z.array(z.string().min(1)).min(1), runtimeEvidence: z.array(z.string().min(1)).min(1) }).strict()).length(1),
  authorizingCommits: z.array(z.string().regex(/^[a-f0-9]{40}$/)).min(1),
  historicalEvidencePreserved: z.literal(true),
  oldChecksumRejectedByCurrentManifest: z.literal(true),
  newChecksumAcceptedByCurrentManifest: z.literal(true),
  unauthorizedFutureChecksumGuarded: z.literal(true),
  providerCallsDuringRecertification: z.literal(0),
  customerStateMutated: z.literal(false),
  releaseOrDeploymentExecuted: z.literal(false),
}).strict();
type Phase7DRecertification = z.infer<typeof Phase7DRecertificationSchema>;
const LaterPhaseDriftSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("LATER_PHASE_DRIFT_SNAPSHOT"),
  sourceEvidence: z.literal("docs/admin/phase-7d/phase-7d-controlled-ast-aware-patching-result-2026-08-12.json"),
  reason: z.string().min(1).max(1000),
  files: z.array(z.object({ relativePath: z.string().regex(/^(?![\\/])(?![A-Za-z]:)[^\\]+$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1),
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

async function loadRecertification(): Promise<Phase7DRecertification> {
  const content = await readFile(resolve(root, "docs/admin/phase-7d/phase-7d-foundation-recertification-2026-09-07.json"), "utf8");
  return Phase7DRecertificationSchema.parse(JSON.parse(content));
}

async function loadLaterPhaseDriftSnapshot(): Promise<LaterPhaseDriftSnapshot> {
  const content = await readFile(resolve(root, "docs/admin/phase-8/planning-recovery-semantic-repair-evidence-2026-08-30.json"), "utf8");
  const parsed = LaterPhaseDriftSnapshotSchema.parse(JSON.parse(content));
  const payload = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "snapshotChecksum"));
  expect(fileChecksum(Buffer.from(JSON.stringify(payload), "utf8"))).toBe(parsed.snapshotChecksum);
  return parsed;
}

async function loadCurrentDriftSnapshots(): Promise<LaterPhaseDriftSnapshot[]> {
  const files = [
    "docs/admin/phase-8/planning-recovery-semantic-repair-evidence-2026-08-30.json",
    "docs/admin/phase-9/lightweight-review-layer-currentness-2026-09-11.json",
  ];
  return Promise.all(files.map(async (file) => {
    const parsed = LaterPhaseDriftSnapshotSchema.parse(JSON.parse(await readFile(resolve(root, file), "utf8")));
    const payload = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "snapshotChecksum"));
    expect(fileChecksum(Buffer.from(JSON.stringify(payload), "utf8"))).toBe(parsed.snapshotChecksum);
    return parsed;
  }));
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

    const recertification = await loadRecertification();
    const backendHistorical = result.candidate.files.find((file) => file.relativePath === "src/agents/implementation/backend.ts");
    expect(backendHistorical?.sha256).toBe(recertification.historicalEvidence.backendChecksum);
    expect(recertification.historicalEvidence.candidateChecksum).toBe(result.candidate.candidateChecksum);
    const currentFiles = result.candidate.files.map((file) => file.relativePath === "src/agents/implementation/backend.ts" ? { ...file, sha256: recertification.currentArtifact.backendChecksum } : file);
    expect(manifestChecksum(currentFiles)).toBe(recertification.currentArtifact.candidateChecksum);
    expect(recertification.semanticDeltas[0]?.oldChecksum).toBe(backendHistorical?.sha256);
    expect(recertification.semanticDeltas[0]?.newChecksum).toBe(recertification.currentArtifact.backendChecksum);
    expect(recertification.authorizingCommits).toEqual(expect.arrayContaining(recertification.semanticDeltas[0]?.authorizingCommits ?? []));
    const unauthorizedFutureFiles = currentFiles.map((file) => file.relativePath === "src/agents/implementation/backend.ts" ? { ...file, sha256: "0".repeat(64) } : file);
    expect(manifestChecksum(unauthorizedFutureFiles)).not.toBe(recertification.currentArtifact.candidateChecksum);
    const recertifiedPaths = new Set<string>(recertification.semanticDeltas.map((delta) => delta.relativePath));

    const laterPhase = await loadLaterPhaseDriftSnapshot();
    expect(laterPhase).toMatchObject({ schemaVersion: 1, kind: "LATER_PHASE_DRIFT_SNAPSHOT", sourceEvidence: "docs/admin/phase-7d/phase-7d-controlled-ast-aware-patching-result-2026-08-12.json" });
    expect(new Set(laterPhase.files.map((file) => file.relativePath)).size).toBe(laterPhase.files.length);
    const currentDriftSnapshots = await loadCurrentDriftSnapshots();
    const laterPhaseFiles = new Map<string, CandidateFile>(currentDriftSnapshots.flatMap((snapshot) => snapshot.files).map((file) => [file.relativePath, file]));
    const frozenFiles = new Map(result.candidate.files.map((file) => [file.relativePath, file]));
    for (const [relativePath, file] of laterPhaseFiles) {
      expect(frozenFiles.has(relativePath)).toBe(true);
      const content = await readFile(resolve(root, relativePath));
      expect(fileChecksum(content), relativePath).toBe(file.sha256);
    }
    for (const file of result.candidate.files.filter((candidate) => !laterPhaseFiles.has(candidate.relativePath) && !recertifiedPaths.has(candidate.relativePath))) {
      const content = await readFile(resolve(root, file.relativePath));
      expect(fileChecksum(content), file.relativePath).toBe(file.sha256);
    }
    for (const delta of recertification.semanticDeltas) {
      const content = await readFile(resolve(root, delta.relativePath));
      expect(fileChecksum(content), delta.relativePath).toBe(delta.newChecksum);
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
