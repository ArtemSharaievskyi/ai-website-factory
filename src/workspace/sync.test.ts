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
      const memoryRoot = path.join(root, "v1", ".factory");
      const manifest = JSON.parse(await readFile(path.join(memoryRoot, "manifest.json"), "utf8")) as { documents: Array<{ relativePath: string }>; schemaVersion: number };
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.documents.map((entry) => entry.relativePath)).toEqual(["original-prompt.md"]);
      expect(await readdir(memoryRoot)).toEqual(expect.arrayContaining(["manifest.json", "original-prompt.md"]));
      expect(await readdir(memoryRoot)).not.toContain("codebase-memory.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
