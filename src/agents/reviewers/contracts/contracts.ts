import { z } from "zod";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { ArchitectureReviewRecordSchema, ContractAuditResultSchema } from "@/domain/review/schema";
import { SelectedDesignSchema } from "@/domain/design/schema";
import { TaskGraphSchema } from "@/domain/tasks/schema";
import { AgentCapabilityIdSchema, AgentIdSchema } from "@/domain/agents/schema";

export const CONTRACT_AUDIT_POLICY_VERSION = "contract-audit-v1";
export const CONTRACT_AUDIT_PROMPT_VERSION = "contract-auditor.v1";
export const ContractExecutorSchema = z.object({ executorId: AgentIdSchema, kind: z.enum(["agent", "runtime"]), current: z.boolean(), capabilities: z.array(z.union([AgentCapabilityIdSchema, z.string().regex(/^[a-z][a-z0-9-]*$/)])).min(1) }).strict();
export type CanonicalProjectIdentity = { projectId: string; projectVersion: number };
export function projectIdentityMismatches(
  expected: CanonicalProjectIdentity,
  artifacts: readonly { label: string; value: CanonicalProjectIdentity }[],
) {
  return artifacts
    .filter((artifact) => artifact.value.projectId !== expected.projectId || artifact.value.projectVersion !== expected.projectVersion)
    .map((artifact) => artifact.label);
}
export function assertProjectIdentity(
  expected: CanonicalProjectIdentity,
  artifacts: readonly { label: string; value: CanonicalProjectIdentity }[],
) {
  const mismatches = projectIdentityMismatches(expected, artifacts);
  if (mismatches.length) throw new Error(`Canonical project identity mismatch: ${mismatches.join(", ")}.`);
}
export function addProjectIdentityIssues(
  expected: CanonicalProjectIdentity,
  artifacts: readonly { label: string; value: CanonicalProjectIdentity }[],
  context: z.RefinementCtx,
) {
  for (const label of projectIdentityMismatches(expected, artifacts)) context.addIssue({ code: "custom", path: [label, "projectId"], message: `The ${label} is not bound to the requested project identity/version.` });
}
export const ContractAuditInputSchema = z.object({
  projectId: z.string().uuid(), projectVersion: z.number().int().positive(), approvedBrief: RequirementSpecificationSchema, briefChecksum: z.string().regex(/^[a-f0-9]{64}$/), acceptedPlanningPackage: PlanningPackageSchema, planningChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  approvedArchitectureReview: ArchitectureReviewRecordSchema, architectureReviewChecksum: z.string().regex(/^[a-f0-9]{64}$/), selectedDesign: SelectedDesignSchema, designChecksum: z.string().regex(/^[a-f0-9]{64}$/), taskGraph: TaskGraphSchema, taskGraphChecksum: z.string().regex(/^[a-f0-9]{64}$/), executorCatalog: z.array(ContractExecutorSchema).max(40), idempotencyKey: z.string().min(1), expectedRowVersion: z.number().int().positive(),
}).strict().superRefine((input, context) => addProjectIdentityIssues(
  input,
  [
    { label: "approvedBrief", value: input.approvedBrief },
    { label: "acceptedPlanningPackage", value: input.acceptedPlanningPackage },
    { label: "approvedArchitectureReview", value: input.approvedArchitectureReview },
    { label: "selectedDesign", value: input.selectedDesign },
    { label: "taskGraph", value: input.taskGraph },
  ],
  context,
));
export type ContractAuditInput = z.input<typeof ContractAuditInputSchema>;
export type ContractAuditResult = z.infer<typeof ContractAuditResultSchema>;
