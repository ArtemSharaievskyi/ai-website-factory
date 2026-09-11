import { AgentReviewResultSchema, ReviewActivationPlanSchema, ReviewCycleResultSchema, ReviewSnapshotSchema, type AgentReviewResult, type ReviewActivationPlan, type ReviewCycleResult, type ReviewSnapshot, type ReviewAgentId } from "@/domain/review/lightweight";
import { assertReviewSnapshotBindingsCurrent, evaluateReleaseReadiness } from "./release";

export type LightweightReviewInput = { snapshot: ReviewSnapshot; agent: ReviewAgentId };
export type LightweightReviewRunner = { agent: ReviewAgentId; review(input: LightweightReviewInput): Promise<AgentReviewResult> };

export class ReviewCycleError extends Error {
  constructor(readonly code: "REVIEW_AGENT_UNAVAILABLE" | "REVIEW_AGENT_FAILED" | "REVIEW_SNAPSHOT_STALE", message: string, options?: { cause?: unknown }) { super(message, options); this.name = "ReviewCycleError"; }
}

async function runBounded<T>(items: readonly T[], maxConcurrency: number, worker: (item: T) => Promise<void>) {
  const cursor = { value: 0 };
  const run = async () => {
    while (true) {
      const index = cursor.value++;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, Math.max(items.length, 1)) }, () => run()));
}

export async function runReviewCycle(input: {
  snapshot: ReviewSnapshot;
  activation: ReviewActivationPlan;
  runners: readonly LightweightReviewRunner[];
  maxConcurrency?: number;
  currentImplementationChecksum?: string;
  currentArchitectureChecksum?: string;
  currentDesignChecksum?: string;
  readCurrentImplementationChecksum?: () => Promise<string>;
  readCurrentArchitectureChecksum?: () => Promise<string>;
  readCurrentDesignChecksum?: () => Promise<string>;
  qualityGates?: Parameters<typeof evaluateReleaseReadiness>[0]["qualityGates"];
}): Promise<ReviewCycleResult> {
  const snapshot = ReviewSnapshotSchema.parse(input.snapshot);
  const activation = ReviewActivationPlanSchema.parse(input.activation);
  const maxConcurrency = Math.min(Math.max(input.maxConcurrency ?? 4, 1), 4);
  try {
    assertReviewSnapshotBindingsCurrent({
      expectedImplementationChecksum: snapshot.implementationChecksum,
      actualImplementationChecksum: input.currentImplementationChecksum ?? snapshot.implementationChecksum,
      expectedArchitectureChecksum: snapshot.architectureChecksum,
      actualArchitectureChecksum: input.currentArchitectureChecksum,
      expectedDesignChecksum: snapshot.designChecksum,
      actualDesignChecksum: input.currentDesignChecksum,
    });
  } catch (error) { throw new ReviewCycleError("REVIEW_SNAPSHOT_STALE", (error as Error).message, { cause: error }); }
  const runnerByAgent = new Map(input.runners.map((runner) => [runner.agent, runner]));
  const results: AgentReviewResult[] = [];
  const required = [...activation.required];
  const reviewerAgents: ReviewAgentId[] = required.filter((agent) => agent !== "release-readiness");
  for (const agent of reviewerAgents) if (!runnerByAgent.has(agent)) throw new ReviewCycleError("REVIEW_AGENT_UNAVAILABLE", `No approved reviewer runner is registered for ${agent}.`);
  await runBounded(reviewerAgents, maxConcurrency, async (agent) => {
    const runner = runnerByAgent.get(agent)!;
    try {
      const result = AgentReviewResultSchema.parse(await runner.review({ snapshot, agent }));
      if (result.agent !== agent || result.artifactFingerprint !== snapshot.implementationChecksum) throw new ReviewCycleError("REVIEW_SNAPSHOT_STALE", `Reviewer ${agent} returned evidence for a different implementation snapshot.`);
      results.push(result);
    } catch (error) {
      if (error instanceof ReviewCycleError) throw error;
      throw new ReviewCycleError("REVIEW_AGENT_FAILED", `Reviewer ${agent} failed without an admissible typed result.`, { cause: error });
    }
  });
  if (input.readCurrentImplementationChecksum || input.readCurrentArchitectureChecksum || input.readCurrentDesignChecksum) {
    try {
      assertReviewSnapshotBindingsCurrent({
        expectedImplementationChecksum: snapshot.implementationChecksum,
        actualImplementationChecksum: input.readCurrentImplementationChecksum ? await input.readCurrentImplementationChecksum() : snapshot.implementationChecksum,
        expectedArchitectureChecksum: snapshot.architectureChecksum,
        actualArchitectureChecksum: input.readCurrentArchitectureChecksum ? await input.readCurrentArchitectureChecksum() : undefined,
        expectedDesignChecksum: snapshot.designChecksum,
        actualDesignChecksum: input.readCurrentDesignChecksum ? await input.readCurrentDesignChecksum() : undefined,
      });
    }
    catch (error) { throw new ReviewCycleError("REVIEW_SNAPSHOT_STALE", (error as Error).message, { cause: error }); }
  }
  const orderedResults = [...results].sort((left, right) => reviewerAgents.indexOf(left.agent) - reviewerAgents.indexOf(right.agent));
  const releaseReadiness = evaluateReleaseReadiness({ implementationChecksum: snapshot.implementationChecksum, requiredReviews: reviewerAgents, reviewResults: orderedResults, qualityGates: input.qualityGates ?? snapshot.evidencePack.buildGates, currentImplementationChecksum: snapshot.implementationChecksum });
  return ReviewCycleResultSchema.parse({ snapshotId: snapshot.snapshotId, implementationChecksum: snapshot.implementationChecksum, results: orderedResults, releaseReadiness, maxConcurrency, providerBudget: { maxCalls: 0 }, providerCalls: 0 });
}
