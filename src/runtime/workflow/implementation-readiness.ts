import type { WorkflowState } from "@/domain/workflow/engine";

type Phase7CDocument = { documentType: "phase-7c-contract-package"; status: string };
type SelectedDesignDocument = { documentType: "selected-design" };
type ContractAuditDocument = { documentType: "contract-audit"; result?: { verdict?: string } };
type TaskGraphDocument = { documentType: "task-graph"; readyForExecution?: boolean };

export type ImplementationReadinessInput = {
  workflowState: WorkflowState;
  phase7c?: Phase7CDocument;
  selectedDesign?: SelectedDesignDocument;
  contractAudit?: ContractAuditDocument;
  taskGraph?: TaskGraphDocument;
};

export type ImplementationReadiness = {
  ready: boolean;
  blockers: string[];
};

/** Lifecycle state alone never grants START_IMPLEMENTATION. */
export function implementationReadiness(input: ImplementationReadinessInput): ImplementationReadiness {
  const blockers: string[] = [];
  if (input.workflowState !== "READY_FOR_IMPLEMENTATION") blockers.push("IMPLEMENTATION_WORKFLOW_NOT_READY");
  if (!input.phase7c || input.phase7c.status !== "APPROVED") blockers.push("PHASE_7C_APPROVAL_REQUIRED");
  if (!input.selectedDesign) blockers.push("DESIGN_SELECTION_REQUIRED");
  if (!input.contractAudit || input.contractAudit.result?.verdict !== "APPROVED") blockers.push("CONTRACT_AUDIT_REQUIRED");
  if (!input.taskGraph || input.taskGraph.readyForExecution !== true) blockers.push("IMPLEMENTATION_TASK_GRAPH_REQUIRED");
  return { ready: blockers.length === 0, blockers };
}
