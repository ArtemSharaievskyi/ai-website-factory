import type { DecisionRecord } from "@/domain/workflow/decision";
import type { PlannerAgentInput, PlanningPackage } from "./contracts";
import type { PlannerRefreshProviderInput, PlanningChangeSetProviderOutput } from "./changeset";
import type { Context7DocumentationPort, DocumentationExcerpt } from "../../integrations/context7/contracts";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";

export interface PlannerArchitectureProvider {
  plan(input: PlannerAgentInput & { documentationExcerpts?: DocumentationExcerpt[] }, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<PlanningPackage>;
  proposeChangeSet?(input: PlannerRefreshProviderInput, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<PlanningChangeSetProviderOutput>;
}
export type PlannerDocumentationPort = Context7DocumentationPort;
export interface PlannerSkillSelectionPort { select(input: { role: "planner-architect"; taskType: "product-scope" | "ux-architecture" | "technical-architecture" | "content-planning" | "asset-planning" }): Promise<string[]>; }
export class EmptyPlannerSkillSelectionPort implements PlannerSkillSelectionPort { async select() { return []; } }
export type PlannerAcceptanceFaultPoint = "after-acceptance-write" | "before-decision-write" | "after-decision-write" | "before-workflow-transition";
export type PlannerAcceptanceFaultInjector = { hit(point: PlannerAcceptanceFaultPoint): void | Promise<void> };
export interface PlannerMemoryPort { writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>): Promise<void>; appendDecision(projectId: string, version: number, decision: DecisionRecord): Promise<void>; writeDecisionProjection(projectId: string, version: number, decision: DecisionRecord): Promise<void>; checksums(projectId: string, version: number): Promise<Record<string, string>>; }
