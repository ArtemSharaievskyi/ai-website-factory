import { lstat, readdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { QaWorkspaceLifecycle } from "../src/runtime/qa/workspace";

const MAX_RETRIES = 4;
const RETRY_DELAYS_MS = [25, 50, 100, 200] as const;
const MAX_DEBUG_ENTRIES = 512;
const MAX_DEBUG_FILE_BYTES = 2 * 1024 * 1024;
const root = path.resolve(process.cwd());
const NEVER_TOUCH = [".factory-generated", ".factory-assets", "node_modules", ".env", ".vercel", ".context7-cache"] as const;

type CleanupOutcome = { target: string; action: "removed" | "absent" | "preserved"; reason?: string; retries: number };

const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
const samePath = (left: string, right: string) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const isTransientLock = (error: unknown) => ["EPERM", "EBUSY", "ENOTEMPTY"].includes(errorCode(error) ?? "");

async function assertRepositoryRoot() {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || samePath(root, path.parse(root).root)) throw new Error("CLEAN_WORKSPACE_ROOT_UNSAFE");
  if (!samePath(await realpath(root), root)) throw new Error("CLEAN_WORKSPACE_ROOT_LINKED");
  for (const required of ["package.json", ".gitignore", "src", "scripts", "supabase"]) await lstat(path.join(root, required));
}

function rootEntry(name: string) {
  const target = path.resolve(root, name);
  if (!samePath(path.dirname(target), root) || path.basename(target) !== name) throw new Error("CLEAN_WORKSPACE_TARGET_UNSAFE");
  return target;
}

async function removeRootEntry(name: string): Promise<CleanupOutcome> {
  const target = rootEntry(name);
  const info = await lstat(target).catch((error) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (!info) return { target: name, action: "absent", retries: 0 };
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`CLEAN_WORKSPACE_TARGET_UNSAFE:${name}`);

  let retries = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 0 });
      const stillExists = await lstat(target).then(() => true).catch((error) => errorCode(error) !== "ENOENT");
      if (!stillExists) return { target: name, action: "removed", retries };
    } catch (error) {
      if (!isTransientLock(error)) throw error;
      if (attempt === MAX_RETRIES) throw new Error(`CLEAN_WORKSPACE_RETRY_EXHAUSTED:${name}`);
    }
    if (attempt === MAX_RETRIES) throw new Error(`CLEAN_WORKSPACE_RETRY_EXHAUSTED:${name}`);
    retries += 1;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[Math.min(retries - 1, RETRY_DELAYS_MS.length - 1)] ?? 200));
  }
  throw new Error(`CLEAN_WORKSPACE_RETRY_EXHAUSTED:${name}`);
}

function looksLikeEvidence(name: string, parsed: unknown) {
  if (/(report|result|evidence)/i.test(name)) return true;
  if (!parsed || typeof parsed !== "object") return false;
  const record = parsed as Record<string, unknown>;
  return typeof record.reportType === "string" || typeof record.overallStatus === "string" || "releaseEligible" in record || "prohibitedActions" in record;
}

async function inspectDebugRoot(target: string) {
  const queue = [target];
  let inspected = 0;
  let evidence = false;
  let disposable = true;
  while (queue.length) {
    const current = queue.shift()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      inspected += 1;
      if (inspected > MAX_DEBUG_ENTRIES) return { evidence, disposable: false, unsafe: true };
      const child = path.join(current, entry.name);
      const childInfo = await lstat(child);
      if (childInfo.isSymbolicLink()) return { evidence, disposable: false, unsafe: true };
      if (childInfo.isDirectory()) {
        queue.push(child);
        continue;
      }
      if (!childInfo.isFile() || childInfo.size > MAX_DEBUG_FILE_BYTES) return { evidence, disposable: false, unsafe: true };
      let parsed: unknown;
      if (path.extname(entry.name).toLowerCase() === ".json") {
        try { parsed = JSON.parse(await readFile(child, "utf8")); } catch { disposable = false; continue; }
      }
      if (looksLikeEvidence(entry.name, parsed)) evidence = true;
      if (!/(?:debug|trace|tmp|log|dump)/i.test(entry.name)) disposable = false;
    }
  }
  return { evidence, disposable, unsafe: false };
}

async function cleanDebugRoot(): Promise<CleanupOutcome> {
  const target = rootEntry(".factory-generated-debug");
  const info = await lstat(target).catch((error) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (!info) return { target: ".factory-generated-debug", action: "absent", retries: 0 };
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("CLEAN_WORKSPACE_TARGET_UNSAFE:.factory-generated-debug");
  const inspection = await inspectDebugRoot(target);
  if (inspection.evidence) return { target: ".factory-generated-debug", action: "preserved", reason: "historical-evidence", retries: 0 };
  if (inspection.unsafe || !inspection.disposable) return { target: ".factory-generated-debug", action: "preserved", reason: "provenance-unresolved", retries: 0 };
  return removeRootEntry(".factory-generated-debug");
}

async function main() {
  await assertRepositoryRoot();
  const preservedQa = process.env.PRESERVE_QA_ARTIFACTS === "1" || process.env.PRESERVE_QA_ARTIFACTS?.toLowerCase() === "true";
  const outcomes: CleanupOutcome[] = [];
  for (const target of [".next", "coverage"]) outcomes.push(await removeRootEntry(target));
  outcomes.push(await cleanDebugRoot());

  if (preservedQa) {
    outcomes.push({ target: ".qa-foundation-*", action: "preserved", reason: "PRESERVE_QA_ARTIFACTS", retries: 0 });
  } else {
    const reconciliation = await new QaWorkspaceLifecycle({ authorizedRoot: root }).reconcile();
    outcomes.push({ target: ".qa-foundation-*", action: reconciliation.cleaned ? "removed" : "absent", reason: `${reconciliation.cleaned} proven stale workspace(s) removed; ${reconciliation.preserved} preserved`, retries: 0 });
    if (reconciliation.failures.length) throw new Error(`CLEAN_WORKSPACE_QA_RECONCILIATION_FAILED:${JSON.stringify(reconciliation.failures)}`);
  }

  console.log(JSON.stringify({ status: "passed", root, preservedQa, neverTouch: NEVER_TOUCH, outcomes }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "CLEAN_WORKSPACE_FAILED");
  process.exitCode = 1;
});
