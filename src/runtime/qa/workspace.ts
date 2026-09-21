import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { readDirectory } from "@/runtime/filesystem/directory";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { FunctionalQaError } from "./errors";

export const QA_WORKSPACE_MARKER_NAME = ".factory-qa-workspace.json";
export const QA_WORKSPACE_PREFIX = ".qa-foundation-";
export const QA_WORKSPACE_MARKER_VERSION = 1 as const;
export const QA_WORKSPACE_MAX_RETRIES = 4;
export const QA_WORKSPACE_RETRY_DELAYS_MS = [25, 50, 100, 200] as const;
export const QA_WORKSPACE_MAX_RECONCILIATION_ENTRIES = 64;

const workspaceNamePattern = /^\.qa-foundation-[A-Za-z0-9]{6}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const activeWorkspaceSessions = new Map<string, { sessionId: string; workspacePath: string }>();

const QaWorkspaceStateSchema = z.enum(["CREATED", "ACTIVE", "CLEANING", "CLEANED", "STALE", "ABANDONED"]);
export type QaWorkspaceState = z.infer<typeof QaWorkspaceStateSchema>;

export const QaWorkspaceMarkerSchema = z.object({
  schemaVersion: z.literal(QA_WORKSPACE_MARKER_VERSION),
  workspaceKind: z.literal("QA_FOUNDATION"),
  workspaceId: z.string().uuid(),
  qaRunId: z.string().uuid(),
  factoryProjectIdentity: z.object({ projectId: z.string().uuid(), projectVersion: z.number().int().positive() }).strict(),
  authorizedRootIdentity: z.string().regex(hashPattern),
  createdAt: z.string().datetime(),
  ownerProcessId: z.number().int().positive(),
  ownerSessionId: z.string().uuid(),
  state: QaWorkspaceStateSchema,
}).strict();
export type QaWorkspaceMarker = z.infer<typeof QaWorkspaceMarkerSchema>;

export const QaWorkspaceFailureCodeSchema = z.enum([
  "QA_WORKSPACE_OWNERSHIP_UNVERIFIED",
  "QA_WORKSPACE_PATH_UNSAFE",
  "QA_WORKSPACE_ACTIVE",
  "QA_PROCESS_TERMINATION_FAILED",
  "QA_WORKSPACE_CLEANUP_RETRY_EXHAUSTED",
  "QA_WORKSPACE_CLEANUP_FAILED",
  "QA_WORKSPACE_MARKER_INVALID",
  "QA_WORKSPACE_LEGACY_OWNERSHIP_UNVERIFIED",
]);
export type QaWorkspaceFailureCode = z.infer<typeof QaWorkspaceFailureCodeSchema>;

export const QaWorkspaceCleanupResultSchema = z.object({
  workspaceId: z.string().min(1).max(120),
  qaRunId: z.string().uuid().optional(),
  workspacePathSafeRef: z.string().min(1).max(240),
  attempted: z.boolean(),
  resourcesStopped: z.boolean(),
  processesExited: z.boolean(),
  removed: z.boolean(),
  verifiedAbsent: z.boolean(),
  retryCount: z.number().int().nonnegative(),
  deferred: z.boolean(),
  failureCode: QaWorkspaceFailureCodeSchema.optional(),
  state: QaWorkspaceStateSchema,
  reason: z.enum(["normal", "success", "failure", "timeout", "cancellation", "validation-failure", "reconciliation", "legacy-reconciliation", "partial-creation"]),
}).strict();
export type QaWorkspaceCleanupResult = z.infer<typeof QaWorkspaceCleanupResultSchema>;

export type QaWorkspaceClassification =
  | "FACTORY_OWNED_QA_WORKSPACE"
  | "ACTIVE_QA_WORKSPACE"
  | "STALE_QA_WORKSPACE"
  | "LEGACY_FACTORY_QA_WORKSPACE_PROVEN"
  | "UNVERIFIED_PREFIX_MATCH";

export type QaWorkspaceInventoryEntry = {
  name: string;
  workspacePathSafeRef: string;
  classification: QaWorkspaceClassification;
  active: boolean;
  markerValid: boolean;
  ownershipConfidence: "HIGH" | "NONE";
  workspaceId?: string;
  qaRunId?: string;
  failureCode?: QaWorkspaceFailureCode;
};

