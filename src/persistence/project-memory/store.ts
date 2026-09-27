import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { readDirectory } from "@/runtime/filesystem/directory";
import path from "node:path";
import { z } from "zod";
import { DecisionRecordSchema, type DecisionRecord } from "@/domain/workflow/decision";
import { DomainError } from "@/domain/shared/errors";
import { SCHEMA_VERSION } from "@/domain/shared/schemas";
import { CANONICAL_DOCUMENT_NAMES, DOCUMENT_SCHEMA_VERSIONS, DOCUMENT_SCHEMAS, ProjectMemoryManifestSchema, REQUIRED_DOCUMENTS, type ProjectMemoryManifest, type StructuredDocumentName } from "./filenames";

const JSONL_NAME = "decisions.jsonl";
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

const toJson = (data: unknown) => `${JSON.stringify(stableValue(data), null, 2)}\n`;
const checksum = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const now = () => new Date().toISOString();

export class ProjectMemoryStore {
  readonly root: string;
  private readonly hooks?: { beforeManifestRename?: () => Promise<void> };
  constructor(rootDirectory: string, hooks?: { beforeManifestRename?: () => Promise<void> }) { this.root = path.resolve(/* turbopackIgnore: true */ rootDirectory); this.hooks = hooks; }

  private safeName(name: string) {
    const normalized = name.replaceAll("\\", "/");
    if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:[\\/]/.test(normalized)) throw new DomainError("ABSOLUTE_PATH_REJECTED", "Absolute document paths are not allowed.");
    if (normalized.split("/").includes("..") || normalized.includes(":") || normalized.includes("\0")) throw new DomainError("PATH_TRAVERSAL_REJECTED", "Document path traversal is not allowed.");
    if (!CANONICAL_DOCUMENT_NAMES.includes(normalized as typeof CANONICAL_DOCUMENT_NAMES[number]) && normalized !== "original-prompt.md") throw new DomainError("DOCUMENT_UNKNOWN", "Unknown Project Memory document.");
    return normalized;
  }

  private file(name: string) { const safe = this.safeName(name); const candidate = path.resolve(/* turbopackIgnore: true */ this.root, safe); if (candidate !== this.root && !candidate.startsWith(`${this.root}${path.sep}`)) throw new DomainError("PATH_TRAVERSAL_REJECTED", "Document path escapes Project Memory."); return candidate; }

  private async ensureSafeRoot() {
    await mkdir(/* turbopackIgnore: true */ this.root, { recursive: true });
    const rootStat = await stat(/* turbopackIgnore: true */ this.root);
    if (!rootStat.isDirectory()) throw new DomainError("PATH_TRAVERSAL_REJECTED", "Project Memory root is not a directory.");
  }

  async initialize() { await this.ensureSafeRoot(); return this; }

  private async assertMutable() {
    try {
      const project = JSON.parse(await readFile(/* turbopackIgnore: true */ this.file("project.json"), "utf8")) as { workflowState?: string };
      if (project.workflowState === "PROJECT_READY") throw new DomainError("PROJECT_VERSION_IMMUTABLE", "Released Project Memory is immutable.");
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new DomainError("VALIDATION_FAILED", "Project Memory state could not be read.", undefined, error);
    }
  }

  private async atomicWrite(name: string, bytes: Buffer) {
    await this.ensureSafeRoot();
    const target = this.file(name); const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try { if ((await lstat(/* turbopackIgnore: true */ target)).isSymbolicLink()) throw new DomainError("PATH_TRAVERSAL_REJECTED", "Symbolic-link document paths are not allowed."); } catch (error) { if (error instanceof DomainError) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    let previous: Buffer | undefined;
    try { previous = await readFile(/* turbopackIgnore: true */ target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await writeFile(/* turbopackIgnore: true */ temp, bytes, { flag: "wx", mode: 0o600 });
    const handle = await open(/* turbopackIgnore: true */ temp, constants.O_RDWR); try { await handle.sync(); } finally { await handle.close(); }
    try { await rename(/* turbopackIgnore: true */ temp, target); } catch (error) { await rm(/* turbopackIgnore: true */ temp, { force: true }); throw new DomainError("VALIDATION_FAILED", "Atomic Project Memory write failed.", undefined, error); }
    if (previous) return previous;
    return undefined;
  }

  private async readManifest(): Promise<ProjectMemoryManifest | undefined> {
    try { const value = JSON.parse(await readFile(/* turbopackIgnore: true */ this.file("manifest.json"), "utf8")); return ProjectMemoryManifestSchema.parse(value); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; if (error instanceof z.ZodError) throw new DomainError("VALIDATION_FAILED", "Project Memory manifest is invalid."); throw error; }
  }

  private async rebuildManifestInternal() {
    const entries: ProjectMemoryManifest["documents"] = [];
    for (const name of REQUIRED_DOCUMENTS) {
      try { const bytes = await readFile(/* turbopackIgnore: true */ this.file(name)); const info = await stat(/* turbopackIgnore: true */ this.file(name)); let documentType = "decisions"; if (name === "original-prompt.md") documentType = "original-prompt"; else if (name !== JSONL_NAME) documentType = this.parse(name, JSON.parse(bytes.toString("utf8"))).documentType; entries.push({ relativePath: name, documentType, schemaVersion: SCHEMA_VERSION, sha256: checksum(bytes), byteSize: info.size, updatedAt: info.mtime.toISOString() }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const baseEntry = entries.find((entry) => entry.relativePath !== "original-prompt.md" && entry.relativePath !== JSONL_NAME);
    const base = baseEntry ? await this.readDocumentBase(baseEntry.relativePath) : undefined;
    const manifest = { schemaVersion: SCHEMA_VERSION, documentType: "manifest" as const, projectId: base?.projectId ?? "00000000-0000-0000-0000-000000000000", projectVersion: base?.projectVersion ?? 1, createdAt: base?.createdAt ?? now(), updatedAt: now(), documents: entries };
    ProjectMemoryManifestSchema.parse(manifest);
    if (this.hooks?.beforeManifestRename) await this.hooks.beforeManifestRename();
    await this.atomicWrite("manifest.json", Buffer.from(toJson(manifest), "utf8"));
    return manifest;
  }

  private parse(name: string, value: unknown) { const schema = DOCUMENT_SCHEMAS[name as StructuredDocumentName]; if (!schema) throw new DomainError("DOCUMENT_UNKNOWN", "Unknown Project Memory document."); try { return schema.parse(value); } catch (error) { if (error instanceof z.ZodError) throw new DomainError("VALIDATION_FAILED", `Invalid ${name} document.`); throw error; } }
  private async readDocumentBase(name: string) { const value = await this.readDocument(name as StructuredDocumentName); return { projectId: value.projectId, projectVersion: value.projectVersion, createdAt: value.createdAt }; }

  async writeDocument<T extends StructuredDocumentName>(name: T, data: unknown) {
    await this.assertMutable(); const parsed = this.parse(name, data); const previousManifest = await this.readManifest();
    const previous = await this.atomicWrite(name, Buffer.from(toJson(parsed), "utf8"));
    try { await this.rebuildManifestInternal(); } catch (error) { if (previous) await writeFile(/* turbopackIgnore: true */ this.file(name), previous, { mode: 0o600 }); else await rm(/* turbopackIgnore: true */ this.file(name), { force: true }); if (previousManifest) await this.atomicWrite("manifest.json", Buffer.from(toJson(previousManifest), "utf8")); throw error; }
    return parsed as z.infer<(typeof DOCUMENT_SCHEMAS)[T]>;
  }

  async writeOriginalPrompt(prompt: string) {
    await this.assertMutable();
    if (typeof prompt !== "string") throw new DomainError("VALIDATION_FAILED", "Original prompt must be text.");
    const normalized = prompt.replace(/\r\n?/g, "\n");
    const previousManifest = await this.readManifest();
    let previous: Buffer | undefined;
    try { previous = await readFile(/* turbopackIgnore: true */ this.file("original-prompt.md")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await this.atomicWrite("original-prompt.md", Buffer.from(normalized, "utf8"));
    try { await this.rebuildManifestInternal(); } catch (error) {
      if (previous) await this.atomicWrite("original-prompt.md", previous); else await rm(/* turbopackIgnore: true */ this.file("original-prompt.md"), { force: true });
      if (previousManifest) await this.atomicWrite("manifest.json", Buffer.from(toJson(previousManifest), "utf8"));
      throw error;
    }
    return normalized;
  }

  async readDocument<T extends StructuredDocumentName>(name: T): Promise<z.infer<(typeof DOCUMENT_SCHEMAS)[T]>> {
    try { const value = JSON.parse(await readFile(/* turbopackIgnore: true */ this.file(name), "utf8")); const expectedSchemaVersion = DOCUMENT_SCHEMA_VERSIONS[name] ?? SCHEMA_VERSION; if (value?.schemaVersion !== expectedSchemaVersion) throw new DomainError("SCHEMA_VERSION_MISMATCH", "Project Memory schema version is unsupported."); const parsed = this.parse(name, value); return parsed as z.infer<(typeof DOCUMENT_SCHEMAS)[T]>; } catch (error) { if (error instanceof DomainError) throw error; if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DomainError("DOCUMENT_NOT_FOUND", "Project Memory document was not found."); throw new DomainError("VALIDATION_FAILED", "Project Memory document could not be read.", undefined, error); }
  }

  async appendDecision(record: DecisionRecord) {
    await this.assertMutable();
    let parsed: DecisionRecord;
    try { parsed = DecisionRecordSchema.parse(record); } catch (error) { if (error instanceof z.ZodError) throw new DomainError("VALIDATION_FAILED", "Invalid decision record.", undefined, error); throw error; }
    const previousManifest = await this.readManifest();
    let previous: Buffer | undefined;
    try { previous = await readFile(/* turbopackIgnore: true */ this.file(JSONL_NAME)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (previous) {
      const existing = previous.toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => { try { return DecisionRecordSchema.parse(JSON.parse(line)); } catch { return undefined; } }).find((candidate) => candidate?.id === parsed.id);
      if (existing) return existing;
    }
    const bytes = Buffer.from(`${JSON.stringify(stableValue(parsed))}\n`, "utf8");
    await this.atomicWrite(JSONL_NAME, Buffer.concat([previous ?? Buffer.alloc(0), bytes]));
    try { await this.rebuildManifestInternal(); } catch (error) {
      if (previous) await this.atomicWrite(JSONL_NAME, previous); else await rm(/* turbopackIgnore: true */ this.file(JSONL_NAME), { force: true });
      if (previousManifest) await this.atomicWrite("manifest.json", Buffer.from(toJson(previousManifest), "utf8"));
      throw error;
    }
    return parsed;
  }
  async rebuildManifest() { await this.assertMutable(); return this.rebuildManifestInternal(); }
  async listAvailableDocuments() { await this.ensureSafeRoot(); return (await readDirectory(/* turbopackIgnore: true */ this.root)).map((entry) => entry.name).filter((name) => name.endsWith(".json") || name.endsWith(".jsonl") || name === "original-prompt.md"); }
  async detectMissingRequiredDocuments() { const available = new Set(await this.listAvailableDocuments()); return REQUIRED_DOCUMENTS.filter((name) => !available.has(name)); }
  async detectUnknownCanonicalDocuments() { const available = await this.listAvailableDocuments(); return available.filter((name) => (name.endsWith(".json") || name.endsWith(".jsonl") || name === "original-prompt.md") && !CANONICAL_DOCUMENT_NAMES.includes(name as typeof CANONICAL_DOCUMENT_NAMES[number])); }
  async verifyIntegrity() {
    const manifest = await this.readDocument("manifest.json"); const failures: string[] = [];
    for (const entry of manifest.documents) { try { const bytes = await readFile(/* turbopackIgnore: true */ this.file(entry.relativePath)); if (checksum(bytes) !== entry.sha256) failures.push(entry.relativePath); } catch { failures.push(entry.relativePath); } }
    if (failures.length) throw new DomainError("INTEGRITY_CHECK_FAILED", "Project Memory integrity verification failed.", { documents: failures.join(",") });
    return true;
  }
}
