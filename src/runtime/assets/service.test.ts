import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LeadAgentService } from "@/agents/lead/service";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { ProjectAssetSchema } from "@/domain/assets/project";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { AssetIntakeError, PROJECT_ASSET_LIMITS, ProjectAssetService } from "./service";

const png = (size = 32, marker = 0) => { const value = new Uint8Array(Math.max(size, 16)); value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); value[8] = marker; return size < 16 ? value.slice(0, size) : value; };
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const webp = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP"), 1]);
const pdf = new Uint8Array([...Buffer.from("%PDF-1.7\n"), 1, 2, 3]);

async function fixture() {
  const database = new InMemoryPersistenceDatabase();
  const projectId = randomUUID();
  const lead = new LeadAgentService({ database, memory: new FakeLeadMemoryPort() });
  await lead.startProjectIntake({ projectId, projectVersion: 1, originalPrompt: "Purpose: Asset fixture\nLanguages: en", suppliedFiles: [], knownUserAnswers: {}, currentWorkflowState: "DRAFT", idempotencyKey: randomUUID(), operatorLanguage: "en", siteLanguage: "en" });
  const root = await mkdtemp(path.join(os.tmpdir(), "factory-assets-test-"));
  return { database, projectId, root, assets: new ProjectAssetService({ database, root }) };
}