export type QaWorkspaceReconciliationResult = {
  scanned: number;
  cleaned: number;
  preserved: number;
  failures: Array<{ workspacePathSafeRef: string; failureCode: QaWorkspaceFailureCode }>;
  entries: QaWorkspaceInventoryEntry[];
};

type QaWorkspaceFileSystem = {
  mkdtemp(prefix: string): Promise<string>;
  lstat(target: string): Promise<Stats>;
  realpath(target: string): Promise<string>;
  readdir(target: string): Promise<Dirent[]>;
  readFile(target: string): Promise<string>;
  writeFile(target: string, content: string, flag: "wx" | "w"): Promise<void>;
  rm(target: string): Promise<void>;
};

const defaultFileSystem: QaWorkspaceFileSystem = {
  mkdtemp: (prefix) => mkdtemp(prefix),
  lstat: (target) => lstat(target),
  realpath: (target) => realpath(target),
  readdir: (target) => readDirectory(target),
  readFile: (target) => readFile(target, "utf8"),
  writeFile: (target, content, flag) => writeFile(target, content, { encoding: "utf8", flag, mode: 0o600 }).then(() => undefined),
  rm: (target) => rm(target, { recursive: true, force: true, maxRetries: 0 }),
};

type QaWorkspaceLifecycleOptions = {
  authorizedRoot: string;
  fileSystem?: Partial<QaWorkspaceFileSystem>;
  sleep?: (milliseconds: number) => Promise<void>;
  isProcessAlive?: (pid: number) => Promise<boolean>;
  processId?: number;
  sessionId?: string;
  maxRetries?: number;
};

type CleanupOptions = {
  reason: QaWorkspaceCleanupResult["reason"];
  resourcesStopped: boolean;
  processesExited: boolean;
  ownerSessionId?: string;
  allowOwnerSession?: boolean;
  allowReconciliation?: boolean;
  legacyOwnershipProven?: boolean;
  workspaceId?: string;
  qaRunId?: string;
};

const safeDigest = (value: string) => createHash("sha256").update(value.toLowerCase(), "utf8").digest("hex");
const normalized = (value: string) => path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
const isSamePath = (left: string, right: string) => normalized(left) === normalized(right);
const isWithin = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function processIsAlive(pid: number) {
  if (pid === process.pid) return Promise.resolve(true);
  try {
    process.kill(pid, 0);
    return Promise.resolve(true);
  } catch (error) {
    return Promise.resolve(errorCode(error) === "EPERM");
  }
}

export class QaWorkspaceLifecycle {
  readonly authorizedRoot: string;
  private readonly fileSystem: QaWorkspaceFileSystem;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly isProcessAlive: (pid: number) => Promise<boolean>;
  private readonly processId: number;
  private readonly sessionId: string;
  private readonly maxRetries: number;

  constructor(options: QaWorkspaceLifecycleOptions) {
    this.authorizedRoot = path.resolve(options.authorizedRoot);
    if (this.authorizedRoot === path.parse(this.authorizedRoot).root) throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The filesystem root cannot be an authorized QA workspace parent.");
    this.fileSystem = { ...defaultFileSystem, ...options.fileSystem };
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.isProcessAlive = options.isProcessAlive ?? processIsAlive;
    this.processId = options.processId ?? process.pid;
    this.sessionId = options.sessionId ?? randomUUID();
    this.maxRetries = Math.max(0, Math.min(options.maxRetries ?? QA_WORKSPACE_MAX_RETRIES, QA_WORKSPACE_MAX_RETRIES));
  }

  async create(input: { qaRunId?: string; projectId: string; projectVersion: number }): Promise<QaWorkspaceHandle> {
    await this.assertAuthorizedRoot();
    const qaRunId = z.string().uuid().parse(input.qaRunId ?? randomUUID());
    const projectId = z.string().uuid().parse(input.projectId);
    const projectVersion = z.number().int().positive().parse(input.projectVersion);
    const workspaceId = randomUUID();
    const workspacePath = await this.fileSystem.mkdtemp(path.join(this.authorizedRoot, QA_WORKSPACE_PREFIX));
    try {
      this.assertWorkspacePath(workspacePath);
      const marker: QaWorkspaceMarker = {
        schemaVersion: QA_WORKSPACE_MARKER_VERSION,
        workspaceKind: "QA_FOUNDATION",
        workspaceId,
        qaRunId,
        factoryProjectIdentity: { projectId, projectVersion },
        authorizedRootIdentity: safeDigest(this.authorizedRoot),
        createdAt: new Date().toISOString(),
        ownerProcessId: this.processId,
        ownerSessionId: this.sessionId,
        state: "CREATED",
      };
      await this.writeMarker(workspacePath, marker, "wx");
      activeWorkspaceSessions.set(workspaceId, { sessionId: this.sessionId, workspacePath });
      return new QaWorkspaceHandle(this, marker, workspacePath);
    } catch (error) {
      const markerExists = await this.fileSystem.lstat(this.markerPath(workspacePath)).then(() => true).catch((candidate) => errorCode(candidate) !== "ENOENT");
      if (!markerExists) await this.removePartialWorkspace(workspacePath).catch(() => undefined);
      throw error;
    }
  }

