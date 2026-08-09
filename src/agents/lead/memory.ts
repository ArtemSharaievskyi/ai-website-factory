import path from "node:path";
import type { DecisionRecord } from "@/domain/workflow/decision";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";
import { ProjectMemoryStore } from "@/persistence/project-memory/store";
import { versionDirectoryName } from "../../runtime/workspace/schemas";
import type { LeadMemoryPort } from "./ports";

export class LeadMemoryAdapter implements LeadMemoryPort {
  private readonly projectRoot?: string;
  constructor(private readonly sync: ProjectMemorySyncPort, projectRootOrLegacy?: string | { append(projectId: string, version: number, decision: DecisionRecord): Promise<unknown> }, projectRoot?: string) {
    this.projectRoot = projectRoot ?? (typeof projectRootOrLegacy === "string" ? projectRootOrLegacy : undefined);
  }
  async writeSnapshot(projectId: string, projectVersion: number, documents: Record<string, unknown>) { await this.sync.writeVersionSnapshot(projectId, projectVersion, documents); }
  async appendDecision(projectId: string, projectVersion: number, decision: DecisionRecord) {
    if (this.projectRoot) await new ProjectMemoryStore(path.join(this.projectRoot, versionDirectoryName(projectVersion), ".factory")).appendDecision(decision);
  }
  async verify(projectId: string, projectVersion: number) { return this.sync.verifyVersionSnapshot(projectId, projectVersion); }
  async checksums(projectId: string, projectVersion: number) {
    const candidate = this.sync as ProjectMemorySyncPort & { filesystemChecksums?: (version: number) => Promise<Record<string, string>> };
    return candidate.filesystemChecksums ? candidate.filesystemChecksums(projectVersion) : {};
  }
}

export class FakeLeadMemoryPort implements LeadMemoryPort {
  readonly documents = new Map<string, Record<string, unknown>>(); readonly decisions: DecisionRecord[] = [];
  async writeSnapshot(projectId: string, projectVersion: number, documents: Record<string, unknown>) { const snapshotKey = `${projectId}:${projectVersion}`; this.documents.set(snapshotKey, { ...(this.documents.get(snapshotKey) ?? {}), ...structuredClone(documents) }); }
  async appendDecision(_projectId: string, _projectVersion: number, decision: DecisionRecord) { this.decisions.push(structuredClone(decision)); }
  async verify(projectId: string, projectVersion: number) { return this.documents.has(`${projectId}:${projectVersion}`); }
  async checksums(projectId: string, projectVersion: number) { const docs = this.documents.get(`${projectId}:${projectVersion}`) ?? {}; return Object.fromEntries(Object.entries(docs).map(([name, value]) => [name, checksumPersistedDocument(value)])); }
}
