import { describe, expect, it, vi } from "vitest";
import { AssetIntakeError } from "@/runtime/assets/service";

const mockIntake = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/runtime/workbench/production", () => ({
  getProductionAssetIntake: () => mockIntake,
}));

import { GET, POST } from "./route";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const asset = {
  schemaVersion: 1 as const,
  assetId: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000001",
  projectVersion: 1,
  category: "LOGO" as const,
  source: "USER_SUPPLIED" as const,
  safeDisplayName: "logo.png",
  mediaType: "image/png" as const,
  byteSize: png.byteLength,
  sha256: "a".repeat(64),
  storageIdentity: "projects/00000000-0000-4000-8000-000000000001/assets/00000000-0000-4000-8000-000000000002/png",
  status: "READY" as const,
  createdAt: "2026-08-14T12:00:00.000Z",
  updatedAt: "2026-08-14T12:00:00.000Z",
  version: 1,
  currentness: "CURRENT" as const,
};

const requestWith = (fields: { projectId?: string; category?: string; file?: File }) => {
  const form = new FormData();
  if (fields.projectId !== undefined) form.append("projectId", fields.projectId);
  if (fields.category !== undefined) form.append("category", fields.category);
  if (fields.file !== undefined) form.append("file", fields.file);
  return new Request("http://localhost/api/workbench/assets", { method: "POST", body: form });
};

const getRequest = (projectId: string) => new Request(`http://localhost/api/workbench/assets?projectId=${encodeURIComponent(projectId)}`);

