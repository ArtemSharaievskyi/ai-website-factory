import { createHash } from "node:crypto";
import { lstat, realpath, readFile } from "node:fs/promises";
import path from "node:path";

export const WORKTREE_BASELINE_SCHEMA_VERSION = 1 as const;
export const BASELINE_MUTATION_POLICY = "UNCHANGED_BASELINE_ONLY" as const;

export type BaselinePathCategory = "PROTECTED_EVIDENCE" | "PROTECTED_RUNTIME_ARTIFACT";
export type BaselinePathPolicy = typeof BASELINE_MUTATION_POLICY;
export type BaselinePathState = "UNCHANGED" | "NEW" | "CHANGED" | "REPLACED" | "REDIRECTED" | "DELETED" | "RECLASSIFIED";

export type BaselineFileIdentity = {
  kind: "regular-file";
  size: number;
  sha256: string;
  device: string;
  inode: string;
  birthtimeMs: number;
  ctimeMs: number;
  mtimeMs: number;
};

export type ProtectedBaselineArtifact = {
  schemaVersion: typeof WORKTREE_BASELINE_SCHEMA_VERSION;
  path: string;
  category: BaselinePathCategory;
  policy: BaselinePathPolicy;
  identity: BaselineFileIdentity;
};

export type RepositoryPathClassification = {
  path: string;
  key: string;
  category: BaselinePathCategory | "UNEXPECTED_SOURCE";
  policy: BaselinePathPolicy | "REJECT_UNEXPECTED_PATH";
};

export type WorktreeEntry = {
  path: string;
  status: "UNTRACKED" | "TRACKED_CHANGE";
};

export type BaselinePathDiagnostic = {
  path: string;
  category: BaselinePathCategory | "UNEXPECTED_SOURCE" | "TASK_ENVELOPE";
  state: BaselinePathState;
  policy: BaselinePathPolicy | "REJECT_UNEXPECTED_PATH" | "TASK_ENVELOPE_PATH";
  accepted: boolean;
};

export class WorktreeBaselineError extends Error {
  constructor(readonly code: string, message = code) {
    super(`${code}${message === code ? "" : `:${message}`}`);
    this.name = "WorktreeBaselineError";
  }
}

const WINDOWS_DRIVE = /^[A-Za-z]:/;
const SAFE_RUNTIME_PROJECT = /^supabase_edge_runtime_[a-z0-9][a-z0-9._-]{0,100}$/i;
const RUNTIME_ARTIFACTS = new Set([
  "supabase/.branches/_current_branch",
  "supabase/.temp/cli-latest",
]);

const safeNumber = (value: number) => Number.isFinite(value) ? value : 0;
const normalizedPlatform = (platform = process.platform) => platform === "win32" ? "win32" : "posix";

export function normalizeRepositoryPath(value: string, platform = process.platform) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new WorktreeBaselineError("CODEX_PATH_INVALID");
  let slashPath = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (slashPath.endsWith("/")) slashPath = slashPath.slice(0, -1);
  if (slashPath.startsWith("/") || WINDOWS_DRIVE.test(slashPath) || slashPath.startsWith("//")) throw new WorktreeBaselineError("CODEX_PATH_ABSOLUTE");
  const parts = slashPath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new WorktreeBaselineError("CODEX_PATH_TRAVERSAL");
  const normalized = parts.join("/");
  return { path: normalized, key: normalizedPlatform(platform) === "win32" ? normalized.toLowerCase() : normalized };
}

export function repositoryPathKey(value: string, platform = process.platform) {
  return normalizeRepositoryPath(value, platform).key;
}

export function classifyRepositoryPath(value: string, platform = process.platform): RepositoryPathClassification {
  const normalized = normalizeRepositoryPath(value, platform);
  const lower = normalized.path.toLowerCase();
  if (lower.startsWith("docs/admin/") && normalized.path.length > "docs/admin/".length) {
    return { path: normalized.path, key: normalized.key, category: "PROTECTED_EVIDENCE", policy: BASELINE_MUTATION_POLICY };
  }
  if (RUNTIME_ARTIFACTS.has(lower) || (lower.startsWith("supabase/.temp/start-secrets/") && lower.endsWith("/env/docker.env") && SAFE_RUNTIME_PROJECT.test(normalized.path.split("/")[3] ?? ""))) {
    return { path: normalized.path, key: normalized.key, category: "PROTECTED_RUNTIME_ARTIFACT", policy: BASELINE_MUTATION_POLICY };
  }
  return { path: normalized.path, key: normalized.key, category: "UNEXPECTED_SOURCE", policy: "REJECT_UNEXPECTED_PATH" };
}

function diagnosticText(diagnostic: BaselinePathDiagnostic) {
  return `path=${diagnostic.path};category=${diagnostic.category};state=${diagnostic.state};policy=${diagnostic.policy}`;
}

