import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { parseSourceHead, type SourceCurrentness, type SourceCurrentnessPort } from "@/domain/shared/source-head";
import {
  compareBaselineFileIdentity,
  readBaselineFileIdentity,
  repositoryPathKey,
  validateBaselineArtifacts,
  type ProtectedBaselineArtifact,
} from "../../scripts/codex/worktree-baseline";

const execFileAsync = promisify(execFile);
const normalizePath = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");

function porcelainPaths(stdout: string) {
  return stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).map((line) => {
    const status = line.slice(0, 2);
    const value = line.slice(3).trim();
    const renamed = value.lastIndexOf(" -> ");
    return { path: normalizePath(renamed >= 0 ? value.slice(renamed + 4) : value), untracked: status === "??" };
  }).filter((entry) => Boolean(entry.path));
}

type ProtectedSessionMetadata = {
  schemaVersion?: unknown;
  baselineUntrackedFiles?: unknown;
  baselineArtifacts?: unknown;
};

async function readProtectedBaseline(root: string): Promise<readonly ProtectedBaselineArtifact[]> {
  let value: ProtectedSessionMetadata;
  try {
    value = JSON.parse(await readFile(path.join(root, ".codex", "session.json"), "utf8")) as ProtectedSessionMetadata;
  } catch {
    return [];
  }
  if (value.schemaVersion !== 3 || !Array.isArray(value.baselineUntrackedFiles) || !Array.isArray(value.baselineArtifacts)) return [];
  try {
    const artifacts = validateBaselineArtifacts(value.baselineArtifacts);
    const listed = new Set(value.baselineUntrackedFiles.filter((item): item is string => typeof item === "string").map((item) => repositoryPathKey(item)));
    const artifactKeys = new Set(artifacts.map((artifact) => repositoryPathKey(artifact.path)));
    if (listed.size !== artifactKeys.size || [...listed].some((key) => !artifactKeys.has(key))) return [];
    return artifacts;
  } catch {
    return [];
  }
}

async function baselineUntrackedPaths(root: string, entries: ReturnType<typeof porcelainPaths>, baseline: readonly ProtectedBaselineArtifact[]) {
  const byKey = new Map(baseline.map((artifact) => [repositoryPathKey(artifact.path), artifact]));
  const accepted = new Set<string>();
  const disallowed = new Set<string>();
  for (const entry of entries) {
    if (!entry.untracked) {
      disallowed.add(entry.path);
      continue;
    }
    const artifact = byKey.get(repositoryPathKey(entry.path));
    if (!artifact) {
      disallowed.add(entry.path);
      continue;
    }
    try {
      const current = await readBaselineFileIdentity(root, artifact.path);
      if (compareBaselineFileIdentity(artifact.identity, current) === "UNCHANGED") accepted.add(artifact.path);
      else disallowed.add(artifact.path);
    } catch {
      disallowed.add(artifact.path);
    }
  }
  for (const artifact of baseline) {
    if (accepted.has(artifact.path) || disallowed.has(artifact.path)) continue;
    try {
      const current = await readBaselineFileIdentity(root, artifact.path);
      if (compareBaselineFileIdentity(artifact.identity, current) !== "UNCHANGED") disallowed.add(artifact.path);
    } catch {
      disallowed.add(artifact.path);
    }
  }
  return { accepted, disallowed };
}

export class GitSourceCurrentnessPort implements SourceCurrentnessPort {
  constructor(private readonly root = process.cwd()) {}

  async read(): Promise<SourceCurrentness> {
    const headResult = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: this.root, windowsHide: true });
    const head = parseSourceHead(String(headResult.stdout).trim().split(/\r?\n/)[0]);
    const statusResult = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: this.root, windowsHide: true });
    const paths = porcelainPaths(String(statusResult.stdout));
    const baseline = await readProtectedBaseline(this.root);
    const reconciliation = await baselineUntrackedPaths(this.root, paths, baseline);
    const disallowedPaths = [...reconciliation.disallowed].sort();
    return { head, trackedWorktreeClean: disallowedPaths.length === 0, disallowedPaths };
  }
}

export function createGitSourceCurrentnessPort(root = process.cwd()): SourceCurrentnessPort {
  return new GitSourceCurrentnessPort(path.resolve(root));
}

export function createStaticSourceCurrentnessPort(head: string, trackedWorktreeClean = true): SourceCurrentnessPort {
  const parsed = parseSourceHead(head);
  return { read: async () => ({ head: parsed, trackedWorktreeClean, disallowedPaths: trackedWorktreeClean ? [] : ["synthetic/tracked-change.ts"] }) };
}

export type { SourceHead } from "@/domain/shared/source-head";
