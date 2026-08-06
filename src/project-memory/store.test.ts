import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DomainError, serializeDomainError } from "../domain/shared/errors";
import { ProjectMemoryStore } from "./store";

const roots: string[] = [];
const base = (documentType: string) => ({ schemaVersion: 1 as const, documentType, projectId: randomUUID(), projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const project = (state: "DRAFT" | "PROJECT_READY" = "DRAFT") => ({ ...base("factory-project"), id: randomUUID(), slug: "memory-test", originalPrompt: "Build a useful site", currentVersion: 1, workflowState: state, ...(state === "PROJECT_READY" ? { implementationStartedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.000Z" } : {}) });

async function makeStore() { const root = await mkdtemp(path.join(os.tmpdir(), "ai-factory-memory-")); roots.push(root); return new ProjectMemoryStore(root).initialize(); }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("ProjectMemoryStore", () => {
  it("initializes, writes, reads, and lists canonical documents", async () => {
    const store = await makeStore(); await store.writeDocument("project.json", project()); await store.writeOriginalPrompt("line one\r\nline two");
    await store.appendDecision({ id: randomUUID(), timestamp: "2026-01-01T00:00:00.000Z", actorType: "user", actorIdentifier: "user", category: "scope", decision: "Foundation only", rationale: "Keep scope bounded", affectedDocuments: ["project.json"], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" });
    expect((await store.readDocument("project.json")).slug).toBe("memory-test"); expect(await readFile(path.join(store.root, "original-prompt.md"), "utf8")).toBe("line one\nline two"); expect(await store.listAvailableDocuments()).toEqual(expect.arrayContaining(["project.json", "original-prompt.md", "manifest.json"]));
  });

  it("rejects invalid documents without replacing the previous valid document", async () => {
    const store = await makeStore(); await store.writeDocument("project.json", project());
    await expect(store.writeDocument("project.json", { bad: true })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await store.readDocument("project.json")).slug).toBe("memory-test");
  });

  it("restores the previous document when the manifest update fails", async () => {
    const store = await makeStore(); await store.writeDocument("project.json", project());
    let failOnce = true;
    const failingStore = new ProjectMemoryStore(store.root, { beforeManifestRename: async () => { if (failOnce) { failOnce = false; throw new Error("simulated manifest failure"); } } });
    await expect(failingStore.writeDocument("project.json", { ...project(), slug: "new-slug" })).rejects.toThrow("simulated manifest failure");
    expect((await store.readDocument("project.json")).slug).toBe("memory-test");
  });

  it("restores prompt and decisions when a manifest update fails", async () => {
    const store = await makeStore(); await store.writeDocument("project.json", project()); await store.writeOriginalPrompt("old prompt");
    let failOnce = true;
    const failingStore = new ProjectMemoryStore(store.root, { beforeManifestRename: async () => { if (failOnce) { failOnce = false; throw new Error("simulated manifest failure"); } } });
    await expect(failingStore.writeOriginalPrompt("new prompt")).rejects.toThrow("simulated manifest failure");
    expect(await readFile(path.join(store.root, "original-prompt.md"), "utf8")).toBe("old prompt");
    let failAgain = true;
    const failingDecisionStore = new ProjectMemoryStore(store.root, { beforeManifestRename: async () => { if (failAgain) { failAgain = false; throw new Error("simulated manifest failure"); } } });
    const decision = { id: randomUUID(), timestamp: "2026-01-01T00:00:00.000Z", actorType: "user" as const, actorIdentifier: "user", category: "scope", decision: "Foundation only", rationale: "Keep scope bounded", affectedDocuments: ["project.json"], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" as const };
    await expect(failingDecisionStore.appendDecision(decision)).rejects.toThrow("simulated manifest failure");
    await expect(readFile(path.join(store.root, "decisions.jsonl"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes structured documents deterministically", async () => {
    const store = await makeStore();
    const first = project();
    await store.writeDocument("project.json", first);
    const firstBytes = await readFile(path.join(store.root, "project.json"), "utf8");
    const reordered = { workflowState: first.workflowState, currentVersion: first.currentVersion, originalPrompt: first.originalPrompt, slug: first.slug, id: first.id, ...base("factory-project"), schemaVersion: first.schemaVersion, documentType: first.documentType, projectId: first.projectId, projectVersion: first.projectVersion, createdAt: first.createdAt, updatedAt: first.updatedAt };
    await store.writeDocument("project.json", reordered);
    expect(await readFile(path.join(store.root, "project.json"), "utf8")).toBe(firstBytes);
  });

  it("builds a checksum manifest and detects tampering and missing files", async () => {
    const store = await makeStore(); await store.writeDocument("project.json", project()); await store.writeOriginalPrompt("prompt");
    const manifest = await store.readDocument("manifest.json"); const entry = manifest.documents.find((item) => item.relativePath === "project.json"); expect(entry?.sha256).toHaveLength(64); expect(await store.verifyIntegrity()).toBe(true);
    await writeFile(path.join(store.root, "project.json"), "tampered"); await expect(store.verifyIntegrity()).rejects.toMatchObject({ code: "INTEGRITY_CHECK_FAILED" }); expect(await store.detectMissingRequiredDocuments()).not.toContain("project.json");
  });

  it("detects schema mismatches, unknown documents, traversal, absolute paths, and invalid decisions", async () => {
    const store = await makeStore(); await store.writeDocument("project.json", project()); await writeFile(path.join(store.root, "unexpected.json"), "{}"); await writeFile(path.join(store.root, "requirements.json"), JSON.stringify({ ...base("requirements"), schemaVersion: 99 }));
    await writeFile(path.join(store.root, "unexpected.jsonl"), "{}");
    expect(await store.detectUnknownCanonicalDocuments()).toContain("unexpected.json");
    expect(await store.detectUnknownCanonicalDocuments()).toContain("unexpected.jsonl");
    await expect(store.readDocument("requirements.json")).rejects.toMatchObject({ code: "SCHEMA_VERSION_MISMATCH" });
    await expect(store.readDocument("../project.json" as "project.json")).rejects.toMatchObject({ code: "PATH_TRAVERSAL_REJECTED" });
    await expect(store.readDocument("C:/project.json" as "project.json")).rejects.toMatchObject({ code: "ABSOLUTE_PATH_REJECTED" });
    await expect(store.appendDecision({ bad: true } as never)).rejects.toThrow();
  });

  it("validates JSONL decisions and keeps released versions immutable", async () => {
    const store = await makeStore(); const released = project("PROJECT_READY"); await store.writeDocument("project.json", released);
    await expect(store.writeOriginalPrompt("no mutation")).rejects.toMatchObject({ code: "PROJECT_VERSION_IMMUTABLE" });
    expect(serializeDomainError(new DomainError("PROJECT_VERSION_IMMUTABLE", "safe", undefined, new Error("private")))).not.toHaveProperty("cause");
  });
});
