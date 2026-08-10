import type { CodeIntegrationReviewInput } from "./contracts";
import type { CodeIntegrationReviewResult } from "@/domain/review/schema";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";
export type CodeIntegrationReviewProvider = { readonly promptVersion: string; review(input: CodeIntegrationReviewInput, signal?: AbortSignal, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<CodeIntegrationReviewResult> };
