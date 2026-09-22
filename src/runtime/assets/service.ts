import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectAssetReferenceSchema, ProjectAssetSchema, type ProjectAsset, type ProjectAssetCategory, type ProjectAssetReference } from "@/domain/assets/project";
import { ProjectAssetRepository, ProjectRepository } from "@/persistence/database/repositories";
import { PersistenceError } from "@/persistence/database/errors";
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

export type AssetIntakeErrorCategory = "VALIDATION" | "STORAGE" | "PERSISTENCE" | "INTERNAL";
export type AssetIntakeErrorCode =
  | "ASSET_REQUEST_INVALID"
  | "ASSET_REQUEST_TOO_LARGE"
  | "ASSET_CATEGORY_INVALID"
  | "ASSET_PROJECT_NOT_FOUND"
  | "ASSET_VERSION_STALE"
  | "ASSET_FILE_REQUIRED"
  | "ASSET_TYPE_NOT_ALLOWED"
  | "ASSET_MIME_MISMATCH"
  | "ASSET_EXTENSION_MISMATCH"
  | "ASSET_SIZE_LIMIT"
  | "ASSET_PROJECT_SIZE_LIMIT"
  | "ASSET_SIGNATURE_INVALID"
  | "ASSET_NOT_FOUND"
  | "ASSET_BINDING_INVALID"
  | "ASSET_CHECKSUM_MISMATCH"
  | "ASSET_NOT_CURRENT"
  | "ASSET_STORAGE_FAILED"
  | "ASSET_METADATA_PERSIST_FAILED"
  | "ASSET_INTERNAL_ERROR";

const ASSET_ERROR_DEFAULTS: Record<AssetIntakeErrorCode, { category: AssetIntakeErrorCategory; recoverable: boolean }> = {
  ASSET_REQUEST_INVALID: { category: "VALIDATION", recoverable: false },
  ASSET_REQUEST_TOO_LARGE: { category: "VALIDATION", recoverable: false },
  ASSET_CATEGORY_INVALID: { category: "VALIDATION", recoverable: false },
  ASSET_PROJECT_NOT_FOUND: { category: "VALIDATION", recoverable: false },
  ASSET_VERSION_STALE: { category: "VALIDATION", recoverable: true },
  ASSET_FILE_REQUIRED: { category: "VALIDATION", recoverable: false },
  ASSET_TYPE_NOT_ALLOWED: { category: "VALIDATION", recoverable: false },
  ASSET_MIME_MISMATCH: { category: "VALIDATION", recoverable: false },
  ASSET_EXTENSION_MISMATCH: { category: "VALIDATION", recoverable: false },
  ASSET_SIZE_LIMIT: { category: "VALIDATION", recoverable: false },
  ASSET_PROJECT_SIZE_LIMIT: { category: "VALIDATION", recoverable: false },
  ASSET_SIGNATURE_INVALID: { category: "VALIDATION", recoverable: false },
  ASSET_NOT_FOUND: { category: "VALIDATION", recoverable: false },
  ASSET_BINDING_INVALID: { category: "VALIDATION", recoverable: false },
  ASSET_CHECKSUM_MISMATCH: { category: "VALIDATION", recoverable: true },
  ASSET_NOT_CURRENT: { category: "VALIDATION", recoverable: true },
  ASSET_STORAGE_FAILED: { category: "STORAGE", recoverable: true },
  ASSET_METADATA_PERSIST_FAILED: { category: "PERSISTENCE", recoverable: true },
  ASSET_INTERNAL_ERROR: { category: "INTERNAL", recoverable: false },
};

export class AssetIntakeError extends Error {
  readonly category: AssetIntakeErrorCategory;
  readonly recoverable: boolean;

