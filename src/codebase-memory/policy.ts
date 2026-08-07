import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { CodebaseMemoryError } from "./errors";
import type { WorkspaceScope } from "./contracts";
export const CODEBASE_MEMORY_POLICY_VERSION = "codebase-memory-policy-v1";
export const EXCLUDED_NAMES = new Set([".git",".factory","node_modules",".next","dist","coverage"]);
const sourceFile = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|yml|yaml|toml)$/i;
const secretFile = /^(?:\.env(?:\..*)?|.*(?:secret|credential|password|token|key).*|.*\.pem)$/i;
export function validateWorkspaceScope(scope: WorkspaceScope): WorkspaceScope {
  const parsed = { ...scope, workspacePath: path.resolve(scope.workspacePath), generatedProjectsRoot: path.resolve(scope.generatedProjectsRoot) };
  const root = parsed.generatedProjectsRoot.toLowerCase(); const workspace = parsed.workspacePath.toLowerCase();
  if (workspace === root || !workspace.startsWith(`${root}${path.sep}`) || workspace.includes(`${path.sep}.staging${path.sep}`) === false && !/^v\d+$/i.test(path.basename(workspace))) throw new CodebaseMemoryError("CODEBASE_MEMORY_WORKSPACE_INVALID", "Only one exact generated project version workspace may be indexed.");
  const referenceMatch = parsed.workspaceManagerReference.match(/^(.+):v(\d+)$/i); const projectDirectory = workspace.includes(`${path.sep}.staging${path.sep}`) ? path.basename(path.dirname(path.dirname(workspace))) : path.basename(path.dirname(workspace)); if (!referenceMatch || Number(referenceMatch[2]) !== parsed.projectVersion || referenceMatch[1].toLowerCase() !== projectDirectory) throw new CodebaseMemoryError("CODEBASE_MEMORY_WORKSPACE_INVALID", "The workspace does not match the canonical Workspace Manager reference.");
  if (workspace.includes(`${path.sep}.factory${path.sep}`) || workspace.includes(`${path.sep}node_modules${path.sep}`)) throw new CodebaseMemoryError("CODEBASE_MEMORY_WORKSPACE_INVALID", "The requested workspace is not an application workspace.");
  if (path.parse(workspace).root.toLowerCase() === workspace) throw new CodebaseMemoryError("CODEBASE_MEMORY_WORKSPACE_INVALID", "Filesystem roots cannot be indexed.");
  return parsed;
}
export async function computeSourceManifest(scope: WorkspaceScope) {
  const safe = validateWorkspaceScope(scope); const root = safe.workspacePath; const files: Array<{ relativePath: string; sha256: string; bytes: number }> = [];
  const walk = async (directory: string) => { const entries = (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name)); for (const entry of entries) { if (EXCLUDED_NAMES.has(entry.name) || secretFile.test(entry.name) || entry.name.startsWith(".")) continue; const full = path.join(directory, entry.name); const info = await lstat(full); if (info.isSymbolicLink()) continue; if (info.isDirectory()) await walk(full); else if (info.isFile() && sourceFile.test(entry.name)) { const bytes = await readFile(full); files.push({ relativePath: path.relative(root, full).replaceAll("\\","/"), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }); } } };
  await walk(root); files.sort((a,b) => a.relativePath.localeCompare(b.relativePath)); const checksum = createHash("sha256").update(JSON.stringify(files), "utf8").digest("hex"); return { checksum, files };
}
export function canonicalWorkspaceIdentity(scope: WorkspaceScope) { return `${scope.projectId}:${scope.projectVersion}:${path.resolve(scope.workspacePath).toLowerCase()}`; }
export function isSafeQueryText(value: string) { if (/sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|DATABASE_URL|password\s*[:=]|-----BEGIN/i.test(value)) throw new CodebaseMemoryError("CODEBASE_MEMORY_QUERY_INVALID", "Secret-like query text is not permitted."); if (value.length > 300) throw new CodebaseMemoryError("CODEBASE_MEMORY_QUERY_INVALID", "Codebase Memory queries must be narrow and bounded."); }
export function assertSafeRelativePath(value: string) { const normalized = value.replaceAll("\\","/"); if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..") || EXCLUDED_NAMES.has(normalized.split("/")[0] ?? "")) throw new CodebaseMemoryError("CODEBASE_MEMORY_WORKSPACE_INVALID", "The requested path is outside the indexed application source."); }
export async function assertExistingWorkspace(scope: WorkspaceScope) { const safe = validateWorkspaceScope(scope); const info = await lstat(safe.workspacePath).catch(() => undefined); if (!info?.isDirectory() || info.isSymbolicLink()) throw new CodebaseMemoryError("CODEBASE_MEMORY_WORKSPACE_INVALID", "The generated workspace is unavailable or unsafe."); return safe; }
