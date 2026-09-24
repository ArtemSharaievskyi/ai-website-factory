import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGit } from "../../scripts/codex/process";
import { buildSession, saveSession, toProtectedSnapshot } from "../../scripts/codex/protected-state";
import { captureBaselineArtifacts } from "../../scripts/codex/worktree-baseline";
import { createGitSourceCurrentnessPort, createStaticSourceCurrentnessPort } from "./source-head";
import { parseSourceHead } from "@/domain/shared/source-head";

describe("host-owned source currentness", () => {
  it("validates full Git SHAs and keeps static test identity deterministic", async () => {
    const head = "A".repeat(40);
    expect(parseSourceHead(head)).toBe(head.toLowerCase());
    await expect(Promise.resolve().then(() => parseSourceHead("not-a-sha"))).rejects.toThrow();
    await expect(createStaticSourceCurrentnessPort(head).read()).resolves.toMatchObject({ head: head.toLowerCase(), trackedWorktreeClean: true });
  });

  it("rejects untracked evidence without a protected baseline and rejects tracked source changes", async () => {
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
      expect(current.disallowedPaths).toContain("docs/admin/evidence.md");
      await runGit(root, ["add", "docs/admin/evidence.md"]);
      const stagedEvidence = await source.read();
      expect(stagedEvidence.trackedWorktreeClean).toBe(false);
      expect(stagedEvidence.disallowedPaths).toContain("docs/admin/evidence.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("admits unchanged protected baseline artifacts but rejects a changed artifact or new source path", async () => {
    const root = await mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "source-head-baseline-test-"));
    try {
      await writeFile(path.join(root, ".gitignore"), "/.codex/\n", "utf8");
      await writeFile(path.join(root, "source.txt"), "clean\n", "utf8");
      for (const args of [["init"], ["config", "user.email", "codex@example.invalid"], ["config", "user.name", "Codex Test"], ["add", ".gitignore", "source.txt"], ["commit", "-m", "fixture"]]) {
        const result = await runGit(root, args);
        expect(result.code, args.join(" ")).toBe(0);
      }
      const artifactPaths = ["docs/admin/evidence.md", "supabase/.temp/cli-latest"];
      for (const relativePath of artifactPaths) {
        await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
        await writeFile(path.join(root, relativePath), "protected baseline\n", "utf8");
      }
      const baselineArtifacts = await captureBaselineArtifacts(root, artifactPaths);
      await saveSession(root, buildSession(
        (await runGit(root, ["rev-parse", "HEAD"])).stdout.trim(),
        [toProtectedSnapshot({ projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, rowVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION", pendingUserAction: "GENERATE_DESIGN", operatorLanguage: "en", siteLanguage: "en", brief: { checksum: "a".repeat(64), approved: true, readyForApproval: true } })],
        "2026-09-24T00:00:00.000Z",
        baselineArtifacts.map((artifact) => artifact.path),
        [],
        baselineArtifacts,
      ));
      const source = createGitSourceCurrentnessPort(root);
      await expect(source.read()).resolves.toMatchObject({ trackedWorktreeClean: true, disallowedPaths: [] });

      await writeFile(path.join(root, artifactPaths[0]!), "changed baseline\n", "utf8");
      await expect(source.read()).resolves.toMatchObject({ trackedWorktreeClean: false, disallowedPaths: [artifactPaths[0]] });

      await writeFile(path.join(root, "new-source.ts"), "export const unsafe = true;\n", "utf8");
      const changed = await source.read();
      expect(changed.disallowedPaths).toEqual(expect.arrayContaining([artifactPaths[0], "new-source.ts"]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
