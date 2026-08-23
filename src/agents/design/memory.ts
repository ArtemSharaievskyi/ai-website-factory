import type { DecisionRecord } from "@/domain/workflow/decision";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";
import type { DesignMemoryPort } from "./ports";

export class DesignMemoryAdapter implements DesignMemoryPort {
  constructor(private readonly sync: ProjectMemorySyncPort) {}
  async writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>) { await this.sync.writeVersionSnapshot(projectId, version, documents); }
  async removeDocument(projectId: string, version: number, documentName: string) { const candidate = this.sync as ProjectMemorySyncPort & { removeVersionDocument?: (projectId: string, version: number, documentName: string) => Promise<void> }; if (candidate.removeVersionDocument) await candidate.removeVersionDocument(projectId, version, documentName); }
  async appendDecision(projectId: string, version: number, decision: DecisionRecord) { await this.sync.appendDecision(projectId, version, decision); }
  async checksums(_projectId: string, version: number) { const candidate = this.sync as ProjectMemorySyncPort & { filesystemChecksums?: (version: number) => Promise<Record<string, string>> }; return candidate.filesystemChecksums ? candidate.filesystemChecksums(version) : {}; }
}
export class FakeDesignMemoryPort implements DesignMemoryPort {
  readonly documents = new Map<string, Record<string, unknown>>(); readonly decisions: DecisionRecord[] = [];
  async writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>) { const key = `${projectId}:${version}`; this.documents.set(key, { ...(this.documents.get(key) ?? {}), ...structuredClone(documents) }); }
  async removeDocument(projectId: string, version: number, documentName: string) { const documents = this.documents.get(`${projectId}:${version}`); if (documents) delete documents[documentName]; }
  async appendDecision(_projectId: string, _version: number, decision: DecisionRecord) { this.decisions.push(structuredClone(decision)); }
  async checksums(projectId: string, version: number) { const documents = this.documents.get(`${projectId}:${version}`) ?? {}; return Object.fromEntries(Object.entries(documents).map(([name, value]) => [name, checksumPersistedDocument(value)])); }
}