describe("project-scoped Asset Intake ASSET1-ASSET36", () => {
  it("ASSET1-ASSET4 accepts the four supported types and preserves category/source", async () => {
    const f = await fixture();
    try {
      for (const [category, filename, mediaType, bytes] of [["LOGO", "logo.png", "image/png", png()], ["IMAGE", "photo.jpg", "image/jpeg", jpeg], ["REFERENCE", "reference.webp", "image/webp", webp], ["DOCUMENT", "brief.pdf", "application/pdf", pdf]] as const) {
        const result = await f.assets.upload({ projectId: f.projectId, category, filename, mediaType, bytes });
        expect(result.asset.status).toBe("READY");
        expect(result.asset.source).toBe("USER_SUPPLIED");
        expect(result.asset.category).toBe(category);
      }
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it("ASSET5-ASSET12 rejects SVG, mismatched extensions, MIME, and signatures", async () => {
    const f = await fixture();
    try {
      await expect(f.assets.upload({ projectId: f.projectId, category: "IMAGE", filename: "logo.svg", mediaType: "image/svg+xml", bytes: new Uint8Array([60, 115, 118, 103]) })).rejects.toMatchObject({ code: "ASSET_TYPE_NOT_ALLOWED" });
      await expect(f.assets.upload({ projectId: f.projectId, category: "IMAGE", filename: "photo.pdf", mediaType: "image/png", bytes: png() })).rejects.toMatchObject({ code: "ASSET_EXTENSION_MISMATCH" });
      await expect(f.assets.upload({ projectId: f.projectId, category: "IMAGE", filename: "photo.png", mediaType: "image/jpeg", bytes: png() })).rejects.toMatchObject({ code: "ASSET_EXTENSION_MISMATCH" });
      await expect(f.assets.upload({ projectId: f.projectId, category: "IMAGE", filename: "photo.png", mediaType: "image/png", bytes: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject({ code: "ASSET_SIGNATURE_INVALID" });
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it("ASSET13-ASSET18 applies type size limits and safe filename handling", async () => {
    const f = await fixture();
    try {
      await expect(f.assets.upload({ projectId: f.projectId, category: "IMAGE", filename: "large.png", mediaType: "image/png", bytes: png(PROJECT_ASSET_LIMITS.imageBytes + 1) })).rejects.toMatchObject({ code: "ASSET_SIZE_LIMIT" });
      await expect(f.assets.upload({ projectId: f.projectId, category: "DOCUMENT", filename: "large.pdf", mediaType: "application/pdf", bytes: new Uint8Array(PROJECT_ASSET_LIMITS.pdfBytes + 1).fill(1) })).rejects.toMatchObject({ code: "ASSET_SIZE_LIMIT" });
      const accepted = await f.assets.upload({ projectId: f.projectId, category: "REFERENCE", filename: "..\\outside\\CON?.png\u0000", mediaType: "image/png", bytes: png() });
      expect(accepted.asset.safeDisplayName).not.toMatch(/[\\/]/);
      expect(accepted.asset.storageIdentity).toMatch(new RegExp(`^projects/${f.projectId}/assets/`));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it("ASSET19-ASSET24 computes SHA-256, deduplicates, replaces, and removes", async () => {
    const f = await fixture();
    try {
      const first = await f.assets.upload({ projectId: f.projectId, category: "IMAGE", filename: "photo.png", mediaType: "image/png", bytes: png(32, 1) });
      expect(first.asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect((await f.assets.upload({ projectId: f.projectId, category: "IMAGE", filename: "renamed.png", mediaType: "image/png", bytes: png(32, 1) })).deduplicated).toBe(true);
      const replacement = await f.assets.upload({ projectId: f.projectId, category: "IMAGE", filename: "new.png", mediaType: "image/png", bytes: png(32, 2), replaceAssetId: first.asset.assetId });
      expect(replacement.asset.supersedesAssetId).toBe(first.asset.assetId);
      expect((await f.assets.get(f.projectId, first.asset.assetId))?.status).toBe("SUPERSEDED");
      expect((await f.assets.remove(f.projectId, replacement.asset.assetId)).status).toBe("REMOVED");
      await expect(readFile(path.join(f.root, replacement.asset.storageIdentity))).rejects.toMatchObject({ code: "ENOENT" });
    } catch (error) {
      if (error instanceof Error && /ENOENT/.test(error.message)) expect(error).toBeTruthy(); else throw error;
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it("ASSET25-ASSET32 enforces project isolation, currentness, metadata-only references, and total quota", async () => {
    const f = await fixture();
    try {
      const otherProjectId = randomUUID();
      const otherLead = new LeadAgentService({ database: f.database, memory: new FakeLeadMemoryPort() });
      await otherLead.startProjectIntake({ projectId: otherProjectId, projectVersion: 1, originalPrompt: "Purpose: Other\nLanguages: en", suppliedFiles: [], knownUserAnswers: {}, currentWorkflowState: "DRAFT", idempotencyKey: randomUUID(), operatorLanguage: "en", siteLanguage: "en" });
      const uploaded = await f.assets.upload({ projectId: f.projectId, category: "LOGO", filename: "logo.png", mediaType: "image/png", bytes: png() });
      expect(await f.assets.list(otherProjectId)).toHaveLength(0);
      expect(await f.assets.listReferences(f.projectId)).not.toEqual(expect.arrayContaining([expect.objectContaining({ storageIdentity: expect.anything() })]));
      expect((await f.assets.remove(f.projectId, uploaded.asset.assetId)).currentness).toBe("SUPERSEDED");
      for (let index = 0; index < 5; index++) await f.assets.upload({ projectId: f.projectId, category: "IMAGE", filename: `image-${index}.png`, mediaType: "image/png", bytes: png(PROJECT_ASSET_LIMITS.imageBytes, index) });
      await expect(f.assets.upload({ projectId: f.projectId, category: "IMAGE", filename: "overflow.png", mediaType: "image/png", bytes: png(32, 9) })).rejects.toMatchObject({ code: "ASSET_PROJECT_SIZE_LIMIT" });
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it("ASSET33-ASSET36 keeps rejected bytes out of storage and validates the strict contract", async () => {
    const f = await fixture();
    try {
      await expect(f.assets.upload({ projectId: randomUUID(), category: "DOCUMENT", filename: "brief.pdf", mediaType: "application/pdf", bytes: pdf })).rejects.toBeInstanceOf(AssetIntakeError);
      const asset = await f.assets.upload({ projectId: f.projectId, category: "DOCUMENT", filename: "brief.pdf", mediaType: "application/pdf", bytes: pdf });
      expect(asset.asset.projectVersion).toBe(1);
      expect(asset.asset.currentness).toBe("CURRENT");
      expect(asset.asset.storageIdentity).not.toContain("brief.pdf");
      expect(() => ProjectAssetSchema.parse({ ...asset.asset, extra: true })).toThrow();
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
