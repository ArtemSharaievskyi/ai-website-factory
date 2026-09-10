import type { FactoryProject } from "@/domain/project/schema";
import { WorkspaceManager } from "@/runtime/workspace/manager";
import { RepairWorkspaceIdentitySchema, type RepairWorkspaceIdentity } from "./contracts";

export type RepairWorkspaceOpenInput = { repairId: string; sourceHead: string; createdAt?: string; project?: FactoryProject; projectVersion?: number; operationId?: string };

export interface RepairWorkspacePort {
  open(input: RepairWorkspaceOpenInput): Promise<RepairWorkspaceIdentity>;
  discard?(workspace: RepairWorkspaceIdentity): Promise<void>;
}

/** Test and local analysis workspace. It records identity but exposes no canonical writer. */
export class InMemoryRepairWorkspace implements RepairWorkspacePort {
  private readonly workspaces = new Map<string, RepairWorkspaceIdentity>();

  async open(input: RepairWorkspaceOpenInput) {
    const workspace = RepairWorkspaceIdentitySchema.parse({ workspaceId: `repair-workspace:${input.repairId}`, repairId: input.repairId, sourceHead: input.sourceHead, path: `repair-workspaces/${input.repairId}`, actualChangedFiles: [], createdAt: input.createdAt ?? new Date().toISOString() });
    this.workspaces.set(workspace.workspaceId, workspace);
    return workspace;
  }

  async discard(workspace: RepairWorkspaceIdentity) { this.workspaces.delete(workspace.workspaceId); }
}

/** Production adapter around the existing WorkspaceManager's staged-copy boundary. */
export class WorkspaceManagerRepairWorkspace implements RepairWorkspacePort {
  constructor(private readonly manager: WorkspaceManager) {}

  async open(input: RepairWorkspaceOpenInput) {
    if (!input.project || !input.projectVersion || !input.operationId) throw new Error("REPAIR_WORKSPACE_PROJECT_BINDING_REQUIRED");
    const stagedPath = await this.manager.createMutableExecutionStaging(input.project, input.projectVersion, input.operationId);
    return RepairWorkspaceIdentitySchema.parse({ workspaceId: input.operationId, repairId: input.repairId, sourceHead: input.sourceHead, path: stagedPath, actualChangedFiles: [], createdAt: input.createdAt ?? new Date().toISOString() });
  }

}
