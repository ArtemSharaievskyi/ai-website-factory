import type { DecisionRecord } from "@/domain/workflow/decision";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { PlannerMemoryPort } from "./ports";
export class PlannerMemoryAdapter implements PlannerMemoryPort {
  constructor(private readonly sync: ProjectMemorySyncPort, private readonly decisions: { append(projectId: string, version: number, decision: DecisionRecord): Promise<unknown> }) {}
  async writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>) { await this.sync.writeVersionSnapshot(projectId, version, documents); }
  async appendDecision(projectId: string, version: number, decision: DecisionRecord) { await this.sync.appendDecision(projectId, version, decision); await this.decisions.append(projectId, version, decision); }
  async writeDecisionProjection(projectId: string, version: number, decision: DecisionRecord) { await this.sync.appendDecision(projectId, version, decision); }
  async checksums(_projectId: string, version: number) { const candidate = this.sync as ProjectMemorySyncPort & { filesystemChecksums?: (version: number) => Promise<Record<string, string>> }; return candidate.filesystemChecksums ? candidate.filesystemChecksums(version) : {}; }
}
export class FakePlannerMemoryPort implements PlannerMemoryPort {
  readonly documents = new Map<string, Record<string, unknown>>(); readonly decisions: DecisionRecord[] = [];
  async writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>) { const k = `${projectId}:${version}`; this.documents.set(k, { ...(this.documents.get(k) ?? {}), ...structuredClone(documents) }); }
  async appendDecision(_projectId: string, _version: number, decision: DecisionRecord) { this.decisions.push(structuredClone(decision)); }
  async writeDecisionProjection(_projectId: string, _version: number, decision: DecisionRecord) { if (!this.decisions.some((existing) => existing.id === decision.id)) this.decisions.push(structuredClone(decision)); }
  async checksums(projectId: string, version: number) { const docs = this.documents.get(`${projectId}:${version}`) ?? {}; return Object.fromEntries(Object.entries(docs).map(([name, value]) => [name, checksumPersistedDocument(value)])); }
}
