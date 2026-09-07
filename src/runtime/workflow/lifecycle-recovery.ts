import { WorkflowStateSchema } from "@/domain/project/schema";
import type { WorkflowState } from "@/domain/workflow/engine";
import { transitionWorkflow } from "@/domain/workflow/engine";
import { mapRowToDocument } from "@/persistence/database/mapping";
import type { DocumentRow } from "@/persistence/database/mapping";
import { PersistenceError } from "@/persistence/database/errors";
import { transitionWorkflowInTransaction } from "@/persistence/database/repositories";
import type { PersistenceDatabase, ProjectRow, ProjectVersionRow } from "@/persistence/database/types";

type LifecycleDocuments = {
  brief: unknown | null;
  planning: unknown | null;
  architectureReview: unknown | null;
  designDirections: unknown | null;
  selectedDesign: unknown | null;
  taskGraph: unknown | null;
};

export type LifecycleRecoveryPlan = {
  projectId: string;
  projectVersion: number;
  observedState: WorkflowState;
  observedRowVersion: number;
  targetState: WorkflowState;
  reason: string;
  operationKey: string;
};

export type LifecycleRecoveryResult = LifecycleRecoveryPlan & {
  recovered: boolean;
  rowVersion: number;
};

const approvedBrief = (brief: unknown) => {
  if (!brief || typeof brief !== "object") return false;
  const value = brief as Record<string, unknown>;
  if (value.documentType === "brief-v3") {
    const approval = value.approval;
    return Boolean(approval && typeof approval === "object" && (approval as Record<string, unknown>).approved === true && (approval as Record<string, unknown>).approvedCanonicalChecksum === value.briefChecksum);
  }
  return value.documentType === "requirements"
    && value.briefStatus === "approved"
    && Boolean(value.approval && typeof value.approval === "object" && (value.approval as Record<string, unknown>).approved === true);
};

const acceptedPlanning = (planning: unknown) => Boolean(planning && typeof planning === "object" && (planning as Record<string, unknown>).documentType === "planning-package" && (planning as Record<string, unknown>).accepted === true);
const approvedArchitectureReview = (review: unknown) => Boolean(review && typeof review === "object" && (review as Record<string, unknown>).documentType === "architecture-review" && (review as Record<string, unknown>).result && typeof (review as Record<string, unknown>).result === "object" && ((review as Record<string, unknown>).result as Record<string, unknown>).verdict === "APPROVED");
const present = (document: unknown, type: string) => Boolean(document && typeof document === "object" && (document as Record<string, unknown>).documentType === type);
const toDocument = (row: DocumentRow | null) => row ? mapRowToDocument(row) : null;

function highestValidFrontier(documents: LifecycleDocuments): WorkflowState {
  if (!approvedBrief(documents.brief)) return "AWAITING_BRIEF_APPROVAL";
  if (!present(documents.planning, "planning-package")) return "AWAITING_PLANNING_GENERATION";
  if (!acceptedPlanning(documents.planning)) return "AWAITING_PLANNING_APPROVAL";
  if (!approvedArchitectureReview(documents.architectureReview)) return "ARCHITECTURE_REVIEW";
  if (!present(documents.designDirections, "design-directions")) return "ARCHITECTURE_REVIEW";
  if (!present(documents.selectedDesign, "selected-design")) return "AWAITING_DESIGN_SELECTION";
  return "READY_FOR_IMPLEMENTATION";
}

export function deriveLifecycleRecoveryPlan(input: {
  project: ProjectRow;
  version: ProjectVersionRow;
  documents: LifecycleDocuments;
  operationKey?: string;
}): LifecycleRecoveryPlan {
  const project = input.project;
  if (project.current_version !== input.version.versionNumber)
    throw new PersistenceError("PERSISTENCE_CONFLICT", "Lifecycle recovery requires the current project version.");
  const targetState = highestValidFrontier(input.documents);
  WorkflowStateSchema.parse(targetState);
  const operationKey = input.operationKey ?? `lifecycle-recovery:${project.id}:${input.version.versionNumber}:${project.row_version}:${targetState}`;
  return {
    projectId: project.id,
    projectVersion: input.version.versionNumber,
    observedState: project.workflow_state,
    observedRowVersion: project.row_version,
    targetState,
    reason: `Lifecycle recovery reconciled the workflow to the highest valid persisted artifact frontier (${targetState}).`,
    operationKey,
  };
}

