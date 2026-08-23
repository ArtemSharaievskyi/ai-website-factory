import { checksumPersistedDocument } from "./serialization";
import { PersistenceError } from "./errors";
import type { DecisionRecord } from "@/domain/workflow/decision";

export interface ProjectMemorySyncPort {
  writeVersionSnapshot(projectId: string, projectVersion: number, documents: Record<string, unknown>): Promise<void>;
  appendDecision(projectId: string, projectVersion: number, decision: DecisionRecord): Promise<void>;
  verifyVersionSnapshot(projectId: string, projectVersion: number): Promise<boolean>;
  compareDatabaseAndFilesystemChecksums(databaseChecksums: Record<string, string>, filesystemChecksums: Record<string, string>): Promise<{ matches: boolean; mismatches: string[] }>;
}

export class FakeProjectMemorySyncPort implements ProjectMemorySyncPort {
  private readonly snapshots = new Map<string, Record<string, string>>();
  readonly decisions = new Map<string, DecisionRecord[]>();
  async writeVersionSnapshot(projectId: string, projectVersion: number, documents: Record<string, unknown>) { this.snapshots.set(`${projectId}:${projectVersion}`, Object.fromEntries(Object.entries(documents).map(([name, value]) => [name, checksumPersistedDocument(value)]))); }
  async appendDecision(projectId: string, projectVersion: number, decision: DecisionRecord) { const key = `${projectId}:${projectVersion}`; const records = this.decisions.get(key) ?? []; if (!records.some((existing) => existing.id === decision.id)) records.push(structuredClone(decision)); this.decisions.set(key, records); }
  async verifyVersionSnapshot(projectId: string, projectVersion: number) { if (!this.snapshots.has(`${projectId}:${projectVersion}`)) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project Memory snapshot was not found."); return true; }
  async compareDatabaseAndFilesystemChecksums(databaseChecksums: Record<string, string>, filesystemChecksums: Record<string, string>) { const names = new Set([...Object.keys(databaseChecksums), ...Object.keys(filesystemChecksums)]); const mismatches = [...names].filter((name) => databaseChecksums[name] !== filesystemChecksums[name]); return { matches: mismatches.length === 0, mismatches }; }
}
