import { runGit } from "./process";
import { normalizeRepositoryPath, repositoryPathKey, type WorktreeEntry } from "./worktree-baseline";

const commitPattern = /^[0-9a-f]{7,64}$/i;

export function assertCommitReference(value: string) {
  if (!commitPattern.test(value)) throw new Error("CODEX_BASELINE_INVALID");
  return value;
}

export async function readGitHead(root: string) {
  const result = await runGit(root, ["rev-parse", "HEAD"]);
  const head = result.code === 0 ? result.stdout.trim().split(/\r?\n/)[0] : "";
  if (!/^[0-9a-f]{40}$/i.test(head)) throw new Error("CODEX_GIT_HEAD_UNAVAILABLE");
  return head;
}

export async function isBaselineAncestor(root: string, baseline: string, head = "HEAD") {
  assertCommitReference(baseline);
  const result = await runGit(root, ["merge-base", "--is-ancestor", baseline, head]);
  return result.code === 0;
}

const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

export const normalizeRepoPath = (value: string) => normalizeRepositoryPath(value).path;

function statusKind(status: string): WorktreeEntry["status"] {
  return status === "??" ? "UNTRACKED" : "TRACKED_CHANGE";
}

export function parsePorcelainEntries(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  if (stdout.includes("\0")) {
    const records = stdout.split("\0");
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record) continue;
      const status = record.slice(0, 2);
      const value = record.slice(3);
      if (!value) continue;
      entries.push({ path: normalizeRepoPath(value), status: statusKind(status) });
      if (status[0] === "R" || status[0] === "C" || status[1] === "R" || status[1] === "C") {
        const original = records[index + 1];
        if (original) entries.push({ path: normalizeRepoPath(original), status: "TRACKED_CHANGE" });
        index += 1;
      }
    }
  } else {
    for (const line of lines(stdout)) {
      const status = line.slice(0, 2);
      const value = line.slice(3);
      if (!value) continue;
      const renamed = value.lastIndexOf(" -> ");
      if (renamed >= 0) {
        entries.push({ path: normalizeRepoPath(value.slice(renamed + 4)), status: "TRACKED_CHANGE" });
        entries.push({ path: normalizeRepoPath(value.slice(0, renamed)), status: "TRACKED_CHANGE" });
      } else entries.push({ path: normalizeRepoPath(value), status: statusKind(status) });
    }
  }
  return [...new Map(entries.map((entry) => [repositoryPathKey(entry.path), entry])).values()].sort((left, right) => left.path.localeCompare(right.path));
}

export async function workingTreeEntries(root: string) {
  const result = await runGit(root, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
  if (result.code !== 0) throw new Error("CODEX_WORKTREE_STATUS_UNAVAILABLE");
  return parsePorcelainEntries(result.stdout);
}

export async function untrackedFiles(root: string) {
  const result = await runGit(root, ["ls-files", "--others", "--exclude-standard"]);
  if (result.code !== 0) throw new Error("CODEX_UNTRACKED_FILES_UNAVAILABLE");
  return lines(result.stdout).map((file) => normalizeRepoPath(file)).filter((file) => !file.startsWith(".codex/")).sort();
}

export async function changedFilesSince(root: string, baseline: string, baselineUntrackedFiles: readonly string[] = []) {
  assertCommitReference(baseline);
  const tracked = await runGit(root, ["diff", "--name-only", baseline, "--"]);
  if (tracked.code !== 0) throw new Error("CODEX_CHANGED_FILES_UNAVAILABLE");
  const currentUntracked = await untrackedFiles(root);
  const baselineSet = new Set(baselineUntrackedFiles.map((file) => repositoryPathKey(file)));
  return [...new Set([...lines(tracked.stdout).map(normalizeRepoPath), ...currentUntracked.filter((file) => !baselineSet.has(repositoryPathKey(file)))])].sort();
}

export async function gitDiffCheck(root: string) {
  const result = await runGit(root, ["diff", "--check"]);
  return result.code === 0;
}

export async function trackedChangedFiles(root: string, baseline: string) {
  assertCommitReference(baseline);
  const result = await runGit(root, ["diff", "--name-only", baseline, "--"]);
  if (result.code !== 0) throw new Error("CODEX_TRACKED_FILES_UNAVAILABLE");
  return lines(result.stdout).map((file) => normalizeRepoPath(file));
}

export async function isIgnored(root: string, value: string) {
  const result = await runGit(root, ["check-ignore", "--quiet", "--", value]);
  return result.code === 0;
}

export function forbiddenTrackedPaths(files: readonly string[]) {
  const forbidden = /^(?:\.env(?:\.|$)|\.context7-cache\/|\.factory-assets\/|\.factory-generated(?:[^/]*)\/|\.factory\/|\.codex\/)/i;
  return files.filter((file) => forbidden.test(normalizeRepoPath(file)));
}