export class LifecycleRecoveryService {
  constructor(private readonly database: PersistenceDatabase) {}

  async inspect(projectId: string, projectVersion: number, operationKey?: string): Promise<LifecycleRecoveryPlan> {
    return this.database.transaction(async (tx) => {
      const project = await tx.getProject(projectId);
      const version = await tx.getVersion(projectId, projectVersion);
      if (!project || !version) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Lifecycle recovery project/version was not found.");
      const brief = (await tx.getDocument(projectId, projectVersion, "brief-v3")) ?? (await tx.getDocument(projectId, projectVersion, "requirements"));
      const planning = await tx.getDocument(projectId, projectVersion, "planning-package");
      const architectureReview = await tx.getDocument(projectId, projectVersion, "architecture-review");
      const designDirections = await tx.getDocument(projectId, projectVersion, "design-directions");
      const selectedDesign = await tx.getDocument(projectId, projectVersion, "selected-design");
      const taskGraph = await tx.getDocument(projectId, projectVersion, "task-graph");
      return deriveLifecycleRecoveryPlan({ project, version, documents: { brief: toDocument(brief), planning: toDocument(planning), architectureReview: toDocument(architectureReview), designDirections: toDocument(designDirections), selectedDesign: toDocument(selectedDesign), taskGraph: toDocument(taskGraph) }, operationKey });
    });
  }

  async reconcile(input: { projectId: string; projectVersion: number; expectedState?: WorkflowState; expectedRowVersion?: number; operationKey?: string; actor?: string }): Promise<LifecycleRecoveryResult> {
    return this.database.transaction(async (tx) => {
      const project = await tx.getProject(input.projectId);
      const version = await tx.getVersion(input.projectId, input.projectVersion);
      if (!project || !version) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Lifecycle recovery project/version was not found.");
      if (input.expectedState && project.workflow_state !== input.expectedState) throw new PersistenceError("PERSISTENCE_CONFLICT", "Lifecycle recovery observed a different workflow state.");
      if (input.expectedRowVersion && project.row_version !== input.expectedRowVersion) throw new PersistenceError("PERSISTENCE_CONFLICT", "Lifecycle recovery observed a stale project row version.");
      const rows = {
        brief: (await tx.getDocument(input.projectId, input.projectVersion, "brief-v3")) ?? (await tx.getDocument(input.projectId, input.projectVersion, "requirements")),
        planning: await tx.getDocument(input.projectId, input.projectVersion, "planning-package"),
        architectureReview: await tx.getDocument(input.projectId, input.projectVersion, "architecture-review"),
        designDirections: await tx.getDocument(input.projectId, input.projectVersion, "design-directions"),
        selectedDesign: await tx.getDocument(input.projectId, input.projectVersion, "selected-design"),
        taskGraph: await tx.getDocument(input.projectId, input.projectVersion, "task-graph"),
      };
      const documents: LifecycleDocuments = { brief: toDocument(rows.brief), planning: toDocument(rows.planning), architectureReview: toDocument(rows.architectureReview), designDirections: toDocument(rows.designDirections), selectedDesign: toDocument(rows.selectedDesign), taskGraph: toDocument(rows.taskGraph) };
      const plan = deriveLifecycleRecoveryPlan({ project, version, documents, operationKey: input.operationKey });
      if (plan.targetState === plan.observedState) return { ...plan, recovered: false, rowVersion: project.row_version };
      transitionWorkflow(plan.observedState, plan.targetState, { lifecycleRecovery: true });
      const transition = await transitionWorkflowInTransaction(tx, {
        projectId: plan.projectId,
        projectVersion: plan.projectVersion,
        expectedState: plan.observedState,
        expectedRowVersion: plan.observedRowVersion,
        targetState: plan.targetState,
        actor: input.actor ?? "lifecycle-recovery",
        reason: plan.reason,
        context: { lifecycleRecovery: true },
        idempotencyKey: plan.operationKey,
      });
      return { ...plan, recovered: true, rowVersion: transition.rowVersion };
    });
  }
}
