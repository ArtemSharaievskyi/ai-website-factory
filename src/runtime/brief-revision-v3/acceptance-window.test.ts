import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AcceptanceWindowError, AcceptanceWindowStore, type AcceptanceWindowFaultPoint } from "./acceptance-window";

const sourceFingerprint = "a".repeat(64);

function artifact(windowId: string, runId: string) {
  const evidenceBody = { schemaVersion: 1, kind: "synthetic-evidence", windowId, runId, sourceFingerprint, status: "INCONCLUSIVE" };
  const evidenceDigest = createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(evidenceBody).sort())), "utf8").digest("hex");
  return { windowId, runId, sourceFingerprint, status: "INCONCLUSIVE" as const, evidenceBody, evidenceDigest, serialized: JSON.stringify({ windowId, runId, sourceFingerprint, status: "INCONCLUSIVE", evidenceBody, evidenceDigest }) };
}

describe("Brief Revision V3 acceptance windows", () => {
  it("has one consumption winner and one immutable final artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-window-"));
    try {
      const store = new AcceptanceWindowStore(root);
      const runId = randomUUID();
      const created = await store.create({ sourceFingerprint, runId, now: "2026-08-16T00:00:00.000Z" });
      const results = await Promise.allSettled([store.consume(created.windowId), store.consume(created.windowId)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(rejected?.reason).toBeInstanceOf(AcceptanceWindowError);
      expect(rejected?.reason.code).toBe("ACCEPTANCE_WINDOW_ALREADY_CONSUMED");
      const final = artifact(created.windowId, runId);
      expect((await store.finalize({ windowId: created.windowId, runId, sourceFingerprint, evidenceDigest: final.evidenceDigest, evidenceSerialized: final.serialized })).state).toBe("FINALIZED");
      await expect(store.finalize({ windowId: created.windowId, runId, sourceFingerprint, evidenceDigest: final.evidenceDigest, evidenceSerialized: final.serialized })).rejects.toMatchObject({ code: "ACCEPTANCE_WINDOW_ALREADY_FINALIZED" });
      await expect(store.consume(created.windowId)).rejects.toMatchObject({ code: "ACCEPTANCE_WINDOW_ALREADY_CONSUMED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["before-temp-write", "during-temp-write", "after-temp-write-before-publication", "during-atomic-publication"] as AcceptanceWindowFaultPoint[])("does not expose a finalized state after %s fault", async (point) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-window-fault-"));
    try {
      const store = new AcceptanceWindowStore(root);
      const runId = randomUUID();
      const created = await store.create({ sourceFingerprint, runId });
      await store.consume(created.windowId);
      const final = artifact(created.windowId, runId);
      await expect(store.finalize({ windowId: created.windowId, runId, sourceFingerprint, evidenceDigest: final.evidenceDigest, evidenceSerialized: final.serialized, faults: { hit: (fault) => { if (fault === point) throw new Error(`fault:${point}`); } } })).rejects.toThrow(`fault:${point}`);
      expect((await store.read(created.windowId)).state).toBe("CONSUMED");
      const temporaryArtifacts = await store.listTemporaryArtifacts(created.windowId);
      expect(temporaryArtifacts.length).toBe(point === "during-temp-write" || point === "after-temp-write-before-publication" ? 1 : 0);
      await expect(store.finalize({ windowId: created.windowId, runId, sourceFingerprint, evidenceDigest: final.evidenceDigest, evidenceSerialized: final.serialized })).resolves.toMatchObject({ state: "FINALIZED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a published artifact readable when a post-publication fault occurs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-window-post-fault-"));
    try {
      const store = new AcceptanceWindowStore(root);
      const runId = randomUUID();
      const created = await store.create({ sourceFingerprint, runId });
      await store.consume(created.windowId);
      const final = artifact(created.windowId, runId);
      await expect(store.finalize({ windowId: created.windowId, runId, sourceFingerprint, evidenceDigest: final.evidenceDigest, evidenceSerialized: final.serialized, faults: { hit: (fault) => { if (fault === "after-atomic-publication") throw new Error("after-publication"); } } })).rejects.toThrow("after-publication");
      expect((await store.read(created.windowId)).state).toBe("FINALIZED");
      expect(await store.listTemporaryArtifacts(created.windowId)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("binds finalization to the stored run and source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-window-binding-"));
    try {
      const store = new AcceptanceWindowStore(root);
      const runId = randomUUID();
      const created = await store.create({ sourceFingerprint, runId });
      await store.consume(created.windowId);
      const final = artifact(created.windowId, runId);
      await expect(store.finalize({ windowId: created.windowId, runId: randomUUID(), sourceFingerprint, evidenceDigest: final.evidenceDigest, evidenceSerialized: final.serialized })).rejects.toMatchObject({ code: "ACCEPTANCE_WINDOW_ARTIFACT_CORRUPT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows only one concurrent finalization to publish the immutable artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-window-concurrent-finalize-"));
    try {
      const store = new AcceptanceWindowStore(root);
      const runId = randomUUID();
      const created = await store.create({ sourceFingerprint, runId });
      await store.consume(created.windowId);
      const final = artifact(created.windowId, runId);
      const results = await Promise.allSettled([
        store.finalize({ windowId: created.windowId, runId, sourceFingerprint, evidenceDigest: final.evidenceDigest, evidenceSerialized: final.serialized }),
        store.finalize({ windowId: created.windowId, runId, sourceFingerprint, evidenceDigest: final.evidenceDigest, evidenceSerialized: final.serialized }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason.code)).toEqual(["ACCEPTANCE_WINDOW_ALREADY_FINALIZED"]);
      expect((await store.read(created.windowId)).state).toBe("FINALIZED");
      expect(await store.listTemporaryArtifacts(created.windowId)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
