import type { TestQualityReviewInput } from "./contracts";
import type { TestQualityReviewProviderOutput } from "@/domain/review/schema";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";
export type TestQualityReviewProvider = { readonly promptVersion: string; review(input: TestQualityReviewInput, signal?: AbortSignal, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<TestQualityReviewProviderOutput> };
