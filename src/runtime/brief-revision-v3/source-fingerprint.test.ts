import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertCriticalSourceCoverage, assertSourceManifestCanonical, assertV3SourceDoesNotReachV2, computeCriticalSourceFingerprint } from "./source-fingerprint";

describe("Brief Revision V3 certification source fingerprint", () => {
  it("is stable for path order and changes when a critical module changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-source-"));
    try {
      await writeFile(path.join(root, "package.json"), "{}\n");
      await writeFile(path.join(root, "entry.ts"), 'import "./critical";\n');
      await writeFile(path.join(root, "critical.ts"), "export const value = 1;\n");
      const first = await computeCriticalSourceFingerprint({ root, entrypoints: ["entry.ts"], additionalArtifacts: ["package.json"] });
      const reordered = await computeCriticalSourceFingerprint({ root, entrypoints: ["entry.ts"], additionalArtifacts: ["package.json"] });
      expect(reordered.fingerprint).toBe(first.fingerprint);
      expect(assertSourceManifestCanonical(first.manifest)).toBe(true);
      await writeFile(path.join(root, "critical.ts"), "export const value = 2;\n");
      const changed = await computeCriticalSourceFingerprint({ root, entrypoints: ["entry.ts"], additionalArtifacts: ["package.json"] });
      expect(changed.fingerprint).not.toBe(first.fingerprint);
      await writeFile(path.join(root, "docs.md"), "documentation only\n");
      expect((await computeCriticalSourceFingerprint({ root, entrypoints: ["entry.ts"], additionalArtifacts: ["package.json"] })).fingerprint).toBe(changed.fingerprint);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("covers the real live closure and blocks legacy V2 mutation modules", async () => {
    const result = await computeCriticalSourceFingerprint();
    expect(assertCriticalSourceCoverage(result.manifest)).toBe(true);
    expect(assertV3SourceDoesNotReachV2(result.manifest)).toBe(true);
  });

  it("fails closed when a required path is not in the manifest", () => {
    expect(() => assertCriticalSourceCoverage([{ path: "scripts/brief-v3-live-acceptance.ts", digest: "a".repeat(64) }])).toThrow("CERTIFICATION_SOURCE_COVERAGE_INCOMPLETE");
  });

  it("fails closed when a new dynamic source import cannot be audited", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-source-dynamic-"));
    try {
      await writeFile(path.join(root, "entry.ts"), "export async function load(name: string) { return import(name); }\n");
      await expect(computeCriticalSourceFingerprint({ root, entrypoints: ["entry.ts"], additionalArtifacts: [] })).rejects.toThrow("DYNAMIC_IMPORT");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