async function assertContainedRegularFile(root: string, relativePath: string) {
  const rootAbsolute = path.resolve(root);
  const rootReal = await realpath(rootAbsolute).catch(() => { throw new WorktreeBaselineError("CODEX_BASELINE_ROOT_UNAVAILABLE"); });
  const absolute = path.resolve(rootAbsolute, ...relativePath.split("/"));
  const relative = path.relative(rootAbsolute, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new WorktreeBaselineError("CODEX_PATH_OUTSIDE_ROOT");
  let current = rootAbsolute;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const segmentStat = await lstat(current).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new WorktreeBaselineError("CODEX_BASELINE_PATH_MISSING");
      throw new WorktreeBaselineError("CODEX_BASELINE_PATH_UNREADABLE");
    });
    if (segmentStat.isSymbolicLink()) throw new WorktreeBaselineError("CODEX_BASELINE_PATH_REDIRECTED");
  }
  const resolved = await realpath(absolute).catch(() => { throw new WorktreeBaselineError("CODEX_BASELINE_PATH_UNREADABLE"); });
  const resolvedRelative = path.relative(rootReal, resolved);
  if (!resolvedRelative || resolvedRelative === ".." || resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)) throw new WorktreeBaselineError("CODEX_BASELINE_PATH_OUTSIDE_ROOT");
  return { absolute, stat: await lstat(absolute).catch(() => { throw new WorktreeBaselineError("CODEX_BASELINE_PATH_UNREADABLE"); }) };
}

export async function readBaselineFileIdentity(root: string, relativePath: string): Promise<BaselineFileIdentity> {
  const safe = await assertContainedRegularFile(root, relativePath);
  if (!safe.stat.isFile()) throw new WorktreeBaselineError("CODEX_BASELINE_PATH_NOT_FILE");
  const bytes = await readFile(safe.absolute).catch(() => { throw new WorktreeBaselineError("CODEX_BASELINE_PATH_UNREADABLE"); });
  return {
    kind: "regular-file",
    size: safe.stat.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    device: String(safe.stat.dev),
    inode: String(safe.stat.ino),
    birthtimeMs: safeNumber(safe.stat.birthtimeMs),
    ctimeMs: safeNumber(safe.stat.ctimeMs),
    mtimeMs: safeNumber(safe.stat.mtimeMs),
  };
}

export function compareBaselineFileIdentity(before: BaselineFileIdentity, after: BaselineFileIdentity): BaselinePathState {
  if (before.kind !== after.kind || before.device !== after.device || before.inode !== after.inode || before.birthtimeMs !== after.birthtimeMs) return "REPLACED";
  if (before.size !== after.size || before.sha256 !== after.sha256 || before.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs) return "CHANGED";
  return "UNCHANGED";
}

export async function captureBaselineArtifacts(root: string, paths: readonly string[]) {
  const artifacts: ProtectedBaselineArtifact[] = [];
  const seen = new Set<string>();
  for (const value of paths) {
    const classification = classifyRepositoryPath(value);
    if (classification.category === "UNEXPECTED_SOURCE") {
      const diagnostic: BaselinePathDiagnostic = { path: classification.path, category: classification.category, state: "NEW", policy: classification.policy, accepted: false };
      throw new WorktreeBaselineError("CODEX_BASELINE_UNEXPECTED_PATH", diagnosticText(diagnostic));
    }
    if (seen.has(classification.key)) throw new WorktreeBaselineError("CODEX_BASELINE_PATH_COLLISION");
    seen.add(classification.key);
    let identity: BaselineFileIdentity;
    try { identity = await readBaselineFileIdentity(root, classification.path); }
    catch (error) {
      const diagnostic: BaselinePathDiagnostic = { path: classification.path, category: classification.category, state: "REDIRECTED", policy: classification.policy, accepted: false };
      throw new WorktreeBaselineError("CODEX_BASELINE_PATH_UNSAFE", `${diagnosticText(diagnostic)};reason=${error instanceof WorktreeBaselineError ? error.code : "UNREADABLE"}`);
    }
    artifacts.push({ schemaVersion: WORKTREE_BASELINE_SCHEMA_VERSION, path: classification.path, category: classification.category, policy: BASELINE_MUTATION_POLICY, identity });
  }
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

function validIdentity(value: unknown): value is BaselineFileIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return identity.kind === "regular-file"
    && Number.isInteger(identity.size) && (identity.size as number) >= 0
    && typeof identity.sha256 === "string" && /^[a-f0-9]{64}$/.test(identity.sha256)
    && typeof identity.device === "string" && typeof identity.inode === "string"
    && typeof identity.birthtimeMs === "number" && Number.isFinite(identity.birthtimeMs)
    && typeof identity.ctimeMs === "number" && Number.isFinite(identity.ctimeMs)
    && typeof identity.mtimeMs === "number" && Number.isFinite(identity.mtimeMs);
}