  async activate(workspacePath: string) {
    const current = await this.readMarker(workspacePath);
    await this.writeMarker(workspacePath, { ...current, state: "ACTIVE" }, "w");
  }

  async inventory(): Promise<QaWorkspaceInventoryEntry[]> {
    await this.assertAuthorizedRoot();
    const entries = await this.fileSystem.readdir(this.authorizedRoot);
    const candidates = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(QA_WORKSPACE_PREFIX)).slice(0, QA_WORKSPACE_MAX_RECONCILIATION_ENTRIES);
    const inventory: QaWorkspaceInventoryEntry[] = [];
    for (const entry of candidates) {
      const target = path.join(this.authorizedRoot, entry.name);
      const safeRef = entry.name;
      if (!workspaceNamePattern.test(entry.name)) {
        inventory.push({ name: entry.name, workspacePathSafeRef: safeRef, classification: "UNVERIFIED_PREFIX_MATCH", active: false, markerValid: false, ownershipConfidence: "NONE", failureCode: "QA_WORKSPACE_OWNERSHIP_UNVERIFIED" });
        continue;
      }
      let marker: QaWorkspaceMarker | undefined;
      try { marker = await this.readMarker(target); } catch (error) {
        const code = errorCode(error) === "QA_WORKSPACE_PATH_UNSAFE" ? "QA_WORKSPACE_PATH_UNSAFE" : "QA_WORKSPACE_MARKER_INVALID";
        const legacy = await this.isProvenLegacyWorkspace(target);
        inventory.push({ name: entry.name, workspacePathSafeRef: safeRef, classification: legacy ? "LEGACY_FACTORY_QA_WORKSPACE_PROVEN" : "UNVERIFIED_PREFIX_MATCH", active: false, markerValid: false, ownershipConfidence: legacy ? "HIGH" : "NONE", failureCode: legacy ? undefined : code });
        continue;
      }
      const active = await this.isMarkerActive(marker);
      inventory.push({ name: entry.name, workspacePathSafeRef: safeRef, classification: active ? "ACTIVE_QA_WORKSPACE" : "STALE_QA_WORKSPACE", active, markerValid: true, ownershipConfidence: "HIGH", workspaceId: marker.workspaceId, qaRunId: marker.qaRunId });
    }
    return inventory;
  }

  async reconcile(): Promise<QaWorkspaceReconciliationResult> {
    const entries = await this.inventory();
    const result: QaWorkspaceReconciliationResult = { scanned: entries.length, cleaned: 0, preserved: 0, failures: [], entries };
    for (const entry of entries) {
      if (entry.classification === "ACTIVE_QA_WORKSPACE" || entry.classification === "UNVERIFIED_PREFIX_MATCH" || entry.classification === "FACTORY_OWNED_QA_WORKSPACE") { result.preserved += 1; continue; }
      const target = path.join(this.authorizedRoot, entry.name);
      try {
        const cleanup = entry.classification === "LEGACY_FACTORY_QA_WORKSPACE_PROVEN"
          ? await this.cleanupPath(target, { reason: "legacy-reconciliation", resourcesStopped: true, processesExited: true, allowReconciliation: true, legacyOwnershipProven: true, workspaceId: `legacy:${entry.name}` })
          : await this.cleanupPath(target, { reason: "reconciliation", resourcesStopped: true, processesExited: true, allowReconciliation: true });
        if (cleanup.removed && cleanup.verifiedAbsent) result.cleaned += 1;
        else { result.preserved += 1; if (cleanup.failureCode) result.failures.push({ workspacePathSafeRef: entry.workspacePathSafeRef, failureCode: cleanup.failureCode }); }
      } catch (error) {
        result.preserved += 1;
        result.failures.push({ workspacePathSafeRef: entry.workspacePathSafeRef, failureCode: this.mapFailureCode(error) });
      }
    }
    return result;
  }

  async cleanupPath(targetPath: string, options: CleanupOptions): Promise<QaWorkspaceCleanupResult> {
    await this.assertAuthorizedRoot();
    const target = path.resolve(targetPath);
    this.assertWorkspacePath(target);
    const safeRef = path.basename(target);
    const targetExists = await this.fileSystem.lstat(target).then(() => true).catch((error) => {
      if (errorCode(error) === "ENOENT") return false;
      throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The QA workspace could not be inspected safely.", error);
    });
    if (!targetExists) {
      if (options.workspaceId) activeWorkspaceSessions.delete(options.workspaceId);
      return this.result(options.workspaceId ?? `legacy:${safeRef}`, options.qaRunId, safeRef, options, true, true, 0, false, undefined, "CLEANED");
    }
    let marker: QaWorkspaceMarker | undefined;
    try { marker = await this.readMarker(target); } catch (error) {
      const markerPresent = await this.fileSystem.lstat(this.markerPath(target)).then(() => true).catch((candidate) => errorCode(candidate) !== "ENOENT");
      if (markerPresent || !options.legacyOwnershipProven) throw error;
      if (!(await this.isProvenLegacyWorkspace(target))) throw new FunctionalQaError("QA_WORKSPACE_LEGACY_OWNERSHIP_UNVERIFIED", "Legacy QA workspace ownership could not be proven.");
    }
    if (marker && !isSamePath(target, path.join(this.authorizedRoot, safeRef))) throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "QA workspace identity is not rooted at the authorized parent.");
    if (marker && marker.authorizedRootIdentity !== safeDigest(this.authorizedRoot)) throw new FunctionalQaError("QA_WORKSPACE_MARKER_INVALID", "QA workspace marker belongs to another authorized root.");
    if (marker && await this.isMarkerActive(marker, options)) return this.result(marker.workspaceId, marker.qaRunId, safeRef, options, false, false, 0, true, "QA_WORKSPACE_ACTIVE", marker.state);
    if (!options.resourcesStopped || !options.processesExited) return this.result(marker?.workspaceId ?? options.workspaceId ?? `legacy:${safeRef}`, marker?.qaRunId ?? options.qaRunId, safeRef, options, false, false, 0, true, "QA_PROCESS_TERMINATION_FAILED", marker?.state ?? "STALE");
    await this.assertSafeWorkspaceTree(target);
    if (marker) {
      await this.writeMarker(target, { ...marker, state: "CLEANING" }, "w");
      marker = { ...marker, state: "CLEANING" };
    }
    const removal = await this.removeWithRetry(target);
    if (removal.verifiedAbsent) {
      if (marker) activeWorkspaceSessions.delete(marker.workspaceId);
      return this.result(marker?.workspaceId ?? options.workspaceId ?? `legacy:${safeRef}`, marker?.qaRunId ?? options.qaRunId, safeRef, options, true, true, removal.retryCount, false, undefined, "CLEANED");
    }
    if (marker) activeWorkspaceSessions.delete(marker.workspaceId);
    return this.result(marker?.workspaceId ?? options.workspaceId ?? `legacy:${safeRef}`, marker?.qaRunId ?? options.qaRunId, safeRef, options, false, false, removal.retryCount, true, removal.failureCode, "CLEANING");
  }

  assertProjectPath(workspacePath: string, qaWorkspacePath: string) {
    const target = path.resolve(qaWorkspacePath);
    const project = path.resolve(workspacePath);
    this.assertWorkspacePath(target);
    if (!isWithin(target, project)) throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The QA project path is outside its owned QA workspace.");
  }

  private async assertAuthorizedRoot() {
    let info: Stats;
    try { info = await this.fileSystem.lstat(this.authorizedRoot); } catch (error) { throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The authorized QA workspace root is unavailable.", error); }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The authorized QA workspace root must be a real directory.");
    let resolved: string;
    try { resolved = await this.fileSystem.realpath(this.authorizedRoot); } catch (error) { throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The authorized QA workspace root could not be resolved.", error); }
    if (!isSamePath(resolved, this.authorizedRoot)) throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The authorized QA workspace root resolves through a link.");
  }

  private assertWorkspacePath(target: string) {
    if (!workspaceNamePattern.test(path.basename(target)) || !isSamePath(path.dirname(target), this.authorizedRoot)) throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The target is not a direct, compatible QA workspace under the authorized root.");
  }

  private markerPath(target: string) { return path.join(target, QA_WORKSPACE_MARKER_NAME); }

  private async readMarker(target: string): Promise<QaWorkspaceMarker> {
    const markerTarget = this.markerPath(target);
    try {
      const info = await this.fileSystem.lstat(markerTarget);
      if (!info.isFile() || info.isSymbolicLink()) throw new FunctionalQaError("QA_WORKSPACE_MARKER_INVALID", "The QA workspace marker is not a regular file.");
      const parsed = QaWorkspaceMarkerSchema.safeParse(JSON.parse(await this.fileSystem.readFile(markerTarget)));
      if (!parsed.success) throw new FunctionalQaError("QA_WORKSPACE_MARKER_INVALID", "The QA workspace marker failed strict validation.");
      return parsed.data;
    } catch (error) {
      if (error instanceof FunctionalQaError) throw error;
      throw new FunctionalQaError("QA_WORKSPACE_MARKER_INVALID", "The QA workspace marker could not be read.", error);
    }
  }

  private async writeMarker(target: string, marker: QaWorkspaceMarker, flag: "wx" | "w") {
    await this.fileSystem.writeFile(this.markerPath(target), `${JSON.stringify(marker)}\n`, flag);
  }

  private async isMarkerActive(marker: QaWorkspaceMarker, options: CleanupOptions = { reason: "reconciliation", resourcesStopped: true, processesExited: true }) {
    const session = activeWorkspaceSessions.get(marker.workspaceId);
    if (session && isSamePath(session.workspacePath, path.join(this.authorizedRoot, path.basename(session.workspacePath)))) {
      if (options.allowOwnerSession && options.ownerSessionId === session.sessionId) return false;
      return true;
    }
    if (options.allowReconciliation && marker.state === "CLEANING") return false;
    if (marker.state !== "CREATED" && marker.state !== "ACTIVE") return false;
    return this.isProcessAlive(marker.ownerProcessId);
  }

  private async assertSafeWorkspaceTree(target: string) {
    const targetInfo = await this.fileSystem.lstat(target).catch((error) => { throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The QA workspace could not be inspected safely.", error); });
    if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The QA workspace is not a real directory.");
    const queue = [target];
    let inspected = 0;
    while (queue.length) {
      const current = queue.shift()!;
      for (const entry of await this.fileSystem.readdir(current)) {
        inspected += 1;
        if (inspected > 100_000) throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "The QA workspace exceeded the bounded link-safety inspection limit.");
        const child = path.join(current, entry.name);
        const info = await this.fileSystem.lstat(child);
        if (info.isSymbolicLink()) {
          const resolved = await this.fileSystem.realpath(child).catch((error) => { throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "A QA workspace link could not be resolved safely.", error); });
          if (!isWithin(this.authorizedRoot, resolved) && !isSamePath(resolved, this.authorizedRoot)) throw new FunctionalQaError("QA_WORKSPACE_PATH_UNSAFE", "A QA workspace link resolves outside the authorized root.");
        } else if (info.isDirectory()) queue.push(child);
      }
    }
  }

  private async isProvenLegacyWorkspace(target: string) {
    const project = path.join(target, "project");
    try {
      const packageJson = JSON.parse(await this.fileSystem.readFile(path.join(project, "package.json"))) as { name?: string; version?: string; private?: boolean; packageManager?: string; scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      if (packageJson.name !== "generated-project" || packageJson.version !== "0.1.0" || packageJson.private !== true || packageJson.packageManager !== "npm" || packageJson.scripts?.["start:test"] !== "next start" || packageJson.scripts?.build !== "next build") return false;
      if (typeof packageJson.dependencies?.next !== "string" || typeof packageJson.dependencies?.react !== "string" || typeof packageJson.devDependencies?.typescript !== "string") return false;
      const projectInfo = await this.fileSystem.lstat(project);
      const nextInfo = await this.fileSystem.lstat(path.join(project, ".next")).catch(() => undefined);
      return projectInfo.isDirectory() && Boolean(nextInfo?.isDirectory());
    } catch { return false; }
  }

  private async removeWithRetry(target: string) {
    let retryCount = 0;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        await this.fileSystem.rm(target);
        const exists = await this.fileSystem.lstat(target).then(() => true).catch((error) => errorCode(error) !== "ENOENT");
        if (!exists) return { verifiedAbsent: true, retryCount, failureCode: undefined as QaWorkspaceFailureCode | undefined };
        if (attempt === this.maxRetries) return { verifiedAbsent: false, retryCount, failureCode: "QA_WORKSPACE_CLEANUP_RETRY_EXHAUSTED" as const };
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT") return { verifiedAbsent: true, retryCount, failureCode: undefined as QaWorkspaceFailureCode | undefined };
        if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(code ?? "")) return { verifiedAbsent: false, retryCount, failureCode: "QA_WORKSPACE_CLEANUP_FAILED" as const };
        if (attempt === this.maxRetries) return { verifiedAbsent: false, retryCount, failureCode: "QA_WORKSPACE_CLEANUP_RETRY_EXHAUSTED" as const };
      }
      retryCount += 1;
      await this.sleep(QA_WORKSPACE_RETRY_DELAYS_MS[Math.min(retryCount - 1, QA_WORKSPACE_RETRY_DELAYS_MS.length - 1)] ?? 200);
    }
    return { verifiedAbsent: false, retryCount, failureCode: "QA_WORKSPACE_CLEANUP_RETRY_EXHAUSTED" as const };
  }

  private async removePartialWorkspace(target: string) {
    if (!workspaceNamePattern.test(path.basename(target)) || !isSamePath(path.dirname(target), this.authorizedRoot)) return;
    await this.removeWithRetry(target);
  }

  private result(workspaceId: string, qaRunId: string | undefined, safeRef: string, options: CleanupOptions, removed: boolean, verifiedAbsent: boolean, retryCount: number, deferred: boolean, failureCode: QaWorkspaceFailureCode | undefined, state: QaWorkspaceState) {
    return QaWorkspaceCleanupResultSchema.parse({ workspaceId, ...(qaRunId ? { qaRunId } : {}), workspacePathSafeRef: safeRef, attempted: true, resourcesStopped: options.resourcesStopped, processesExited: options.processesExited, removed, verifiedAbsent, retryCount, deferred, ...(failureCode ? { failureCode } : {}), state, reason: options.reason });
  }

  private mapFailureCode(error: unknown): QaWorkspaceFailureCode {
    if (error instanceof FunctionalQaError && QaWorkspaceFailureCodeSchema.safeParse(error.code).success) return error.code as QaWorkspaceFailureCode;
    return "QA_WORKSPACE_RECONCILIATION_FAILED" as QaWorkspaceFailureCode;
  }
}

