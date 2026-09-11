import {
  ExploratoryQAEvidenceSchema,
  ExploratoryScenarioRequestSchema,
  type ExploratoryQAEvidence,
  type ExploratoryScenarioRequest,
} from "@/domain/assurance/contracts";

type ScenarioObservation = { actual: string; status: "PASS" | "FAIL" | "SKIPPED"; safeEvidence: string[] };
export type ExploratoryScenarioExecutor = (scenario: ExploratoryScenarioRequest, signal: AbortSignal) => Promise<ScenarioObservation>;

const safeText = (value: string) => value.replaceAll(/\s+/g, " ").trim().slice(0, 500) || "No safe observation was returned.";
const safeRef = (value: string) => value.replaceAll(/[^A-Za-z0-9_.:/-]/g, "-").slice(0, 160) || "exploratory-qa:evidence";
const localRoute = (route: string) => route.startsWith("/") && !route.includes("..") && !/^\/\//.test(route);

/** Execute bounded, sequential, non-destructive exploratory scenarios. */
export async function executeBoundedExploratoryScenarios(input: {
  implementationChecksum: string;
  targetBoundary: "LOCAL_TEST_APPLICATION" | "DISPOSABLE_TEST_APPLICATION" | "EXPLICIT_AUTHORIZED_STAGING";
  authorizationEvidence?: string;
  timeoutMs: number;
  requestBudget: number;
  scenarios: readonly ExploratoryScenarioRequest[];
  execute: ExploratoryScenarioExecutor;
}): Promise<ExploratoryQAEvidence> {
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 60_000) throw new Error("EXPLORATORY_QA_TIMEOUT_OUT_OF_BOUNDS");
  if (!Number.isInteger(input.requestBudget) || input.requestBudget < 1 || input.requestBudget > 100) throw new Error("EXPLORATORY_QA_REQUEST_BUDGET_OUT_OF_BOUNDS");
  if (input.targetBoundary === "EXPLICIT_AUTHORIZED_STAGING" && !input.authorizationEvidence) throw new Error("EXPLORATORY_QA_TARGET_AUTHORIZATION_REQUIRED");
  const scenarios = input.scenarios.map((scenario) => ExploratoryScenarioRequestSchema.parse(scenario));
  if (scenarios.length > input.requestBudget) throw new Error("EXPLORATORY_QA_REQUEST_BUDGET_EXCEEDED");
  if (scenarios.some((scenario) => !localRoute(scenario.route))) throw new Error("EXPLORATORY_QA_ROUTE_OUTSIDE_BOUNDARY");
  const captured: ExploratoryQAEvidence["scenarios"] = [];
  for (const scenario of scenarios) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("EXPLORATORY_QA_TIMEOUT"));
        }, input.timeoutMs);
      });
      const observation = await Promise.race([input.execute(scenario, controller.signal), timeout]);
      captured.push({ ...scenario, actual: safeText(observation.actual), status: observation.status, safeEvidence: observation.safeEvidence.slice(0, 20).map(safeRef) });
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "EXPLORATORY_QA_TIMEOUT";
      captured.push({ ...scenario, actual: timedOut ? "Scenario exceeded the bounded timeout." : "Scenario did not produce an admissible safe observation.", status: "FAIL", safeEvidence: [timedOut ? "exploratory-qa:timeout" : "exploratory-qa:executor-error"] });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return ExploratoryQAEvidenceSchema.parse({ implementationChecksum: input.implementationChecksum, targetBoundary: input.targetBoundary, ...(input.authorizationEvidence ? { authorizationEvidence: input.authorizationEvidence } : {}), timeoutMs: input.timeoutMs, requestBudget: input.requestBudget, nonDestructive: true, scenarios: captured, capturedAt: new Date().toISOString() });
}
