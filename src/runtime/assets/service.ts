import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectAssetSchema, type ProjectAsset, type ProjectAssetCategory } from "@/domain/assets/project";
import { ProjectAssetRepository, ProjectRepository } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";

export const PROJECT_ASSET_LIMITS = {
  imageBytes: 10 * 1024 * 1024,
  pdfBytes: 20 * 1024 * 1024,
  projectBytes: 50 * 1024 * 1024,
} as const;

const EXTENSIONS: Record<ProjectAsset["mediaType"], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const safeReason = (reason: string) => reason.slice(0, 240);

export class AssetIntakeError extends Error {
  constructor(public readonly code: "ASSET_PROJECT_NOT_FOUND" | "ASSET_VERSION_STALE" | "ASSET_FILE_REQUIRED" | "ASSET_TYPE_NOT_ALLOWED" | "ASSET_EXTENSION_MISMATCH" | "ASSET_SIZE_LIMIT" | "ASSET_PROJECT_SIZE_LIMIT" | "ASSET_SIGNATURE_INVALID" | "ASSET_NOT_FOUND" | "ASSET_STORAGE_FAILED", message: string) {
    super(`${code}: ${message}`);
    this.name = "AssetIntakeError";
  }
}

export type AssetUploadInput = {
  projectId: string;
  category: ProjectAssetCategory;
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  replaceAssetId?: string;
};

export type AssetUploadResult = { asset: ProjectAsset; deduplicated: boolean };

const hasPrefix = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value);
const validSignature = (mediaType: ProjectAsset["mediaType"], bytes: Uint8Array) => {
  if (mediaType === "image/png") return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mediaType === "image/jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (mediaType === "image/webp") return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
};

const safeDisplayName = (filename: string) => {
  const base = filename.replaceAll("\\", "/").split("/").pop() ?? "upload";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^a-zA-Z0-9._()\- áéíóöőúüűÄÖÜẞß]/g, "_").trim().replace(/^[. ]+|[. ]+$/g, "");
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(clean) ? `file-${clean}` : clean;
  return (reserved || "upload").slice(0, 160);
};

export class ProjectAssetService {
  private readonly projects: ProjectRepository;
  private readonly assets: ProjectAssetRepository;
  private readonly root: string;

  constructor(input: { database: PersistenceDatabase; root: string }) {
    this.projects = new ProjectRepository(input.database);
    this.assets = new ProjectAssetRepository(input.database);
    this.root = path.resolve(input.root);
    if (this.root === path.parse(this.root).root) throw new Error("ASSET_ROOT_MUST_BE_PROJECT_SCOPED");
  }

  async list(projectId: string) {
    await this.requireProject(projectId);
    return this.assets.list(projectId);
  }

  async get(projectId: string, assetId: string) {
    await this.requireProject(projectId);
    const asset = await this.assets.get(projectId, assetId);
    if (!asset) throw new AssetIntakeError("ASSET_NOT_FOUND", "The asset was not found in this project.");
    return asset;
  }

  async listReferences(projectId: string) {
    return (await this.list(projectId)).filter((asset) => asset.status === "READY" && asset.currentness === "CURRENT").map((asset) => { const { storageIdentity, ...reference } = asset; void storageIdentity; return reference; });
  }

