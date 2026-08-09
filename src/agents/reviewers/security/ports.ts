import type { SecurityReviewInput } from "./contracts";
import type { SecurityReviewResult } from "@/domain/review/schema";
export type SecurityReviewProvider = { readonly promptVersion: string; review(input: SecurityReviewInput, signal?: AbortSignal): Promise<SecurityReviewResult> };
