import type { ArchitectureReviewInput, ArchitectureReviewOutput } from "./contracts";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";

export interface ArchitectureReviewProvider { readonly promptVersion: string; review(input: ArchitectureReviewInput, signal?: AbortSignal, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<ArchitectureReviewOutput>; }
