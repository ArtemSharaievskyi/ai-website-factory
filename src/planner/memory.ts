import path from "node:path";
import type { DecisionRecord } from "../domain/workflow/decision";
import type { ProjectMemorySyncPort } from "../persistence/sync";
import { checksumPersistedDocument } from "../persistence/serialization";
import type { PlannerMemoryPort } from "./ports";
import { ProjectMemoryStore } from "../project-memory/store";
import { versionDirectoryName } from "../workspace/schemas";
export class PlannerMemoryAdapter implements PlannerMemoryPort {
  constructor(private readonly sync: ProjectMemorySyncPort, private readonly decisions: { append(projectId: string, version: number, decision: DecisionRecord): Promise<unknown> }, private readonly projectRoot?: string) {}
  async writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>) { await this.sync.writeVersionSnapshot(projectId, version, documents); }
  async appendDecision(projectId: string, version: number, decision: DecisionRecord) { if (this.projectRoot) await new ProjectMemoryStore(path.join(this.projectRoot, versionDirectoryName(version), ".factory")).appendDecision(decision); await this.decisions.append(projectId, version, decision); }
  async checksums(_projectId: string, version: number) { const candidate = this.sync as ProjectMemorySyncPort & { filesystemChecksums?: (version: number) => Promise<Record<string, string>> }; return candidate.filesystemChecksums ? candidate.filesystemChecksums(version) : {}; }
}
export class FakePlannerMemoryPort implements PlannerMemoryPort {
  readonly documents = new Map<string, Record<string, unknown>>(); readonly decisions: DecisionRecord[] = [];
  async writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>) { const k = `${projectId}:${version}`; this.documents.set(k, { ...(this.documents.get(k) ?? {}), ...structuredClone(documents) }); }
  async appendDecision(_projectId: string, _version: number, decision: DecisionRecord) { this.decisions.push(structuredClone(decision)); }
  async checksums(projectId: string, version: number) { const docs = this.documents.get(`${projectId}:${version}`) ?? {}; return Object.fromEntries(Object.entries(docs).map(([name, value]) => [name, checksumPersistedDocument(value)])); }
}
