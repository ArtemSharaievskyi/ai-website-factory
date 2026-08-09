import type { TestQualityReviewInput } from "./contracts";
import type { TestQualityReviewResult } from "@/domain/review/schema";
export type TestQualityReviewProvider = { readonly promptVersion: string; review(input: TestQualityReviewInput, signal?: AbortSignal): Promise<TestQualityReviewResult> };
