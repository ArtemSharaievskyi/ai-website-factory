import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CodebaseMemoryOperationSchema,
  CodeRelationshipSchema,
  CodeSymbolReferenceSchema,
  SourceExcerptSchema,
  WorkspaceScopeSchema,
} from "./contracts";
import { CodebaseMemoryError } from "./errors";
import { canonicalWorkspaceIdentity } from "./policy";
import type { CodebaseMemoryIndex, CodebaseMemoryResult, WorkspaceScope } from "./contracts";

const ADAPTER_VERSION = "codebase-memory-adapter-v1";
const METADATA_SCHEMA_VERSION = 1 as const;

export const CodebaseMemoryMetadataSchema = z.object({
  currentIndexId: z.string().min(1),
  manifestChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["NOT_INDEXED", "INDEXING", "READY", "STALE", "FAILED"]),
  updatedAt: z.string().datetime(),
  adapterVersion: z.string().min(1),
}).strict();
export type CodebaseMemoryMetadata = z.infer<typeof CodebaseMemoryMetadataSchema>;
export const CODEBASE_MEMORY_METADATA_FILENAME = "codebase-memory.json";

const PersistedIndexSchema = z.object({
  indexId: z.string().min(1),
  scope: WorkspaceScopeSchema,
  workspaceIdentity: z.string().min(1),
  manifestChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  policyVersion: z.string().min(1),
  adapterVersion: z.string().min(1),
  status: z.enum(["NOT_INDEXED", "INDEXING", "READY", "STALE", "FAILED"]),
  indexedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
  errorCode: z.string().min(1).optional(),
}).strict();

const PersistedResultSchema = z.object({
  queryId: z.string().uuid(),
  operation: CodebaseMemoryOperationSchema,
  index: PersistedIndexSchema,
  symbols: z.array(CodeSymbolReferenceSchema),
  relationships: z.array(CodeRelationshipSchema),
  excerpts: z.array(SourceExcerptSchema),
  impact: z.unknown().optional(),
  totalBytes: z.number().int().nonnegative(),
  cache: z.enum(["hit", "miss"]),
}).strict();

export const CodebaseMemoryPersistedStateSchema = z.object({
  schemaVersion: z.literal(METADATA_SCHEMA_VERSION),
  projectId: z.string().min(1),
  projectVersion: z.number().int().positive(),
  workspaceIdentity: z.string().min(1),
  metadata: CodebaseMemoryMetadataSchema,
  index: PersistedIndexSchema,
  idempotency: z.array(z.object({ queryId: z.string().min(1), inputHash: z.string().min(1) }).strict()).max(10000),
  cache: z.array(z.object({ key: z.string().min(1), expiresAt: z.number().int().nonnegative(), result: PersistedResultSchema }).strict()).max(10000),
}).strict();
export type CodebaseMemoryPersistedState = z.infer<typeof CodebaseMemoryPersistedStateSchema>;

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

export function codebaseMemoryMetadataPath(scope: WorkspaceScope) {
  const directory = path.join(path.resolve(scope.generatedProjectsRoot), ".codebase-memory", sha(canonicalWorkspaceIdentity(scope)));
  return path.join(directory, CODEBASE_MEMORY_METADATA_FILENAME);
}

export async function readCodebaseMemoryMetadata(scope: WorkspaceScope): Promise<CodebaseMemoryPersistedState | undefined> {
  try {
    const raw = await readFile(codebaseMemoryMetadataPath(scope), "utf8");
    try {
      return CodebaseMemoryPersistedStateSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new CodebaseMemoryError("CODEBASE_MEMORY_METADATA_INVALID", "Codebase Memory metadata is invalid.", error);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof CodebaseMemoryError) throw error;
    throw new CodebaseMemoryError("CODEBASE_MEMORY_METADATA_INVALID", "Codebase Memory metadata could not be read.", error);
  }
}

export async function writeCodebaseMemoryMetadata(scope: WorkspaceScope, state: CodebaseMemoryPersistedState) {
  const parsed = CodebaseMemoryPersistedStateSchema.parse(state);
  const target = codebaseMemoryMetadataPath(scope);
  const directory = path.dirname(target);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let created = false;
  try {
    await mkdir(directory, { recursive: true });
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink()) throw new CodebaseMemoryError("CODEBASE_MEMORY_PERSISTENCE_FAILED", "Codebase Memory metadata cannot replace a symbolic link.");
    } catch (error) {
      if (error instanceof CodebaseMemoryError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(temporary, `${JSON.stringify(stableValue(parsed), null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    created = true;
    const handle = await open(temporary, constants.O_RDWR);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    created = false;
    await syncContainingDirectory(directory);
  } catch (error) {
    if (created) await rm(temporary, { force: true }).catch(() => undefined);
    if (error instanceof CodebaseMemoryError) throw error;
    throw new CodebaseMemoryError("CODEBASE_MEMORY_PERSISTENCE_FAILED", "Codebase Memory metadata could not be durably published.", error);
  }
}

async function syncContainingDirectory(directory: string) {
  if (process.platform === "win32") return;
  try {
    const handle = await open(directory, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EINVAL" || code === "ENOTSUP" || code === "EISDIR") return;
    throw new CodebaseMemoryError("CODEBASE_MEMORY_PERSISTENCE_FAILED", "Codebase Memory metadata directory could not be synced.", error);
  }
}

export function metadataForIndex(index: CodebaseMemoryIndex): CodebaseMemoryMetadata {
  return CodebaseMemoryMetadataSchema.parse({
    currentIndexId: index.indexId,
    manifestChecksum: index.manifestChecksum,
    status: index.status,
    updatedAt: index.updatedAt,
    adapterVersion: index.adapterVersion || ADAPTER_VERSION,
  });
}

export function parsePersistedIndex(value: unknown): CodebaseMemoryIndex {
  return PersistedIndexSchema.parse(value) as CodebaseMemoryIndex;
}

export function parsePersistedResult(value: unknown): CodebaseMemoryResult {
  return PersistedResultSchema.parse(value) as CodebaseMemoryResult;
}
