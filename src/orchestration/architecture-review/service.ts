import type { PersistenceDatabase } from "@/persistence/database/types";
import type { ArchitectureReviewInput } from "@/agents/reviewers/architecture/contracts";
import { ArchitectureReviewService } from "@/agents/reviewers/architecture/service";
import {
  ArchitectureReviewCanonicalCommitService,
  type ArchitectureReviewCanonicalCommitDependencies,
} from "./canonical-commit";

export class ArchitectureReviewOrchestrationService {
  private readonly commitService: ArchitectureReviewCanonicalCommitService;
  constructor(
    database: PersistenceDatabase,
    reviewer?: ArchitectureReviewService,
    dependencies: ArchitectureReviewCanonicalCommitDependencies = {},
  ) {
    this.reviewer = reviewer ?? new ArchitectureReviewService(database, {
      policyVersion: dependencies.policyVersion,
    });
    this.commitService = new ArchitectureReviewCanonicalCommitService(database, dependencies);
  }
  private readonly reviewer: ArchitectureReviewService;
  get reviewerService() { return this.reviewer; }
  async reviewAndRoute(input: ArchitectureReviewInput, signal?: AbortSignal) {
    const proposal = await this.reviewer.reviewProposal(input, signal);
    return this.commitService.commit(input, proposal);
  }
  async reconcileArchitectureReviewProjection(projectId: string, projectVersion: number) {
    return this.commitService.reconcileArchitectureReviewProjection(projectId, projectVersion);
  }
}
