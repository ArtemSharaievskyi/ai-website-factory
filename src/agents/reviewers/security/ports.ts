import type { SecurityReviewInput } from "./contracts";
import type { SecurityReviewProviderOutput } from "@/domain/review/schema";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";
export type SecurityReviewProvider = { readonly promptVersion: string; review(input: SecurityReviewInput, signal?: AbortSignal, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<SecurityReviewProviderOutput> };
