import type { CodeIntegrationReviewInput } from "./contracts";
import type { CodeIntegrationReviewResult } from "@/domain/review/schema";
export type CodeIntegrationReviewProvider = { readonly promptVersion: string; review(input: CodeIntegrationReviewInput, signal?: AbortSignal): Promise<CodeIntegrationReviewResult> };
