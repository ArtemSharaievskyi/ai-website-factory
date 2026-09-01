import type { DecisionRecord } from "@/domain/workflow/decision";
import type { DesignAgentInput } from "./contracts";
import type { DesignDirectionSet } from "@/domain/design/schema";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";
export interface DesignDirectionProvider { preflight?(): void; proposeDesignDirections(input: DesignAgentInput, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<DesignDirectionSet>; }
export interface DesignExplorationToolPort { explore(input: DesignAgentInput): Promise<unknown>; }
export interface DesignSkillSelectionPort { select(input: { role: "design"; taskType: "visual-direction" | "typography" | "color-strategy" | "layout-planning" | "image-art-direction" | "responsive-composition" | "anti-template-review" }): Promise<string[]>; }
export class EmptyDesignSkillSelectionPort implements DesignSkillSelectionPort { async select() { return []; } }
export class EmptyDesignExplorationToolPort implements DesignExplorationToolPort { async explore() { return null; } }
export interface DesignMemoryPort { writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>): Promise<void>; removeDocument?(projectId: string, version: number, documentName: string): Promise<void>; appendDecision(projectId: string, version: number, decision: DecisionRecord): Promise<void>; checksums(projectId: string, version: number): Promise<Record<string, string>>; }
