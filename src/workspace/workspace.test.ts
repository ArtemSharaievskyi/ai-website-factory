import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "../domain/project/schema";
import { DecisionRepository, ProjectRepository, ProjectVersionRepository } from "../persistence/repositories";
import { InMemoryPersistenceDatabase } from "../persistence/fake";
import { ProjectMemoryStore } from "../project-memory/store";
import { checksumPersistedDocument } from "../persistence/serialization";
import { WorkspaceError } from "./errors";
import { WorkspaceManager } from "./manager";
import { FilesystemProjectMemorySyncPort } from "./sync";
import { WorkspaceRootSchema, WorkspaceSlugSchema } from "./schemas";

const roots: string[] = [];
const id = () => randomUUID();
const project = () => { const projectId = id(); return FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", id: projectId, slug: "workspace-test", title: "Workspace Test", originalPrompt: "Create a safe project", currentVersion: 1, workflowState: "DRAFT" }); };
async function fixture() { const root = await mkdtemp(path.join(os.tmpdir(), "factory-workspace-")); roots.push(root); const db = new InMemoryPersistenceDatabase(); const value = project(); await new ProjectRepository(db).create(value); const manager = new WorkspaceManager({ root, versions: new ProjectVersionRepository(db), decisions: new DecisionRepository(db), testMode: true, configuredProductionRoot: path.join(root, "production-root") }); return { root, db, value, manager }; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("WorkspaceManager", () => {
  it("validates absolute roots and safe Windows-compatible slugs", () => {
    expect(() => WorkspaceRootSchema.parse("relative/workspace")).toThrow(); expect(() => WorkspaceSlugSchema.parse("CON")).toThrow(); expect(() => WorkspaceSlugSchema.parse("../escape")).toThrow(); expect(() => WorkspaceSlugSchema.parse("safe-project")).not.toThrow(); expect(() => WorkspaceSlugSchema.parse("project\\child")).toThrow(); expect(() => WorkspaceSlugSchema.parse("trailing-space ")).toThrow();
  });

  it("creates an idempotent project root, reserves v1, stages, promotes, and initializes Project Memory", async () => {
    const { root, value, manager } = await fixture(); const first = await manager.createInitialVersion(value, { idempotencyKey: "initial-version-key" }); const second = await manager.createInitialVersion(value, { idempotencyKey: "initial-version-key" }); expect(first.version.versionNumber).toBe(1); expect(second.path).toBe(first.path); expect(await manager.listProjectVersions(value.slug)).toEqual([1]); expect(await readFile(path.join(first.path, ".factory", "original-prompt.md"), "utf8")).toBe(value.originalPrompt); expect(await new ProjectMemoryStore(path.join(first.path, ".factory")).verifyIntegrity()).toBe(true); expect((await readdir(path.join(root, value.slug, ".staging"))).length).toBe(0);
  });

  it("reserves concurrent versions through the persistence port and compares compatible checksums", async () => {
    const { root, value, manager } = await fixture(); const reservations = await Promise.all([manager.reserveNextVersion(value.id, "reserve-one"), manager.reserveNextVersion(value.id, "reserve-two")]); expect(reservations.map((row) => row.versionNumber).sort((a, b) => a - b)).toEqual([1, 2]); const initial = await manager.createInitialVersion(value, { idempotencyKey: "reserve-one" }); expect(initial.version.versionNumber).toBe(1);
    const sync = new FilesystemProjectMemorySyncPort(root, value.slug); const memory = new ProjectMemoryStore(path.join(await manager.getProjectRoot(value.slug), "v1", ".factory")); const document = await memory.readDocument("project.json"); const databaseChecksum = checksumPersistedDocument(document); const filesystem = await sync.filesystemChecksums(1); const promptChecksum = createHash("sha256").update(value.originalPrompt, "utf8").digest("hex"); expect(databaseChecksum).toBe(filesystem["project.json"]); expect((await sync.compareDatabaseAndFilesystemChecksums({ "project.json": databaseChecksum, "original-prompt.md": promptChecksum }, filesystem)).matches).toBe(true);
  });

  it("copies a released version forward without transient files and preserves the source", async () => {
    const { value, manager } = await fixture(); const first = await manager.createInitialVersion(value); await writeFile(path.join(first.path, "source.txt"), "keep"); await mkdir(path.join(first.path, "node_modules")); await writeFile(path.join(first.path, "node_modules", "skip.js"), "skip"); await writeFile(path.join(first.path, ".env"), "secret"); await writeFile(path.join(first.path, ".env.example"), "placeholder"); await manager.markVersionImmutable(value.id, value.slug, 1); const revision = await manager.createRevisionFromVersion({ ...value, workflowState: "PROJECT_READY", completedAt: "2026-01-02T00:00:00.000Z" }, 1); expect(revision.version.versionNumber).toBe(2); expect(await readFile(path.join(revision.path, "source.txt"), "utf8")).toBe("keep"); await expect(readFile(path.join(revision.path, "node_modules", "skip.js"))).rejects.toBeDefined(); await expect(readFile(path.join(revision.path, ".env"))).rejects.toBeDefined(); expect(await readFile(path.join(revision.path, ".env.example"), "utf8")).toBe("placeholder"); expect(await readFile(path.join(first.path, "source.txt"), "utf8")).toBe("keep"); await expect(manager.markVersionImmutable(value.id, value.slug, 1)).rejects.toMatchObject({ code: "WORKSPACE_IMMUTABLE" });
  });

  it("blocks active foreign locks, reclaims expired locks, and cleans only owned staging", async () => {
    const { value, manager } = await fixture(); await manager.createProjectRoot(value); const lock = await manager.acquireLock(value.slug, "operation-one"); await expect(manager.acquireLock(value.slug, "operation-two")).rejects.toMatchObject({ code: "WORKSPACE_LOCKED" }); await manager.releaseLock(value.slug, lock.operationId); const lockPath = path.join(await manager.getProjectRoot(value.slug), ".workspace.lock"); await writeFile(lockPath, JSON.stringify({ operationId: "expired-one", createdAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T00:00:01.000Z" })); await expect(manager.acquireLock(value.slug, "operation-two")).resolves.toBeDefined(); await manager.releaseLock(value.slug, "operation-two"); await mkdir(path.join(await manager.getProjectRoot(value.slug), ".staging", "v9-cleanup-op")); await writeFile(path.join(await manager.getProjectRoot(value.slug), ".staging", "v9-cleanup-op", ".workspace-operation"), JSON.stringify({ operationId: "cleanup-op", version: 9 })); expect((await manager.cleanupFailedStaging(value.slug, 9, "cleanup-op")).removed).toBe(true); await expect(manager.cleanupFailedStaging(value.slug, 9, "cleanup-op")).resolves.toEqual({ removed: false });
  });

  it("reports database/filesystem reconciliation issues without automatic repair", async () => {
    const { root, value, manager } = await fixture(); await manager.createProjectRoot(value); await manager.reserveNextVersion(value.id, "reserve-without-directory"); await mkdir(path.join(root, value.slug, "v9")); await mkdir(path.join(root, value.slug, ".staging", "v8-interrupted")); const report = await manager.reconcile(value.id, value.slug); expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["DATABASE_VERSION_DIRECTORY_MISSING", "DIRECTORY_DATABASE_VERSION_MISSING", "WORKSPACE_STAGING_INTERRUPTED"])); expect(report.issues.every((issue) => issue.automaticRepairAllowed === false)).toBe(true);
  });

  it("rejects unsafe errors without exposing full filesystem paths", async () => { const { manager } = await fixture(); try { await manager.getProjectRoot("../escape"); } catch (error) { const serialized = error instanceof WorkspaceError ? { code: error.code, message: error.message } : {}; expect(JSON.stringify(serialized)).not.toContain(process.cwd()); } });

  it("accepts an owned execution staging workspace and blocks tampered ownership", async () => { const { value, manager } = await fixture(); await manager.createInitialVersion(value); const operation = "execution-owned"; const staging = await manager.createMutableExecutionStaging(value, 1, operation); await expect(manager.verifyStagingWorkspace(value.slug, 1, operation, staging)).resolves.toBe(true); await writeFile(path.join(staging, ".workspace-operation"), JSON.stringify({ operationId: "foreign-operation", version: 1 })); await expect(manager.verifyStagingWorkspace(value.slug, 1, operation, staging)).rejects.toMatchObject({ code: "WORKSPACE_STAGING_FAILED" }); });
});
