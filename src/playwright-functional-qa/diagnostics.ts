import { FunctionalQaDiagnosticSchema, type FunctionalQaDiagnostic, type FunctionalQaScenario, type FunctionalQaScenarioResult, type FunctionalQaReport } from "./contracts";

const pagePath = (route: string) => `src/app${route === "/" ? "" : route}/page.tsx`;
const ownershipFor = (scenario: FunctionalQaScenario, result: FunctionalQaScenarioResult) => {
  const action = result.evidence.find((item) => item.result === "failed")?.action;
  if (scenario.requiresForm || ["fill", "submit", "select", "check"].includes(action ?? "")) return scenario.requiresForm && action === "submit" ? ["implement-form", "implement-server-action"] as const : ["implement-form"] as const;
  if (action === "click") return ["implement-navigation"] as const;
  return ["implement-page"] as const;
};

export function deriveFunctionalQaDiagnostics(input: { plan: { scenarios: FunctionalQaScenario[] }; results: FunctionalQaScenarioResult[]; browserErrors: FunctionalQaReport["browserErrors"] }): FunctionalQaDiagnostic[] {
  const diagnostics: FunctionalQaDiagnostic[] = [];
  for (const result of input.results.filter((candidate) => candidate.status === "failed")) {
    const scenario = input.plan.scenarios.find((candidate) => candidate.scenarioId === result.scenarioId);
    if (!scenario) continue;
    const failed = result.evidence.find((item) => item.result === "failed");
    const category = result.safeFailureCode ?? scenario.failureCategory;
    const route = failed?.route ?? scenario.startRoute;
    const owners = scenario.ownershipCandidates.length ? scenario.ownershipCandidates : ownershipFor(scenario, result);
    diagnostics.push(FunctionalQaDiagnosticSchema.parse({
      category, scenarioId: scenario.scenarioId, scenarioType: scenario.scenarioType, route, ...(failed ? { stepId: scenario.steps[failed.stepIndex]?.stepId, stepIndex: failed.stepIndex, action: failed.action } : {}),
      assertion: scenario.assertions[0]?.category, selectorRole: failed?.action === "fill" || failed?.action === "submit" ? "approved-form-selector" : undefined,
      safeMessage: "Functional QA failed at an approved scenario step.",
      requirementReferences: [...new Set([...scenario.requirementReferences, ...scenario.acceptanceCriteriaReferences])].slice(0, 20),
      planningReferences: [...new Set([...scenario.planningReferences, ...scenario.userFlowReferences, scenario.scenarioId])].slice(0, 20), artifactReferences: scenario.artifactReferences.slice(0, 20),
      candidateOwnership: [...owners], sourceHints: ["SCENARIO_TRACEABILITY", "CANONICAL_ROUTE"],
      runtimeReference: { relativePath: pagePath(route), category, route, candidateOwnership: [...owners], requirementReferences: scenario.requirementReferences.slice(0, 20), planningReferences: [...scenario.planningReferences, ...scenario.userFlowReferences, scenario.scenarioId].slice(0, 20), classification: "IMPLEMENTATION_DEFECT", safeMessage: "Bounded functional QA failure." },
    }));
  }
  if (!diagnostics.length && input.browserErrors.some((error) => !error.approvedNoise)) {
    const error = input.browserErrors.find((candidate) => !candidate.approvedNoise)!;
    const scenario = input.plan.scenarios[0];
    if (scenario) diagnostics.push(FunctionalQaDiagnosticSchema.parse({ category: error.safeErrorCode ?? "QA_BROWSER_RUNTIME_ERROR", scenarioId: scenario.scenarioId, scenarioType: scenario.scenarioType, route: error.route ?? scenario.startRoute, safeMessage: error.safeSummary, requirementReferences: scenario.requirementReferences.slice(0, 20), planningReferences: [...scenario.planningReferences, ...scenario.userFlowReferences, scenario.scenarioId].slice(0, 20), artifactReferences: scenario.artifactReferences.slice(0, 20), candidateOwnership: scenario.ownershipCandidates.length ? scenario.ownershipCandidates : ["implement-page"], sourceHints: ["BROWSER_SAFE_ERROR", "CANONICAL_ROUTE"], runtimeReference: { relativePath: pagePath(error.route ?? scenario.startRoute), category: error.safeErrorCode, route: error.route ?? scenario.startRoute, candidateOwnership: scenario.ownershipCandidates.length ? scenario.ownershipCandidates : ["implement-page"], requirementReferences: scenario.requirementReferences.slice(0, 20), planningReferences: [...scenario.planningReferences, ...scenario.userFlowReferences, scenario.scenarioId].slice(0, 20), classification: "IMPLEMENTATION_DEFECT", safeMessage: "Bounded browser runtime failure." } }));
  }
  return diagnostics.slice(0, 50);
}
