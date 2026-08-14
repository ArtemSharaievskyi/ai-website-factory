import { describe, expect, it } from "vitest";
import { normalizeAssetRow } from "./postgres";

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