describe("Asset Intake route diagnostics AER1-AER24 / AUP1-AUP36", () => {
  it("returns a typed empty collection for an existing authorized project with no assets", async () => {
    mockIntake.list.mockResolvedValueOnce([]);
    const response = await GET(getRequest(asset.projectId));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, assets: [] });
    expect(mockIntake.list).toHaveBeenCalledWith(asset.projectId);
  });

  it("returns bounded metadata for assets without exposing storage identity", async () => {
    mockIntake.list.mockResolvedValueOnce([asset]);
    const response = await GET(getRequest(asset.projectId));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, assets: [{ assetId: asset.assetId, projectId: asset.projectId, category: "LOGO", mediaType: "image/png", sha256: asset.sha256, status: "READY" }] });
    expect(body.assets[0]).not.toHaveProperty("storageIdentity");
    expect(body.assets[0]).not.toHaveProperty("createdAt");
  });

  it("rejects malformed project IDs without invoking the asset service", async () => {
    const response = await GET(getRequest("not-a-project"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "ASSET_REQUEST_INVALID" }, category: "VALIDATION", boundary: "REQUEST", reasonCode: "ASSET_REQUEST_INVALID", mutationReached: false });
    expect(mockIntake.list).not.toHaveBeenCalledWith("not-a-project");
  });

  it("preserves typed not-found and persistence outcomes for read failures", async () => {
    mockIntake.list.mockRejectedValueOnce(new AssetIntakeError("ASSET_PROJECT_NOT_FOUND", "The project was not found."));
    const missing = await GET(getRequest(asset.projectId));
    const missingBody = await missing.json();
    expect(missing.status).toBe(404);
    expect(missingBody).toMatchObject({ error: { code: "ASSET_PROJECT_NOT_FOUND" }, category: "VALIDATION", boundary: "PROJECT_ACCESS", reasonCode: "ASSET_PROJECT_NOT_FOUND", mutationReached: false });

    mockIntake.list.mockRejectedValueOnce(new AssetIntakeError("ASSET_METADATA_READ_FAILED", "private persistence detail"));
    const persistence = await GET(getRequest(asset.projectId));
    const persistenceBody = await persistence.json();
    expect(persistence.status).toBe(503);
    expect(persistenceBody).toMatchObject({ error: { code: "ASSET_METADATA_READ_FAILED" }, category: "PERSISTENCE", boundary: "PERSISTENCE", recoverable: true, mutationReached: false });
    expect(persistenceBody.safeErrorFingerprint).toMatch(/^AssetIntakeError@PREFLIGHT:[a-f0-9]{16}$/);
    expect(JSON.stringify(persistenceBody)).not.toContain("private persistence detail");
  });

  it("retains a safe fingerprint for an unexpected read failure", async () => {
    mockIntake.list.mockRejectedValueOnce(new Error("C:\\private\\vault\\secret.bin SQL stack"));
    const response = await GET(getRequest(asset.projectId));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: { code: "ASSET_INTERNAL_ERROR" }, category: "INTERNAL", boundary: "INTERNAL", reasonCode: "ASSET_INTERNAL_ERROR", mutationReached: false });
    expect(body.safeErrorFingerprint).toMatch(/^Error@PREFLIGHT:[a-f0-9]{16}$/);
    expect(JSON.stringify(body)).not.toContain("private");
    expect(JSON.stringify(body)).not.toContain("secret.bin");
    expect(JSON.stringify(body)).not.toContain("SQL");
  });

  it("AER1, AER7-AER10, AER24: accepts the exact multipart contract and projects a successful PNG", async () => {
    mockIntake.upload.mockResolvedValueOnce({ asset, deduplicated: false });
    const response = await POST(requestWith({
      projectId: asset.projectId,
      category: "LOGO",
      file: new File([png], "logo.png", { type: "image/png" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, asset: { status: "READY", category: "LOGO", source: "USER_SUPPLIED", mediaType: "image/png" }, deduplicated: false });
    expect(mockIntake.upload).toHaveBeenCalledWith({ projectId: asset.projectId, category: "LOGO", filename: "logo.png", mediaType: "image/png", bytes: expect.any(Uint8Array) });
  });

  it("AER3, AER18: reports request and category validation with a correlation ID", async () => {
    const response = await POST(requestWith({ projectId: asset.projectId, category: "NOT_A_CATEGORY" }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "ASSET_CATEGORY_INVALID" }, operation: "UPLOAD_PROJECT_ASSET", category: "VALIDATION", recoverable: false });
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("AER2, AER11-AER17: projects unknown and persistence failures without private details", async () => {
    mockIntake.upload.mockRejectedValueOnce(new Error("C:\\private\\vault\\secret.bin SQL stack"));
    const unknown = await POST(requestWith({ projectId: asset.projectId, category: "LOGO", file: new File([png], "logo.png", { type: "image/png" }) }));
    const unknownBody = await unknown.json();
    expect(unknown.status).toBe(500);
    expect(unknownBody).toMatchObject({ ok: false, error: { code: "ASSET_INTERNAL_ERROR" }, category: "INTERNAL", recoverable: false });
    expect(JSON.stringify(unknownBody)).not.toContain("private");
    expect(JSON.stringify(unknownBody)).not.toContain("secret.bin");
    expect(JSON.stringify(unknownBody)).not.toContain("SQL");

    mockIntake.upload.mockRejectedValueOnce(new AssetIntakeError("ASSET_METADATA_PERSIST_FAILED", "private persistence detail"));
    const persistence = await POST(requestWith({ projectId: asset.projectId, category: "LOGO", file: new File([png], "logo.png", { type: "image/png" }) }));
    const persistenceBody = await persistence.json();
    expect(persistence.status).toBe(503);
    expect(persistenceBody).toMatchObject({ error: { code: "ASSET_METADATA_PERSIST_FAILED" }, category: "PERSISTENCE", recoverable: true });
    expect(JSON.stringify(persistenceBody)).not.toContain("private persistence detail");
  });

  it("AER1, AER19-AER23: preserves typed validation, size, and signature failures", async () => {
    const cases = [
      ["ASSET_TYPE_NOT_ALLOWED", 400, "image/svg+xml", "logo.svg", new Uint8Array([60, 115, 118, 103])],
      ["ASSET_SIGNATURE_INVALID", 400, "image/png", "logo.png", new Uint8Array([1, 2, 3])],
      ["ASSET_SIZE_LIMIT", 413, "image/png", "logo.png", png],
    ] as const;
    for (const [code, status, type, name, bytes] of cases) {
      mockIntake.upload.mockRejectedValueOnce(new AssetIntakeError(code, "safe validation detail"));
      const response = await POST(requestWith({ projectId: asset.projectId, category: "LOGO", file: new File([bytes], name, { type }) }));
      const body = await response.json();
      expect(response.status).toBe(status);
      expect(body.error.code).toBe(code);
      expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
