import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FilesystemProjectMemorySyncPort } from "./sync";

describe("filesystem Project Memory synchronization", () => {
  it("accepts the canonical prompt-only PROJECT snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "factory-memory-sync-"));
    try {
      const sync = new FilesystemProjectMemorySyncPort(root, "project");
      await sync.writeVersionSnapshot("11111111-1111-4111-8111-111111111111", 1, { "original-prompt.md": "Build a bicycle repair site" });
      const memoryRoot = path.join(root, "project", "v1", ".factory");
      const manifest = JSON.parse(await readFile(path.join(memoryRoot, "manifest.json"), "utf8")) as { documents: Array<{ relativePath: string }>; schemaVersion: number };
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.documents.map((entry) => entry.relativePath)).toEqual(["original-prompt.md"]);
      expect(await readdir(memoryRoot)).toEqual(expect.arrayContaining(["manifest.json", "original-prompt.md"]));
      expect(await readdir(memoryRoot)).not.toContain("codebase-memory.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps snapshots inside the owning project workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "factory-memory-sync-isolation-"));
    try {
      const sync = new FilesystemProjectMemorySyncPort(root, "owned-project");
      await sync.writeVersionSnapshot("22222222-2222-4222-8222-222222222222", 1, { "original-prompt.md": "Owned project" });
      await expect(readFile(path.join(root, "v1", ".factory", "original-prompt.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(root, "owned-project", "v1", ".factory", "original-prompt.md"), "utf8")).resolves.toBe("Owned project");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projects decisions by project and version without duplicates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "factory-memory-sync-decisions-"));
    try {
      const alpha = new FilesystemProjectMemorySyncPort(root, "project-alpha");
      const beta = new FilesystemProjectMemorySyncPort(root, "project-beta");
      const decision = (id: string, category: string) => ({ id, timestamp: "2026-01-01T00:00:00.000Z", actorType: "system" as const, actorIdentifier: "synthetic-test", category, decision: `Synthetic ${category}`, rationale: "Synthetic isolation fixture", affectedDocuments: [], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" as const });
      const alphaV1 = decision("33333333-3333-4333-8333-333333333331", "alpha-v1");
      const betaV1 = decision("33333333-3333-4333-8333-333333333332", "beta-v1");
      const alphaV2 = decision("33333333-3333-4333-8333-333333333333", "alpha-v2");
      await alpha.writeVersionSnapshot("44444444-4444-4444-8444-444444444444", 1, { "original-prompt.md": "Synthetic alpha v1" });
      await beta.writeVersionSnapshot("55555555-5555-4555-8555-555555555555", 1, { "original-prompt.md": "Synthetic beta v1" });
      await alpha.writeVersionSnapshot("44444444-4444-4444-8444-444444444444", 2, { "original-prompt.md": "Synthetic alpha v2" });
      await alpha.appendDecision("44444444-4444-4444-8444-444444444444", 1, alphaV1);
      await alpha.appendDecision("44444444-4444-4444-8444-444444444444", 1, alphaV1);
      await beta.appendDecision("55555555-5555-4555-8555-555555555555", 1, betaV1);
      await alpha.appendDecision("44444444-4444-4444-8444-444444444444", 2, alphaV2);
      const readDecisions = async (slug: string, version: number) => (await readFile(path.join(root, slug, `v${version}`, ".factory", "decisions.jsonl"), "utf8")).trim().split(/\r?\n/).map((line) => ({ id: (JSON.parse(line) as { id: string }).id }));
      await expect(readDecisions("project-alpha", 1)).resolves.toEqual([{ id: alphaV1.id }]);
      await expect(readDecisions("project-beta", 1)).resolves.toEqual([{ id: betaV1.id }]);
      await expect(readDecisions("project-alpha", 2)).resolves.toEqual([{ id: alphaV2.id }]);
      await expect(readFile(path.join(root, "v1", ".factory", "decisions.jsonl"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(alpha.verifyVersionSnapshot("44444444-4444-4444-8444-444444444444", 1)).resolves.toBe(true);
      await expect(beta.verifyVersionSnapshot("55555555-5555-4555-8555-555555555555", 1)).resolves.toBe(true);
      await expect(alpha.verifyVersionSnapshot("44444444-4444-4444-8444-444444444444", 2)).resolves.toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