  constructor(public readonly code: AssetIntakeErrorCode, message: string, options: Partial<{ category: AssetIntakeErrorCategory; recoverable: boolean }> = {}) {
    super(`${code}: ${message}`);
    this.name = "AssetIntakeError";
    const defaults = ASSET_ERROR_DEFAULTS[code];
    this.category = options.category ?? defaults.category;
    this.recoverable = options.recoverable ?? defaults.recoverable;
  }
}

const metadataPersistenceFailure = () => new AssetIntakeError("ASSET_METADATA_PERSIST_FAILED", "The asset metadata could not be saved.");

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
    try {
      return await this.assets.list(projectId);
    } catch (error) {
      if (error instanceof PersistenceError) throw metadataPersistenceFailure();
      throw error;
    }
  }

  async get(projectId: string, assetId: string) {
    await this.requireProject(projectId);
    let asset: ProjectAsset | null;
    try {
      asset = await this.assets.get(projectId, assetId);
    } catch (error) {
      if (error instanceof PersistenceError) throw metadataPersistenceFailure();
      throw error;
    }
    if (!asset) throw new AssetIntakeError("ASSET_NOT_FOUND", "The asset was not found in this project.");
    return asset;
  }

  async listCurrentReadyReferences(projectId: string): Promise<ProjectAssetReference[]> {
    return (await this.list(projectId))
      .filter((asset) => asset.status === "READY" && asset.currentness === "CURRENT")
      .map((asset) => {
        const { schemaVersion, storageIdentity, createdAt, updatedAt, supersedesAssetId, rejectionReason, ...reference } = asset;
        void schemaVersion;
        void storageIdentity;
        void createdAt;
        void updatedAt;
        void supersedesAssetId;
        void rejectionReason;
        return ProjectAssetReferenceSchema.parse(reference);
      });
  }

  /** Backward-compatible name for the canonical current READY Lead context projection. */
  async listReferences(projectId: string) {
    return this.listCurrentReadyReferences(projectId);
  }

  async validateBriefRevisionBindings(projectId: string, projectVersion: number, bindings: readonly { target: "ASSET_COMPANY_LOGO"; assetId: string; sha256: string }[]) {
    const seenTargets = new Set<string>();
    return Promise.all(bindings.map(async (binding) => {
      if (seenTargets.has(binding.target)) throw new AssetIntakeError("ASSET_BINDING_INVALID", "Each canonical asset target may be bound only once.");
      seenTargets.add(binding.target);
      const asset = await this.get(projectId, binding.assetId);
      if (asset.projectVersion !== projectVersion) throw new AssetIntakeError("ASSET_VERSION_STALE", "The asset belongs to a different project version.");
      if (asset.status !== "READY" || asset.currentness !== "CURRENT") throw new AssetIntakeError("ASSET_NOT_CURRENT", "The asset is not a current ready asset.");
      if (asset.sha256 !== binding.sha256) throw new AssetIntakeError("ASSET_CHECKSUM_MISMATCH", "The asset checksum does not match the bound asset.");
      if (binding.target === "ASSET_COMPANY_LOGO" && asset.category !== "LOGO") throw new AssetIntakeError("ASSET_CATEGORY_INVALID", "The company logo target requires a logo asset.");
      return {
        sourceRef: `asset:${asset.assetId}`,
        content: JSON.stringify({ assetId: asset.assetId, target: binding.target, category: asset.category, source: asset.source, mediaType: asset.mediaType, byteSize: asset.byteSize, sha256: asset.sha256, version: asset.version, currentness: asset.currentness }),
        selectionReason: "Host-validated project-owned customer asset metadata.",
        priority: "HIGH" as const,
      };
    }));
  }

  async upload(input: AssetUploadInput): Promise<AssetUploadResult> {
    const current = await this.requireProject(input.projectId);
    const mediaType = input.mediaType as ProjectAsset["mediaType"];
    if (!Object.prototype.hasOwnProperty.call(EXTENSIONS, mediaType)) throw new AssetIntakeError("ASSET_TYPE_NOT_ALLOWED", "Only PNG, JPEG, WebP, and PDF files are accepted.");
    if (!input.bytes.byteLength) throw new AssetIntakeError("ASSET_FILE_REQUIRED", "Choose a non-empty file.");
    const displayName = safeDisplayName(input.filename);
    const extension = displayName.toLowerCase().split(".").pop() ?? "";
    if (extension !== EXTENSIONS[mediaType] && !(mediaType === "image/jpeg" && extension === "jpeg")) throw new AssetIntakeError("ASSET_EXTENSION_MISMATCH", "The file extension does not match the declared media type.");
    const max = mediaType === "application/pdf" ? PROJECT_ASSET_LIMITS.pdfBytes : PROJECT_ASSET_LIMITS.imageBytes;
    if (input.bytes.byteLength > max) throw new AssetIntakeError("ASSET_SIZE_LIMIT", "The file exceeds the allowed size for its type.");
    if (!validSignature(mediaType, input.bytes)) throw new AssetIntakeError("ASSET_SIGNATURE_INVALID", "The file signature does not match the declared type.");
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    let existing: ProjectAsset[];
    try {
      existing = await this.assets.list(input.projectId);
    } catch (error) {
      if (error instanceof PersistenceError) throw metadataPersistenceFailure();
      throw error;
    }
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
    try {
      await this.assets.create(uploading);
    } catch (error) {
      if (error instanceof PersistenceError) throw metadataPersistenceFailure();
      throw error;
    }
    const temporary = `${target}.uploading-${randomUUID()}`;
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temporary, input.bytes, { flag: "wx" });
      await rename(temporary, target);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      await rm(target, { force: true }).catch(() => undefined);
      await this.assets.delete(uploading.projectId, uploading.assetId).catch(() => undefined);
      throw new AssetIntakeError("ASSET_STORAGE_FAILED", "The Factory could not persist the file.");
    }
    const ready = ProjectAssetSchema.parse({ ...uploading, status: "READY", updatedAt: new Date().toISOString() });
    try {
      await this.assets.update(ready);
      if (replaced) {
        await this.assets.update(ProjectAssetSchema.parse({ ...replaced, status: "SUPERSEDED", currentness: "SUPERSEDED", updatedAt: new Date().toISOString() }));
        await rm(this.safePath(replaced.storageIdentity), { force: true }).catch(() => undefined);
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      await rm(target, { force: true }).catch(() => undefined);
      await this.assets.delete(uploading.projectId, uploading.assetId).catch(() => undefined);
      if (error instanceof PersistenceError) throw metadataPersistenceFailure();
      throw new AssetIntakeError("ASSET_INTERNAL_ERROR", "The asset could not be finalized.");
    }
    return { asset: ready, deduplicated: false };
  }

  async remove(projectId: string, assetId: string) {
    await this.requireProject(projectId);
    let asset: ProjectAsset | null;
    try {
      asset = await this.assets.get(projectId, assetId);
    } catch (error) {
      if (error instanceof PersistenceError) throw metadataPersistenceFailure();
      throw error;
    }
    if (!asset) throw new AssetIntakeError("ASSET_NOT_FOUND", "The asset was not found in this project.");
    const removed = ProjectAssetSchema.parse({ ...asset, status: "REMOVED", currentness: "SUPERSEDED", updatedAt: new Date().toISOString() });
    try {
      await this.assets.update(removed);
    } catch (error) {
      if (error instanceof PersistenceError) throw metadataPersistenceFailure();
      throw error;
    }
    await rm(this.safePath(asset.storageIdentity), { force: true }).catch(() => undefined);
    return removed;
  }

  private async requireProject(projectId: string) {
    let current: Awaited<ReturnType<ProjectRepository["getWithVersion"]>>;
    try {
      current = await this.projects.getWithVersion(projectId);
    } catch (error) {
      if (error instanceof PersistenceError) throw metadataPersistenceFailure();
      throw error;
    }
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
