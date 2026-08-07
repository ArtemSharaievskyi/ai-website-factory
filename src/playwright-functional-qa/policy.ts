import path from "node:path";
import { randomUUID } from "node:crypto";
import { FunctionalQaError } from "./errors";
import { FunctionalQaPlanSchema, type FunctionalQaPlan, type QaReadinessInput, type ScenarioDerivationInput } from "./contracts";

const unsafeServerScript = /(^|[;&|])\s*(curl|wget|powershell|cmd(?:\.exe)?|bash|sh|git\s+push|npm\s+(install|exec)|npx\b|pnpm\b|yarn\b|bun\b|supabase\b|deploy|vercel|docker)\b|https?:\/\/|&&|\|\|/i;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertLocalhostUrl(value: string, assignedPort: number): URL {
  let url: URL;
  try { url = new URL(value); } catch (error) { throw new FunctionalQaError("QA_URL_NOT_ALLOWED", "QA navigation URL is invalid.", error); }
  if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname) || url.port !== String(assignedPort) || url.username || url.password || url.search || url.hash) throw new FunctionalQaError("QA_URL_NOT_ALLOWED", "Only the assigned HTTP loopback URL is allowed.");
  return url;
}

export function assertLocalhostRoute(route: string, assignedPort: number) {
  if (!route.startsWith("/")) throw new FunctionalQaError("QA_URL_NOT_ALLOWED", "QA routes must be relative localhost paths.");
  return assertLocalhostUrl(`http://127.0.0.1:${assignedPort}${route}`, assignedPort);
}

export function assertSafeTestServerScript(script: unknown) {
  if (typeof script !== "string" || !script.trim() || unsafeServerScript.test(script)) throw new FunctionalQaError("QA_SERVER_START_FAILED", "The generated project start:test script is missing or unsafe.");
  if (/\b(migrate|migration|deploy|production|https?:\/\/)/i.test(script)) throw new FunctionalQaError("QA_SERVER_START_FAILED", "The test server script cannot deploy, migrate, or contact production.");
}

export function validateQaReadiness(input: QaReadinessInput) {
  const root = path.resolve(input.generatedProjectsRoot); const workspace = path.resolve(input.workspacePath);
  if (!input.mutable || workspace === root || !workspace.startsWith(`${root}${path.sep}`)) throw new FunctionalQaError("QA_WORKSPACE_INVALID", "QA requires a mutable generated-project staging workspace.");
  if (!input.runtimeValidation) throw new FunctionalQaError("QA_RUNTIME_VALIDATION_INCOMPLETE", "Runtime validation is required before functional QA.");
  if (input.runtimeValidation.overallStatus !== "passed") throw new FunctionalQaError("QA_RUNTIME_VALIDATION_INCOMPLETE", "Runtime validation did not pass all required checks.");
  if (input.task.taskType !== "validate-functional-flow" || input.task.status !== "ready") throw new FunctionalQaError("QA_NOT_READY", "Functional QA requires a READY validate-functional-flow task.");
  if (!input.task.allowedTools.includes("Playwright-functional")) throw new FunctionalQaError("QA_TOOL_NOT_ALLOWED", "The task is not authorized for Playwright-functional QA.");
  if (input.blockingImplementationTask || !input.fixturesAvailable) throw new FunctionalQaError("QA_NOT_READY", "Blocking implementation work or required local fixtures remain.");
  if (input.actualBriefChecksum !== input.expectedBriefChecksum || input.actualPlanningChecksum !== input.expectedPlanningChecksum || input.actualDesignChecksum !== input.expectedDesignChecksum) throw new FunctionalQaError("QA_PROJECT_STATE_STALE", "Approved QA inputs are stale.");
  return true;
}

export function deriveFunctionalQaPlan(input: ScenarioDerivationInput): FunctionalQaPlan {
  const routeScenarios = input.planning.sitemap.routes.map((route) => ({ scenarioId: `route:${route.id}`, title: `Route loads: ${route.path}`, actor: route.intendedUser, purpose: route.primaryGoal, acceptanceCriteriaReferences: route.requirementReferences.length ? route.requirementReferences : input.brief.userAcceptanceCriteria, requirementReferences: route.requirementReferences, userFlowReferences: [], startRoute: route.path, preconditions: route.visibility === "protected" ? ["Approved synthetic authenticated fixture"] : [], steps: [{ order: 1, action: "navigate" as const, route: route.path, timeoutMs: 10000 }, { order: 2, action: "assertStatus" as const, expectedStatus: 200, timeoutMs: 5000 }, { order: 3, action: "assertUrl" as const, expectedUrl: route.path, timeoutMs: 5000 }], assertions: [{ category: route.visibility === "protected" ? "auth" as const : "route" as const, expected: route.visibility === "protected" ? "Protected route requires approved synthetic auth." : "Planned route returns the expected page status.", mandatory: true }], expectedOutcome: `The planned route ${route.path} is reachable with its approved access behavior.`, failureCategory: route.visibility === "protected" ? "QA_ROUTE_ACCESS_MISMATCH" : "QA_ROUTE_MISSING", requiresAuth: route.visibility === "protected", requiresForm: false, requiresDatabaseFixture: false, timeoutMs: 30000 }));
  const formScenarios = input.planning.forms.forms.map((form) => ({ scenarioId: `form:${form.id}`, title: `Form validation: ${form.purpose}`, actor: input.brief.targetAudiences[0] ?? "Visitor", purpose: form.purpose, acceptanceCriteriaReferences: input.brief.userAcceptanceCriteria, requirementReferences: form.requirementReferences, userFlowReferences: input.planning.userFlows.flows.filter((flow) => flow.formRequirements.includes(form.id)).map((flow) => flow.id), startRoute: form.route, preconditions: ["Synthetic QA data only"], steps: [{ order: 1, action: "navigate" as const, route: form.route, timeoutMs: 10000 }, ...form.fields.filter((field) => field.required).map((field, index) => ({ order: index + 2, action: "fill" as const, selector: `[data-qa-field=\"${field.name}\"]`, value: field.type.toLowerCase().includes("email") ? "qa@example.invalid" : `Synthetic ${field.name}`, timeoutMs: 5000 })), { order: form.fields.length + 2, action: "submit" as const, selector: `[data-qa-form=\"${form.id}\"]`, timeoutMs: 10000 }, { order: form.fields.length + 3, action: "assertVisible" as const, selector: `[data-qa-state=\"success\"]`, timeoutMs: 10000 }], assertions: [{ category: "form" as const, expected: form.successState, mandatory: true }], expectedOutcome: form.successState, failureCategory: "QA_FORM_VALIDATION_FAILURE", requiresAuth: input.planning.authentication.required, requiresForm: true, requiresDatabaseFixture: form.databaseWrite !== "No database write", timeoutMs: 60000 }));
  const scenarios = [...routeScenarios, ...formScenarios];
  return FunctionalQaPlanSchema.parse({ planId: randomUUID(), projectId: input.projectId, projectVersion: input.projectVersion, scenarios, selectedBriefChecksum: input.briefChecksum, selectedPlanningChecksum: input.planningChecksum, selectedDesignChecksum: input.designChecksum, policyVersion: input.policyVersion ?? "playwright-functional-v1" });
}
