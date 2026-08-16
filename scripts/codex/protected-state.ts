import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CODEX_ROOT } from "./config";
import { isIgnored } from "./git";
import { runNpm } from "./process";

export const PROTECTED_SNAPSHOT_FIELDS = [
  "projectId",
  "projectVersion",
  "rowVersion",
  "workflowState",
  "pendingUserAction",
  "operatorLanguage",
  "siteLanguage",
  "briefChecksum",
  "briefApproved",
  "briefReadyForApproval",
] as const;
export type ProtectedSnapshot = { projectId: string; projectVersion: number | null; rowVersion: number | null; workflowState: string | null; pendingUserAction: string | null; operatorLanguage: string | null; siteLanguage: string | null; briefChecksum: string | null; briefApproved: boolean | null; briefReadyForApproval: boolean | null };
export type CodexSession = { schemaVersion: 1; baselineHead: string; baselineUntrackedFiles: string[]; createdAt: string; protectedProjects: ProtectedSnapshot[] };
export type ProtectedDifference = { projectId: string; field: string; before: unknown; after: unknown };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const assertProjectId = (value: string) => { if (!uuid.test(value)) throw new Error("CODEX_PROJECT_ID_INVALID"); return value; };
export const sessionPath = (root = CODEX_ROOT) => path.join(root, ".codex", "session.json");

export function toProtectedSnapshot(value: unknown): ProtectedSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CODEX_STATUS_SHAPE_INVALID");
  const status = value as Record<string, unknown>;
  const brief = status.brief && typeof status.brief === "object" && !Array.isArray(status.brief) ? status.brief as Record<string, unknown> : {};
  if (typeof status.projectId !== "string") throw new Error("CODEX_STATUS_PROJECT_ID_MISSING");
  return {
    projectId: status.projectId,
    projectVersion: typeof status.projectVersion === "number" ? status.projectVersion : null,
    rowVersion: typeof status.rowVersion === "number" ? status.rowVersion : null,
    workflowState: typeof status.workflowState === "string" ? status.workflowState : null,
    pendingUserAction: typeof status.pendingUserAction === "string" ? status.pendingUserAction : null,
    operatorLanguage: typeof status.operatorLanguage === "string" ? status.operatorLanguage : null,
    siteLanguage: typeof status.siteLanguage === "string" ? status.siteLanguage : null,
    briefChecksum: typeof brief.checksum === "string" ? brief.checksum : null,
    briefApproved: typeof brief.approved === "boolean" ? brief.approved : null,
    briefReadyForApproval: typeof brief.readyForApproval === "boolean" ? brief.readyForApproval : null,
  };
}

function parseStatusOutput(stdout: string, stderr: string) {
  const candidates = `${stdout}\n${stderr}`.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("{"));
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(candidates[index]!) as unknown; } catch { /* npm's status prefix is not JSON; keep scanning. */ }
  }
  throw new Error("CODEX_STATUS_JSON_UNAVAILABLE");
}

export async function readProtectedProjectSnapshot(root: string, projectId: string) {
  assertProjectId(projectId);
  const result = await runNpm(root, ["run", "factory:status", "--", "--project", projectId, "--json"], 120_000);
  if (result.code !== 0) throw new Error("CODEX_STATUS_READ_FAILED");
  const snapshot = toProtectedSnapshot(parseStatusOutput(result.stdout, result.stderr));
  if (snapshot.projectId.toLowerCase() !== projectId.toLowerCase()) throw new Error("CODEX_STATUS_PROJECT_MISMATCH");
  return snapshot;
}

export function compareProtectedSnapshot(expected: ProtectedSnapshot, actual: ProtectedSnapshot): ProtectedDifference[] {
  const differences: ProtectedDifference[] = [];
  for (const field of PROTECTED_SNAPSHOT_FIELDS) if (expected[field] !== actual[field]) differences.push({ projectId: expected.projectId, field, before: expected[field], after: actual[field] });
  return differences;
}

export function buildSession(baselineHead: string, protectedProjects: readonly ProtectedSnapshot[], createdAt = new Date().toISOString(), baselineUntrackedFiles: readonly string[] = []): CodexSession {
  return { schemaVersion: 1, baselineHead, baselineUntrackedFiles: [...new Set(baselineUntrackedFiles)], createdAt, protectedProjects: protectedProjects.map((project) => ({ ...project })) };
}

export function assertSessionStartAllowed(existing: boolean, reset: boolean) {
  if (existing && !reset) throw new Error("CODEX_SESSION_ACTIVE_USE_RESET_EXPLICITLY");
}

export async function loadSession(root = CODEX_ROOT): Promise<CodexSession> {
  let raw: string;
  try { raw = await readFile(sessionPath(root), "utf8"); } catch { throw new Error("CODEX_SESSION_MISSING_RUN_START"); }
  try {
    const value = JSON.parse(raw) as CodexSession;
    if (value.schemaVersion !== 1 || typeof value.baselineHead !== "string" || !Array.isArray(value.protectedProjects)) throw new Error("invalid");
    if (!Array.isArray(value.baselineUntrackedFiles)) value.baselineUntrackedFiles = [];
    for (const snapshot of value.protectedProjects) toProtectedSnapshot(snapshot);
    return value;
  } catch { throw new Error("CODEX_SESSION_INVALID"); }
}

export async function ensureCodexIgnored(root = CODEX_ROOT) {
  if (!(await isIgnored(root, ".codex/session.json"))) throw new Error("CODEX_DIRECTORY_NOT_IGNORED");
}

export async function saveSession(root: string, session: CodexSession) {
  await ensureCodexIgnored(root);
  const directory = path.dirname(sessionPath(root));
  await mkdir(directory, { recursive: true });
  const temporary = `${sessionPath(root)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", flag: "wx" }).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  });
  await rename(temporary, sessionPath(root));
}

export async function sessionExists(root = CODEX_ROOT) {
  try { await access(sessionPath(root)); return true; } catch { return false; }
}

export async function verifyProtectedProjects(root: string, session: CodexSession) {
  const differences: ProtectedDifference[] = [];
  for (const expected of session.protectedProjects) {
    const actual = await readProtectedProjectSnapshot(root, expected.projectId);
    differences.push(...compareProtectedSnapshot(expected, actual));
  }
  return differences;
}
