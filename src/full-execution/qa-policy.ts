import { checksumPersistedDocument } from "../persistence/serialization";
import { FUNCTIONAL_QA_DIAGNOSTIC_POLICY_VERSION } from "../playwright-functional-qa/contracts";
import { deriveFunctionalQaPlan } from "../playwright-functional-qa/policy";
import type { PlanningPackage } from "../planner/contracts";
import type { RequirementSpecification } from "../domain/requirements/schema";

export function deriveQaPolicyRefreshIdentity(input: { projectId: string; projectVersion: number; brief: RequirementSpecification; planning: PlanningPackage; selectedDesign: unknown; sourceDocumentChecksums?: Record<string, string> }) {
  const plan = deriveFunctionalQaPlan({ projectId: input.projectId, projectVersion: input.projectVersion, brief: input.brief, planning: input.planning, briefChecksum: input.sourceDocumentChecksums?.brief ?? checksumPersistedDocument(input.brief), planningChecksum: input.sourceDocumentChecksums?.planning ?? checksumPersistedDocument(input.planning), designChecksum: input.sourceDocumentChecksums?.design ?? checksumPersistedDocument(input.selectedDesign) });
  return { policyVersion: FUNCTIONAL_QA_DIAGNOSTIC_POLICY_VERSION, scenarioChecksum: checksumPersistedDocument(plan.scenarios), sourceChecksum: checksumPersistedDocument({ brief: plan.selectedBriefChecksum, planning: plan.selectedPlanningChecksum, design: plan.selectedDesignChecksum }) };
}
