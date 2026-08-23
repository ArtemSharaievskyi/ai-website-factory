import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ProjectMemoryStore } from "@/persistence/project-memory/store";
import { CANONICAL_DOCUMENT_NAMES, type StructuredDocumentName } from "@/persistence/project-memory/filenames";
import { WorkspaceError } from "./errors";
import { resolveWorkspaceProjectRoot, versionDirectoryName } from "./schemas";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";
import type { DecisionRecord } from "@/domain/workflow/decision";

export class FilesystemProjectMemorySyncPort implements ProjectMemorySyncPort {
  private readonly projectRoot: string;
  constructor(workspaceRoot: string, slug: string) { this.projectRoot = resolveWorkspaceProjectRoot(workspaceRoot, slug); }
  private store(projectVersion: number) { return new ProjectMemoryStore(path.join(this.projectRoot, versionDirectoryName(projectVersion), ".factory")); }
  async writeVersionSnapshot(_projectId: string, projectVersion: number, documents: Record<string, unknown>) {
    const store = await this.store(projectVersion).initialize();
    try {
      for (const [name, value] of Object.entries(documents)) {
        if (name === "original-prompt.md") { await store.writeOriginalPrompt(String(value)); continue; }
        if (!CANONICAL_DOCUMENT_NAMES.includes(name as typeof CANONICAL_DOCUMENT_NAMES[number]) || name === "manifest.json" || name === "decisions.jsonl") throw new WorkspaceError("MEMORY_SYNC_SCHEMA_MISMATCH", "Unsupported Project Memory document.");
        await store.writeDocument(name as StructuredDocumentName, value);
      }
    } catch (error) { if (error instanceof WorkspaceError) throw error; throw new WorkspaceError("MEMORY_SYNC_SCHEMA_MISMATCH", "Project Memory snapshot validation failed.", undefined, error); }
  }
  async appendDecision(_projectId: string, projectVersion: number, decision: DecisionRecord) { const store = await this.store(projectVersion).initialize(); await store.appendDecision(decision); }
  async verifyVersionSnapshot(_projectId: string, projectVersion: number) { try { return await this.store(projectVersion).verifyIntegrity(); } catch (error) { throw new WorkspaceError("MEMORY_SYNC_DOCUMENT_MISSING", "Project Memory integrity verification failed.", undefined, error); } }
  async compareDatabaseAndFilesystemChecksums(databaseChecksums: Record<string, string>, filesystemChecksums: Record<string, string>) { const names = new Set([...Object.keys(databaseChecksums), ...Object.keys(filesystemChecksums)]); const mismatches = [...names].filter((name) => databaseChecksums[name] !== filesystemChecksums[name]); return { matches: mismatches.length === 0, mismatches }; }
  async filesystemChecksums(projectVersion: number) { const manifest = await this.store(projectVersion).readDocument("manifest.json"); return Object.fromEntries(manifest.documents.map((entry) => [entry.relativePath, entry.sha256])); }
  async removeVersionDocument(_projectId: string, projectVersion: number, documentName: string) { if (documentName !== "selected-design.json") throw new WorkspaceError("MEMORY_SYNC_SCHEMA_MISMATCH", "Only the selected design may be invalidated by the Design Agent."); const store = await this.store(projectVersion).initialize(); await rm(path.join(store.root, documentName), { force: true }); await store.rebuildManifest(); }
  async readOriginalPrompt(projectVersion: number) { return readFile(path.join(this.projectRoot, versionDirectoryName(projectVersion), ".factory", "original-prompt.md"), "utf8"); }
}
