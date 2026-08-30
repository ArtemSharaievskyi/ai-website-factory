import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { parseSourceHead, type SourceCurrentness, type SourceCurrentnessPort } from "@/domain/shared/source-head";

const execFileAsync = promisify(execFile);
const normalizePath = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");
const isAllowedUntrackedEvidence = (value: string) => normalizePath(value).toLowerCase().startsWith("docs/admin/");

function porcelainPaths(stdout: string) {
  return stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).map((line) => {
    const status = line.slice(0, 2);
    const value = line.slice(3).trim();
    const renamed = value.lastIndexOf(" -> ");
    return { path: normalizePath(renamed >= 0 ? value.slice(renamed + 4) : value), untracked: status === "??" };
  }).filter((entry) => Boolean(entry.path));
}

export class GitSourceCurrentnessPort implements SourceCurrentnessPort {
  constructor(private readonly root = process.cwd()) {}

  async read(): Promise<SourceCurrentness> {
    const headResult = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: this.root, windowsHide: true });
    const head = parseSourceHead(String(headResult.stdout).trim().split(/\r?\n/)[0]);
    const statusResult = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: this.root, windowsHide: true });
    const paths = porcelainPaths(String(statusResult.stdout));
    const disallowedPaths = paths.filter((entry) => !entry.untracked || !isAllowedUntrackedEvidence(entry.path)).map((entry) => entry.path);
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
