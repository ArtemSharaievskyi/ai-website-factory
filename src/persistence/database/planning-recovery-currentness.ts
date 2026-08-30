import { BriefV3DocumentSchema } from "./brief-revision-v3-contracts";
import type { DocumentRow } from "./mapping";
import type { ProjectRow, ProjectVersionRow } from "./types";
import { mapRowToDocument } from "./mapping";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY, planningSemanticChecksumForPolicy } from "@/agents/planner/semantic-checksum";
import type { PlanningRecoveryProviderAttemptStartCurrentness, PlanningRecoveryRunRow } from "@/agents/planner/recovery-runs";
import { PersistenceError } from "./errors";

export function assertPlanningRecoveryProviderAttemptStartCurrentness(input: {
  run: PlanningRecoveryRunRow;
  currentness: PlanningRecoveryProviderAttemptStartCurrentness;
  expectedSourceHead: string;
  recoveryPlanChecksum: string;
  project: ProjectRow;
  version: ProjectVersionRow;
  briefRow: DocumentRow;
  planningRow: DocumentRow;
}) {
  const { run, currentness, project, version, briefRow, planningRow } = input;
  const brief = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
  const planning = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
  const planningSemanticChecksum = planningSemanticChecksumForPolicy(planning, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY);
  const runMatches = run.projectId === currentness.projectId
    && run.projectVersion === currentness.projectVersion
    && run.projectRowVersion === currentness.projectRowVersion
    && run.projectVersionRowVersion === currentness.projectVersionRowVersion
    && run.briefRowVersion === currentness.briefRowVersion
    && run.briefSemanticChecksum === currentness.briefSemanticChecksum
    && run.briefDocumentChecksum === currentness.briefDocumentChecksum
    && run.planningRowVersion === currentness.planningRowVersion
    && run.planningSemanticChecksum === currentness.planningSemanticChecksum
    && run.planningDocumentChecksum === currentness.planningDocumentChecksum;
  const currentMatches = project.id === currentness.projectId
    && project.current_version === currentness.projectVersion
    && project.row_version === currentness.projectRowVersion
    && project.workflow_state === currentness.workflowState
    && version.projectId === currentness.projectId
    && version.versionNumber === currentness.projectVersion
    // Project workflow transitions and project-version lifecycle state are independent.
    && version.rowVersion === currentness.projectVersionRowVersion
    && briefRow.rowVersion === currentness.briefRowVersion
    && briefRow.checksum === currentness.briefDocumentChecksum
    && brief.briefChecksum === currentness.briefSemanticChecksum
    && brief.approval?.approved === true
    && brief.approval.approvedCanonicalChecksum === brief.briefChecksum
    && planningRow.rowVersion === currentness.planningRowVersion
    && planningRow.checksum === currentness.planningDocumentChecksum
    && planningSemanticChecksum === currentness.planningSemanticChecksum
    && planning.approvedBriefChecksum === currentness.planningApprovedBriefChecksum
    && planning.accepted === currentness.planningAccepted;
  if (run.expectedSourceHead !== input.expectedSourceHead || run.recoveryPlanChecksum !== input.recoveryPlanChecksum || !runMatches || !currentMatches) {
    throw new PersistenceError("PERSISTENCE_CONFLICT", "Planning recovery provider attempt currentness is stale.");
  }
}