export class QaWorkspaceHandle {
  private lastCleanup?: QaWorkspaceCleanupResult;
  constructor(private readonly lifecycle: QaWorkspaceLifecycle, readonly marker: QaWorkspaceMarker, readonly workspacePath: string) {}
  get workspaceId() { return this.marker.workspaceId; }
  get qaRunId() { return this.marker.qaRunId; }
  get projectPath() { return path.join(this.workspacePath, "project"); }
  async activate() {
    if (this.lastCleanup) return this;
    await this.lifecycle.activate(this.workspacePath);
    return this;
  }
  assertProjectPath(workspacePath: string) { this.lifecycle.assertProjectPath(workspacePath, this.workspacePath); }
  async cleanup(options: { resourcesStopped?: boolean; processesExited?: boolean; reason?: QaWorkspaceCleanupResult["reason"] } = {}) {
    if (this.lastCleanup?.removed && this.lastCleanup.verifiedAbsent) return this.lastCleanup;
    const result = await this.lifecycle.cleanupPath(this.workspacePath, { reason: options.reason ?? "normal", resourcesStopped: options.resourcesStopped ?? true, processesExited: options.processesExited ?? true, ownerSessionId: this.marker.ownerSessionId, allowOwnerSession: true, workspaceId: this.workspaceId, qaRunId: this.qaRunId });
    if (result.removed || result.deferred) this.lastCleanup = result;
    return result;
  }
}

export function isQaWorkspacePath(value: string) { return workspaceNamePattern.test(path.basename(path.resolve(value))); }
