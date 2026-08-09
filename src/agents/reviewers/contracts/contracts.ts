import { z } from "zod";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { ArchitectureReviewRecordSchema, ContractAuditResultSchema } from "@/domain/review/schema";
import { SelectedDesignSchema } from "@/domain/design/schema";
import { TaskGraphSchema } from "@/domain/tasks/schema";
import { AgentIdSchema, CapabilityIdSchema } from "@/domain/agents/schema";

export const CONTRACT_AUDIT_POLICY_VERSION = "contract-audit-v1";
export const CONTRACT_AUDIT_PROMPT_VERSION = "contract-auditor.v1";
export const ContractExecutorSchema = z.object({ executorId: AgentIdSchema, kind: z.enum(["agent", "runtime"]), current: z.boolean(), capabilities: z.array(z.union([CapabilityIdSchema, z.string().regex(/^[a-z][a-z0-9-]*$/)])).min(1) }).strict();
export const ContractAuditInputSchema = z.object({
  projectId: z.string().uuid(), projectVersion: z.number().int().positive(), approvedBrief: RequirementSpecificationSchema, briefChecksum: z.string().regex(/^[a-f0-9]{64}$/), acceptedPlanningPackage: PlanningPackageSchema, planningChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  approvedArchitectureReview: ArchitectureReviewRecordSchema, architectureReviewChecksum: z.string().regex(/^[a-f0-9]{64}$/), selectedDesign: SelectedDesignSchema, designChecksum: z.string().regex(/^[a-f0-9]{64}$/), taskGraph: TaskGraphSchema, taskGraphChecksum: z.string().regex(/^[a-f0-9]{64}$/), executorCatalog: z.array(ContractExecutorSchema).max(40), idempotencyKey: z.string().min(1), expectedRowVersion: z.number().int().positive(),
}).strict();
export type ContractAuditInput = z.input<typeof ContractAuditInputSchema>;
export type ContractAuditResult = z.infer<typeof ContractAuditResultSchema>;
