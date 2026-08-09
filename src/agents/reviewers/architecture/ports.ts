import type { ArchitectureReviewInput, ArchitectureReviewOutput } from "./contracts";

export interface ArchitectureReviewProvider { readonly promptVersion: string; review(input: ArchitectureReviewInput, signal?: AbortSignal): Promise<ArchitectureReviewOutput>; }
