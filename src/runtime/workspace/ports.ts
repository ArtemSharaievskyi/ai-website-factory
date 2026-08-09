import type { DecisionRecord } from "@/domain/workflow/decision";
import type { ProjectVersionRow } from "@/persistence/database/types";

export interface WorkspaceVersionPort {
  reserveNextVersion(projectId: string, idempotencyKey?: string): Promise<ProjectVersionRow>;
  getVersion(projectId: string, version: number): Promise<ProjectVersionRow | null>;
  listVersions(projectId: string): Promise<ProjectVersionRow[]>;
  markImmutable(projectId: string, version: number, releasedAt: string): Promise<ProjectVersionRow>;
}
export interface WorkspaceDecisionPort { append(projectId: string, version: number, record: DecisionRecord): Promise<DecisionRecord>; }
