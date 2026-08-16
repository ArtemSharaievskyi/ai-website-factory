import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { normalizeAssetRow } from "./postgres";
import { PostgresPersistenceDatabase } from "./postgres";

describe("Postgres asset row normalization", () => {
  it("omits nullable optional asset fields instead of passing null into strict domain schemas", () => {
    const normalized = normalizeAssetRow({
      schemaVersion: 1,
      assetId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000001",
      projectVersion: 1,
      category: "LOGO",
      source: "USER_SUPPLIED",
      safeDisplayName: "logo.png",
      mediaType: "image/png",
      byteSize: 16,
      sha256: "a".repeat(64),
      storageIdentity: "projects/00000000-0000-4000-8000-000000000001/assets/00000000-0000-4000-8000-000000000002/png",
      status: "UPLOADING",
      createdAt: "2026-08-14T12:00:00.000Z",
      updatedAt: "2026-08-14T12:00:00.000Z",
      version: 1,
      currentness: "CURRENT",
      supersedesAssetId: null as never,
      rejectionReason: null as never,
    });
    expect(normalized).not.toHaveProperty("supersedesAssetId");
    expect(normalized).not.toHaveProperty("rejectionReason");
  });
});

describe("Postgres transaction ambiguity handling", () => {
  it("evicts a client when COMMIT acknowledgement is ambiguous", async () => {
    const release = vi.fn();
    const client = { query: vi.fn().mockImplementation((sql: string) => sql === "COMMIT" ? Promise.reject(new Error("synthetic network loss")) : Promise.resolve({ rows: [], rowCount: 0 })) , release };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const database = new PostgresPersistenceDatabase(pool);
    await expect(database.transaction(async () => undefined)).rejects.toMatchObject({ code: "PERSISTENCE_COMMIT_AMBIGUOUS" });
    expect(release).toHaveBeenCalledWith(expect.any(Error));
  });
});
