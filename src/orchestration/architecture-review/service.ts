import { WorkflowPersistenceService } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import type { ArchitectureReviewInput } from "@/agents/reviewers/architecture/contracts";
import { ArchitectureReviewService } from "@/agents/reviewers/architecture/service";

export class ArchitectureReviewOrchestrationService {
  private readonly workflow: WorkflowPersistenceService;
  constructor(private readonly database: PersistenceDatabase, private readonly reviewer = new ArchitectureReviewService(database)) { this.workflow = new WorkflowPersistenceService(database); }
  get reviewerService() { return this.reviewer; }
  async reviewAndRoute(input: ArchitectureReviewInput, signal?: AbortSignal) {
    const result = await this.reviewer.review(input, signal);
    if (result.verdict !== "APPROVED") return { result, projectState: "ARCHITECTURE_REVIEW" as const, rowVersion: input.expectedRowVersion };
    const transition = await this.workflow.transition({ projectId: input.projectId, projectVersion: input.projectVersion, expectedState: "ARCHITECTURE_REVIEW", expectedRowVersion: input.expectedRowVersion, targetState: "AWAITING_DESIGN_SELECTION", actor: "architecture-reviewer", reason: "Architecture Review approved; Design is now eligible.", idempotencyKey: `${input.idempotencyKey}:approved` });
    return { result, projectState: "AWAITING_DESIGN_SELECTION" as const, rowVersion: transition.rowVersion };
  }
}
