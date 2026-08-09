import type { DecisionRecord } from "@/domain/workflow/decision";
import type { PlannerAgentInput, PlanningPackage } from "./contracts";
import type { Context7DocumentationPort, DocumentationExcerpt } from "../../integrations/context7/contracts";

export interface PlannerArchitectureProvider { plan(input: PlannerAgentInput & { documentationExcerpts?: DocumentationExcerpt[] }): Promise<PlanningPackage>; }
export type PlannerDocumentationPort = Context7DocumentationPort;
export interface PlannerSkillSelectionPort { select(input: { role: "planner-architect"; taskType: "product-scope" | "ux-architecture" | "technical-architecture" | "content-planning" | "asset-planning" }): Promise<string[]>; }
export class EmptyPlannerSkillSelectionPort implements PlannerSkillSelectionPort { async select() { return []; } }
export interface PlannerMemoryPort { writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>): Promise<void>; appendDecision(projectId: string, version: number, decision: DecisionRecord): Promise<void>; checksums(projectId: string, version: number): Promise<Record<string, string>>; }
