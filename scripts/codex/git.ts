import { runGit } from "./process";

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

export function normalizeRepoPath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export async function untrackedFiles(root: string) {
  const result = await runGit(root, ["ls-files", "--others", "--exclude-standard"]);
  if (result.code !== 0) throw new Error("CODEX_UNTRACKED_FILES_UNAVAILABLE");
  return lines(result.stdout).map(normalizeRepoPath).filter((file) => !file.startsWith(".codex/") && !file.startsWith("docs/admin/")).sort();
}

export async function changedFilesSince(root: string, baseline: string, baselineUntrackedFiles: readonly string[] = []) {
  assertCommitReference(baseline);
  const tracked = await runGit(root, ["diff", "--name-only", baseline, "--"]);
  if (tracked.code !== 0) throw new Error("CODEX_CHANGED_FILES_UNAVAILABLE");
  const currentUntracked = await untrackedFiles(root);
  const baselineSet = new Set(baselineUntrackedFiles.map(normalizeRepoPath));
  return [...new Set([...lines(tracked.stdout).map(normalizeRepoPath), ...currentUntracked.filter((file) => !baselineSet.has(file))])].sort();
}

export async function gitDiffCheck(root: string) {
  const result = await runGit(root, ["diff", "--check"]);
  return result.code === 0;
}

export async function trackedChangedFiles(root: string, baseline: string) {
  assertCommitReference(baseline);
  const result = await runGit(root, ["diff", "--name-only", baseline, "--"]);
  if (result.code !== 0) throw new Error("CODEX_TRACKED_FILES_UNAVAILABLE");
  return lines(result.stdout).map(normalizeRepoPath);
}

export async function isIgnored(root: string, value: string) {
  const result = await runGit(root, ["check-ignore", "--quiet", "--", value]);
  return result.code === 0;
}

export function forbiddenTrackedPaths(files: readonly string[]) {
  const forbidden = /^(?:\.env(?:\.|$)|\.context7-cache\/|\.factory-assets\/|\.factory-generated(?:[^/]*)\/|\.factory\/|\.codex\/)/i;
  return files.filter((file) => forbidden.test(normalizeRepoPath(file)));
}