  async upload(input: AssetUploadInput): Promise<AssetUploadResult> {
    const current = await this.requireProject(input.projectId);
    const mediaType = input.mediaType as ProjectAsset["mediaType"];
    if (!(mediaType in EXTENSIONS)) throw new AssetIntakeError("ASSET_TYPE_NOT_ALLOWED", "Only PNG, JPEG, WebP, and PDF files are accepted.");
    if (!input.bytes.byteLength) throw new AssetIntakeError("ASSET_FILE_REQUIRED", "Choose a non-empty file.");
    const displayName = safeDisplayName(input.filename);
    const extension = displayName.toLowerCase().split(".").pop() ?? "";
    if (extension !== EXTENSIONS[mediaType] && !(mediaType === "image/jpeg" && extension === "jpeg")) throw new AssetIntakeError("ASSET_EXTENSION_MISMATCH", "The file extension does not match the declared media type.");
    const max = mediaType === "application/pdf" ? PROJECT_ASSET_LIMITS.pdfBytes : PROJECT_ASSET_LIMITS.imageBytes;
    if (input.bytes.byteLength > max) throw new AssetIntakeError("ASSET_SIZE_LIMIT", "The file exceeds the allowed size for its type.");
    if (!validSignature(mediaType, input.bytes)) throw new AssetIntakeError("ASSET_SIGNATURE_INVALID", "The file signature does not match the declared type.");
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const existing = await this.assets.list(input.projectId);
    const duplicate = existing.find((asset) => asset.status === "READY" && asset.currentness === "CURRENT" && asset.category === input.category && asset.mediaType === mediaType && asset.sha256 === sha256);
    if (duplicate) return { asset: duplicate, deduplicated: true };
    const replaced = input.replaceAssetId ? existing.find((asset) => asset.assetId === input.replaceAssetId && asset.status === "READY" && asset.currentness === "CURRENT") : undefined;
    if (input.replaceAssetId && !replaced) throw new AssetIntakeError("ASSET_NOT_FOUND", "The asset to replace was not found in this project.");
    const currentBytes = existing.filter((asset) => asset.status === "READY" && asset.currentness === "CURRENT").reduce((sum, asset) => sum + asset.byteSize, 0) - (replaced?.byteSize ?? 0);
    if (currentBytes + input.bytes.byteLength > PROJECT_ASSET_LIMITS.projectBytes) throw new AssetIntakeError("ASSET_PROJECT_SIZE_LIMIT", "The project asset storage limit would be exceeded.");
    const assetId = randomUUID();
    const storageIdentity = `projects/${input.projectId}/assets/${assetId}/${EXTENSIONS[mediaType]}`;
    const target = this.safePath(storageIdentity);
    const timestamp = new Date().toISOString();
    const uploading = ProjectAssetSchema.parse({ schemaVersion: 1, assetId, projectId: input.projectId, projectVersion: current.project.currentVersion, category: input.category, source: "USER_SUPPLIED", safeDisplayName: displayName, mediaType, byteSize: input.bytes.byteLength, sha256, storageIdentity, status: "UPLOADING", createdAt: timestamp, updatedAt: timestamp, version: (replaced?.version ?? 0) + 1, currentness: "CURRENT", ...(replaced ? { supersedesAssetId: replaced.assetId } : {}) });
    await this.assets.create(uploading);
    const temporary = `${target}.uploading-${randomUUID()}`;
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temporary, input.bytes, { flag: "wx" });
      await rename(temporary, target);
      const ready = ProjectAssetSchema.parse({ ...uploading, status: "READY", updatedAt: new Date().toISOString() });
      await this.assets.update(ready);
      if (replaced) {
        await this.assets.update(ProjectAssetSchema.parse({ ...replaced, status: "SUPERSEDED", currentness: "SUPERSEDED", updatedAt: new Date().toISOString() }));
        await rm(this.safePath(replaced.storageIdentity), { force: true }).catch(() => undefined);
      }
      return { asset: ready, deduplicated: false };
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      await rm(target, { force: true }).catch(() => undefined);
      await this.assets.update(ProjectAssetSchema.parse({ ...uploading, status: "REJECTED", currentness: "SUPERSEDED", rejectionReason: safeReason("The Factory could not persist the file."), updatedAt: new Date().toISOString() })).catch(() => undefined);
      if (error instanceof AssetIntakeError) throw error;
      throw new AssetIntakeError("ASSET_STORAGE_FAILED", "The Factory could not persist the file.");
    }
  }

  async remove(projectId: string, assetId: string) {
    await this.requireProject(projectId);
    const asset = await this.assets.get(projectId, assetId);
    if (!asset) throw new AssetIntakeError("ASSET_NOT_FOUND", "The asset was not found in this project.");
    const removed = ProjectAssetSchema.parse({ ...asset, status: "REMOVED", currentness: "SUPERSEDED", updatedAt: new Date().toISOString() });
    await this.assets.update(removed);
    await rm(this.safePath(asset.storageIdentity), { force: true }).catch(() => undefined);
    return removed;
  }

  private async requireProject(projectId: string) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new AssetIntakeError("ASSET_PROJECT_NOT_FOUND", "The project was not found.");
    return current;
  }

  private safePath(storageIdentity: string) {
    const target = path.resolve(this.root, ...storageIdentity.split("/"));
    const rootPrefix = `${this.root}${path.sep}`;
    if (!target.startsWith(rootPrefix)) throw new AssetIntakeError("ASSET_STORAGE_FAILED", "The asset storage target is invalid.");
    return target;
  }
}