export function validateBaselineArtifacts(value: unknown): ProtectedBaselineArtifact[] {
  if (!Array.isArray(value)) throw new WorktreeBaselineError("CODEX_BASELINE_METADATA_MISSING");
  const entries: ProtectedBaselineArtifact[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new WorktreeBaselineError("CODEX_BASELINE_METADATA_INVALID");
    const item = candidate as Record<string, unknown>;
    if (item.schemaVersion !== WORKTREE_BASELINE_SCHEMA_VERSION || typeof item.path !== "string" || item.policy !== BASELINE_MUTATION_POLICY || !validIdentity(item.identity)) throw new WorktreeBaselineError("CODEX_BASELINE_METADATA_INVALID");
    const classification = classifyRepositoryPath(item.path);
    if (classification.category === "UNEXPECTED_SOURCE" || classification.category !== item.category) throw new WorktreeBaselineError("CODEX_BASELINE_CATEGORY_INVALID");
    if (seen.has(classification.key)) throw new WorktreeBaselineError("CODEX_BASELINE_PATH_COLLISION");
    seen.add(classification.key);
    entries.push({ schemaVersion: WORKTREE_BASELINE_SCHEMA_VERSION, path: classification.path, category: classification.category, policy: BASELINE_MUTATION_POLICY, identity: item.identity });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function reconcileWorktreeBaseline(input: {
  root: string;
  entries: readonly WorktreeEntry[];
  baselineArtifacts: readonly ProtectedBaselineArtifact[];
  envelopePath?: string;
}) {
  const baseline = validateBaselineArtifacts(input.baselineArtifacts);
  const byKey = new Map(baseline.map((entry) => [repositoryPathKey(entry.path), entry]));
  const accepted: BaselinePathDiagnostic[] = [];
  const rejected: BaselinePathDiagnostic[] = [];
  const seen = new Set<string>();
  const envelopeKey = input.envelopePath ? repositoryPathKey(input.envelopePath) : undefined;

  for (const entry of input.entries) {
    const classification = classifyRepositoryPath(entry.path);
    if (envelopeKey && classification.key === envelopeKey) {
      accepted.push({ path: classification.path, category: "TASK_ENVELOPE", state: "UNCHANGED", policy: "TASK_ENVELOPE_PATH", accepted: true });
      continue;
    }
    const baselineEntry = byKey.get(classification.key);
    if (!baselineEntry) {
      const diagnostic: BaselinePathDiagnostic = { path: classification.path, category: classification.category, state: entry.status === "TRACKED_CHANGE" ? "CHANGED" : "NEW", policy: classification.policy, accepted: false };
      rejected.push(diagnostic);
      continue;
    }
    seen.add(classification.key);
    if (entry.status !== "UNTRACKED" || classification.category !== baselineEntry.category) {
      rejected.push({ path: classification.path, category: classification.category, state: "RECLASSIFIED", policy: baselineEntry.policy, accepted: false });
      continue;
    }
    try {
      const current = await readBaselineFileIdentity(input.root, baselineEntry.path);
      const state = compareBaselineFileIdentity(baselineEntry.identity, current);
      const diagnostic: BaselinePathDiagnostic = { path: baselineEntry.path, category: baselineEntry.category, state, policy: baselineEntry.policy, accepted: state === "UNCHANGED" };
      (diagnostic.accepted ? accepted : rejected).push(diagnostic);
    } catch (error) {
      const state = error instanceof WorktreeBaselineError && error.code === "CODEX_BASELINE_PATH_MISSING" ? "DELETED" : error instanceof WorktreeBaselineError && error.code === "CODEX_BASELINE_PATH_REDIRECTED" ? "REDIRECTED" : "REPLACED";
      rejected.push({ path: baselineEntry.path, category: baselineEntry.category, state, policy: baselineEntry.policy, accepted: false });
    }
  }

  for (const baselineEntry of baseline) {
    const key = repositoryPathKey(baselineEntry.path);
    if (seen.has(key)) continue;
    try {
      const current = await readBaselineFileIdentity(input.root, baselineEntry.path);
      const state = compareBaselineFileIdentity(baselineEntry.identity, current);
      const diagnostic: BaselinePathDiagnostic = { path: baselineEntry.path, category: baselineEntry.category, state, policy: baselineEntry.policy, accepted: state === "UNCHANGED" };
      (diagnostic.accepted ? accepted : rejected).push(diagnostic);
    } catch (error) {
      const state = error instanceof WorktreeBaselineError && error.code === "CODEX_BASELINE_PATH_MISSING" ? "DELETED" : error instanceof WorktreeBaselineError && error.code === "CODEX_BASELINE_PATH_REDIRECTED" ? "REDIRECTED" : "REPLACED";
      rejected.push({ path: baselineEntry.path, category: baselineEntry.category, state, policy: baselineEntry.policy, accepted: false });
    }
  }

  return { accepted, rejected, passed: rejected.length === 0 };
}

export function formatBaselineDiagnostics(diagnostics: readonly BaselinePathDiagnostic[]) {
  return diagnostics.slice(0, 20).map(diagnosticText).join(",");
}
