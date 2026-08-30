import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGit } from "../../scripts/codex/process";
import { createGitSourceCurrentnessPort, createStaticSourceCurrentnessPort } from "./source-head";
import { parseSourceHead } from "@/domain/shared/source-head";

describe("host-owned source currentness", () => {
  it("validates full Git SHAs and keeps static test identity deterministic", async () => {
    const head = "A".repeat(40);
    expect(parseSourceHead(head)).toBe(head.toLowerCase());
    await expect(Promise.resolve().then(() => parseSourceHead("not-a-sha"))).rejects.toThrow();
    await expect(createStaticSourceCurrentnessPort(head).read()).resolves.toMatchObject({ head: head.toLowerCase(), trackedWorktreeClean: true });
  });

  it("allows docs/admin evidence but rejects tracked source changes", async () => {
    const root = await mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "source-head-test-"));
    try {
      await writeFile(path.join(root, "source.txt"), "clean\n", "utf8");
      for (const args of [["init"], ["config", "user.email", "codex@example.invalid"], ["config", "user.name", "Codex Test"], ["add", "source.txt"], ["commit", "-m", "fixture"]]) {
        const result = await runGit(root, args);
        expect(result.code, args.join(" ")).toBe(0);
      }
      const source = createGitSourceCurrentnessPort(root);
      await writeFile(path.join(root, "source.txt"), "tracked change\n", "utf8");
      await mkdir(path.join(root, "docs", "admin"), { recursive: true });
      await writeFile(path.join(root, "docs", "admin", "evidence.md"), "allowed evidence\n", "utf8");
      const current = await source.read();
      expect(current.trackedWorktreeClean).toBe(false);
      expect(current.disallowedPaths).toContain("source.txt");
      expect(current.disallowedPaths).not.toContain("docs/admin/evidence.md");
      await runGit(root, ["add", "docs/admin/evidence.md"]);
      const stagedEvidence = await source.read();
      expect(stagedEvidence.trackedWorktreeClean).toBe(false);
      expect(stagedEvidence.disallowedPaths).toContain("docs/admin/evidence.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
