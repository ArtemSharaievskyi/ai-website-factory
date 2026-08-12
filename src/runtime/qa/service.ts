import { randomUUID } from "node:crypto";
import { FunctionalQaError } from "./errors";
import { FunctionalQaReportSchema, FunctionalQaRunDiagnosticSchema, FunctionalQaScenarioResultSchema, FunctionalQaEvidenceSchema, type FunctionalQaScenario, type FunctionalQaServiceInput, type FunctionalQaReport, type FunctionalQaStep, type LocalServerHandle, type LocalServerLauncher, type PlaywrightFunctionalRunner } from "./contracts";
import { validateQaReadiness } from "./policy";
import { NodeLocalTestServer, chooseLoopbackPort, waitForLocalReadinessWithMetadata } from "./server";
import { PlaywrightBrowserRunner } from "./browser";
import { QualityCheckSchema } from "@/domain/quality/schema";
import { deriveFunctionalQaDiagnostics } from "./diagnostics";

const repairCategory: Record<string, string> = { QA_ROUTE_MISSING: "ROUTE_REPAIR", QA_ROUTE_RUNTIME_ERROR: "PAGE_COMPONENT_BACKEND_REPAIR", QA_ROUTE_ACCESS_MISMATCH: "AUTHORIZATION_ROUTE_REPAIR", QA_NAVIGATION_BROKEN: "NAVIGATION_REPAIR", QA_FORM_VALIDATION_FAILURE: "FORM_SERVER_ACTION_REPAIR", QA_AUTHORIZATION_FAILURE: "AUTHORIZATION_REPAIR", QA_BROWSER_RUNTIME_ERROR: "PAGE_COMPONENT_BACKEND_REPAIR", QA_EXTERNAL_REQUEST_BLOCKED: "INTEGRATION_SECURITY_REPAIR" };
const cleanupSafeSummary = (error: unknown) => error instanceof Error ? error.message.slice(0, 1000) : "Functional QA cleanup failed safely.";

const runDiagnostic = (state: { phase: "server-start" | "server-readiness" | "browser-launch" | "browser-context" | "page-create" | "scenario-dispatch" | "navigation" | "cleanup"; code: string; message: string; assignedPort?: number; serverCommand: string; workspaceReference: string; processSpawned: boolean; serverPidExists: boolean; serverReady: boolean; browserLaunched: boolean; contextCreated: boolean; pageCreated: boolean; scenarioDispatchStarted: boolean; firstNavigationAttempted: boolean; cancellationRequested: boolean; readinessProbeStarted: boolean; readinessAttempts: number; readinessSucceeded: boolean; serverExitedEarly: boolean; serverExitCode?: number | null; browserLaunchAttempted: boolean; firstScenarioId?: string; firstRoute?: string; firstStepId?: string; firstAssertion?: string; cleanupStarted: boolean; cleanupCompleted: boolean; timeoutOccurred: boolean }) => FunctionalQaRunDiagnosticSchema.parse({ category: state.code, lifecyclePhase: state.phase, ...(state.assignedPort ? { assignedPort: state.assignedPort } : {}), serverCommand: state.serverCommand, processSpawned: state.processSpawned, serverPidExists: state.serverPidExists, serverReady: state.serverReady, browserLaunched: state.browserLaunched, contextCreated: state.contextCreated, pageCreated: state.pageCreated, scenarioDispatchStarted: state.scenarioDispatchStarted, firstNavigationAttempted: state.firstNavigationAttempted, cancellationRequested: state.cancellationRequested, safeErrorCode: state.code, safeMessage: state.message, lifecycle: { ...(state.assignedPort ? { allocatedPort: state.assignedPort, serverCommandPort: state.assignedPort, readinessProbePort: state.assignedPort, browserBaseUrlPort: state.assignedPort } : {}), workspaceReference: state.workspaceReference.slice(-300), commandIdentity: state.serverCommand, readinessProbeStarted: state.readinessProbeStarted, readinessAttempts: state.readinessAttempts, readinessSucceeded: state.readinessSucceeded, serverExitedEarly: state.serverExitedEarly, ...(state.serverExitCode === undefined ? {} : { serverExitCode: state.serverExitCode }), browserLaunchAttempted: state.browserLaunchAttempted, ...(state.firstScenarioId ? { firstScenarioId: state.firstScenarioId } : {}), ...(state.firstRoute ? { firstRoute: state.firstRoute } : {}), ...(state.firstStepId ? { firstStepId: state.firstStepId } : {}), ...(state.firstAssertion ? { firstAssertion: state.firstAssertion } : {}), cleanupStarted: state.cleanupStarted, cleanupCompleted: state.cleanupCompleted, timeoutOccurred: state.timeoutOccurred, primaryFailurePhase: state.phase } });

export class FunctionalQaService {
  constructor(private readonly server: LocalServerLauncher = new NodeLocalTestServer(), private readonly browser: PlaywrightFunctionalRunner = new PlaywrightBrowserRunner()) {}

  async run(input: FunctionalQaServiceInput): Promise<FunctionalQaReport> {
    const qaWorkspace = input.qaWorkspace;
    try {
      if (qaWorkspace) {
        qaWorkspace.assertProjectPath(input.workspacePath);
        validateQaReadiness({ projectId: input.projectId, projectVersion: input.projectVersion, workspacePath: input.workspacePath, generatedProjectsRoot: input.generatedProjectsRoot, runtimeValidation: input.runtimeValidation, ...input.readiness });
        await qaWorkspace.activate();
      } else {
        validateQaReadiness({ projectId: input.projectId, projectVersion: input.projectVersion, workspacePath: input.workspacePath, generatedProjectsRoot: input.generatedProjectsRoot, runtimeValidation: input.runtimeValidation, ...input.readiness });
      }
    } catch (error) {
      if (qaWorkspace) await qaWorkspace.cleanup({ reason: "validation-failure", resourcesStopped: true, processesExited: true }).catch(() => undefined);
      throw error;
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const timeout = input.totalTimeoutMs ?? 180000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const relay = () => controller.abort();
    input.signal?.addEventListener("abort", relay, { once: true });
    let handle: LocalServerHandle | undefined;
    let status: FunctionalQaReport["status"] = "passed";
    const results: FunctionalQaReport["scenarios"] = [];
    let browserErrors: FunctionalQaReport["browserErrors"] = [];
    let assignedPort: number | undefined;
    let serverSpawned = false;
    let serverReady = false;
    let browserLaunched = false;
    let browserLaunchAttempted = false;
    let contextCreated = false;
    let pageCreated = false;
    let scenarioDispatchStarted = false;
    let firstNavigationAttempted = false;
    let readinessProbeStarted = false;
    let readinessAttempts = 0;
    let readinessSucceeded = false;
    let serverExitedEarly = false;
    let serverExitCode: number | null | undefined;
    let cleanupStarted = false;
    let cleanupCompleted = false;
    let firstScenario: FunctionalQaScenario | undefined;
    let firstStep: FunctionalQaStep | undefined;
    let activeScenario: FunctionalQaScenario | undefined;
    let activeStepIndex: number | undefined;
    let runLevelFailure: { safeErrorCode: string; safeSummary: string } | undefined;
    let runLevelDiagnostic: FunctionalQaReport["runLevelDiagnostic"];
    let qaWorkspaceCleanup: FunctionalQaReport["qaWorkspaceCleanup"];
    let browserClosed = true;
    let processesExited = true;

    const recordCleanupFailure = (code: string, summary: string) => {
      status = "failed";
      if (!runLevelFailure) {
        runLevelFailure = { safeErrorCode: code, safeSummary: summary };
        runLevelDiagnostic = runDiagnostic({ phase: "cleanup", code, message: summary, assignedPort, serverCommand: `npm run start:test -- --hostname 127.0.0.1 --port ${assignedPort ?? "unknown"}`, workspaceReference: input.workspacePath, processSpawned: serverSpawned, serverPidExists: Boolean(handle?.pid && serverSpawned), serverReady, browserLaunched, contextCreated, pageCreated, scenarioDispatchStarted, firstNavigationAttempted, cancellationRequested: Boolean(input.signal?.aborted), readinessProbeStarted, readinessAttempts, readinessSucceeded, serverExitedEarly, serverExitCode, browserLaunchAttempted, firstScenarioId: firstScenario?.scenarioId, firstRoute: firstScenario?.startRoute, firstStepId: firstStep?.stepId, firstAssertion: firstScenario?.assertions[0]?.category, cleanupStarted, cleanupCompleted: false, timeoutOccurred: code === "QA_TIMEOUT" });
      }
    };

    try {
      if (input.signal?.aborted) throw new FunctionalQaError("QA_CANCELLED", "QA was cancelled before server start.");
      assignedPort = await chooseLoopbackPort();
      handle = await this.server.start({ workspacePath: input.workspacePath, port: assignedPort, signal: controller.signal });
      serverSpawned = true;
      readinessProbeStarted = true;
      if (this.server.waitForReady) {
        readinessAttempts = 1;
        await this.server.waitForReady(handle, Math.min(timeout, 30000), controller.signal);
      } else {
        const readiness = await waitForLocalReadinessWithMetadata(handle.baseUrl, handle.port, "/", Math.min(timeout, 30000), controller.signal);
        readinessAttempts = readiness.attempts;
      }
      serverReady = true;
      readinessSucceeded = true;
      browserLaunchAttempted = true;
      await this.browser.launch({ baseUrl: handle.baseUrl, port: handle.port, signal: controller.signal });
      browserLaunched = true;
      contextCreated = true;
      pageCreated = true;
      for (const scenario of input.plan.scenarios) {
        activeScenario = scenario;
        if (!firstScenario) firstScenario = scenario;
        activeStepIndex = undefined;
        if (controller.signal.aborted) throw new FunctionalQaError(input.signal?.aborted ? "QA_CANCELLED" : "QA_TIMEOUT", "Functional QA was interrupted.");
        const result = await this.runScenario(scenario, controller.signal, (index, step) => { activeStepIndex = index; if (step.action === "navigate") firstNavigationAttempted = true; scenarioDispatchStarted = true; });
        results.push(result);
        activeScenario = undefined;
        activeStepIndex = undefined;
        if (result.status === "failed") { status = "failed"; break; }
      }
      browserErrors = await this.browser.readConsoleErrors();
      if (browserErrors.some((error) => !error.approvedNoise)) status = "failed";
      if (input.signal?.aborted) status = "cancelled";
      else if (controller.signal.aborted) status = "failed";
    } catch (error) {
      status = input.signal?.aborted ? "cancelled" : "failed";
      const lifecyclePhase = !serverSpawned ? "server-start" : !serverReady ? "server-readiness" : !browserLaunched ? "browser-launch" : !contextCreated ? "browser-context" : !pageCreated ? "page-create" : !scenarioDispatchStarted ? "scenario-dispatch" : "cleanup";
      const code = error instanceof FunctionalQaError ? error.code : lifecyclePhase === "server-start" ? "QA_SERVER_START_FAILED" : lifecyclePhase === "server-readiness" ? "QA_SERVER_READY_TIMEOUT" : lifecyclePhase === "browser-launch" ? "QA_BROWSER_LAUNCH_FAILED" : "QA_RUNNER_INTERNAL_FAILED";
      const summary = cleanupSafeSummary(error);
      if (handle && serverSpawned && !serverReady) serverExitedEarly = !(await this.server.isRunning(handle).catch(() => false));
      if (activeScenario) results.push(this.failedScenarioResult(activeScenario, activeStepIndex, code, summary));
      else { runLevelFailure = { safeErrorCode: code, safeSummary: summary }; runLevelDiagnostic = runDiagnostic({ phase: lifecyclePhase, code, message: summary, assignedPort, serverCommand: `npm run start:test -- --hostname 127.0.0.1 --port ${assignedPort ?? "unknown"}`, workspaceReference: input.workspacePath, processSpawned: serverSpawned, serverPidExists: Boolean(handle?.pid && serverSpawned), serverReady, browserLaunched, contextCreated, pageCreated, scenarioDispatchStarted, firstNavigationAttempted, cancellationRequested: Boolean(input.signal?.aborted), readinessProbeStarted, readinessAttempts, readinessSucceeded, serverExitedEarly, serverExitCode, browserLaunchAttempted, firstScenarioId: firstScenario?.scenarioId, firstRoute: firstScenario?.startRoute, firstStepId: firstScenario?.steps[0]?.stepId, firstAssertion: firstScenario?.assertions[0]?.category, cleanupStarted, cleanupCompleted, timeoutOccurred: code === "QA_TIMEOUT" }); }
    } finally {
      cleanupStarted = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", relay);
      try { await this.browser.close(); } catch { browserClosed = false; }
      if (handle) {
        try { await this.server.stop(handle); } catch {
          processesExited = false;
          recordCleanupFailure("QA_PROCESS_TERMINATION_FAILED", "An owned QA server process did not complete shutdown.");
        }
      }
      if (qaWorkspace) {
        const reason = input.signal?.aborted ? "cancellation" : controller.signal.aborted ? "timeout" : status === "passed" ? "success" : "failure";
        try {
          qaWorkspaceCleanup = await qaWorkspace.cleanup({ reason, resourcesStopped: browserClosed, processesExited });
          if (!qaWorkspaceCleanup.removed || !qaWorkspaceCleanup.verifiedAbsent) recordCleanupFailure(qaWorkspaceCleanup.failureCode ?? "QA_WORKSPACE_CLEANUP_FAILED", "The owned QA workspace was not verified absent after bounded cleanup.");
        } catch (error) {
          recordCleanupFailure(error instanceof FunctionalQaError ? error.code : "QA_WORKSPACE_CLEANUP_FAILED", cleanupSafeSummary(error));
        }
      }
      cleanupCompleted = browserClosed && processesExited && (!qaWorkspace || Boolean(qaWorkspaceCleanup?.removed && qaWorkspaceCleanup.verifiedAbsent));
    }

    if (runLevelFailure && runLevelDiagnostic) runLevelDiagnostic = FunctionalQaRunDiagnosticSchema.parse({ ...runLevelDiagnostic, lifecycle: { ...runLevelDiagnostic.lifecycle, cleanupStarted, cleanupCompleted } });
    if (runLevelDiagnostic && handle?.lifecycle) { const lifecycle = handle.lifecycle; runLevelDiagnostic = FunctionalQaRunDiagnosticSchema.parse({ ...runLevelDiagnostic, lifecycle: { ...runLevelDiagnostic.lifecycle, executableIdentity: lifecycle.executableIdentity, hostname: lifecycle.hostname, envPort: lifecycle.envPort, readinessRoute: lifecycle.readinessRoute, readinessAttempts: lifecycle.readinessAttempts, readinessElapsedMs: lifecycle.readinessElapsedMs, readinessSucceeded: lifecycle.readinessSucceeded, serverExitedEarly: lifecycle.exitCode !== undefined && lifecycle.exitCode !== null, serverExitCode: lifecycle.exitCode, stdoutBytes: lifecycle.stdoutBytes, stderrBytes: lifecycle.stderrBytes, stdoutSummary: lifecycle.stdoutSummary, stderrSummary: lifecycle.stderrSummary, nextReadyTextObserved: lifecycle.nextReadyTextObserved } }); }
    const passedCount = results.filter((result) => result.status === "passed").length;
    const failedCount = results.filter((result) => result.status === "failed").length;
    const skippedCount = results.filter((result) => result.status === "skipped" || result.status === "cancelled").length;
    const diagnostics = deriveFunctionalQaDiagnostics({ plan: input.plan, results, browserErrors });
    const failure = runLevelFailure?.safeErrorCode ?? results.find((result) => result.safeFailureCode)?.safeFailureCode ?? diagnostics[0]?.category ?? browserErrors.find((error) => error.safeErrorCode)?.safeErrorCode;
    const reportStatus = status === "passed" && failedCount === 0 && results.length === input.plan.scenarios.length ? "passed" : status === "cancelled" ? "cancelled" : "failed";
    const qualityCheck = QualityCheckSchema.parse({ name: "e2e", status: reportStatus === "passed" ? "passed" : reportStatus === "cancelled" ? "skipped" : "failed", startedAt, completedAt: new Date().toISOString(), resultSummary: `${passedCount} passed, ${failedCount} failed, ${skippedCount} skipped functional QA scenarios.`, ...(failure ? { safeFailureCode: failure } : {}), ...(reportStatus === "cancelled" ? { skippedReason: "Functional QA was cancelled." } : {}), attempt: 0, required: true, command: "Playwright functional QA" });
    return FunctionalQaReportSchema.parse({ runId, projectId: input.projectId, projectVersion: input.projectVersion, taskId: input.taskId, runtimeValidationRunId: input.runtimeValidation?.validationRunId ?? randomUUID(), startedAt, completedAt: new Date().toISOString(), status: reportStatus, scenarios: results, passedCount, failedCount, skippedCount, browserErrors, diagnostics, unexpectedExternalRequests: browserErrors.filter((error) => error.kind === "external-request").map((error) => error.safeSummary), ...(failure ? { failureCategory: `QA_${repairCategory[failure] ? repairCategory[failure].replace(/[^A-Z0-9]+/g, "_") : "FUNCTIONAL_FAILURE"}` } : {}), ...(runLevelFailure ? { runLevelFailure } : {}), ...(runLevelDiagnostic ? { runLevelDiagnostic } : {}), repairEligible: reportStatus !== "passed", qualityCheck, ...(qaWorkspaceCleanup ? { qaWorkspaceCleanup } : {}), policyVersion: input.plan.policyVersion, runtimeValidationPackageChecksum: input.runtimeValidation?.packageChecksum ?? "0".repeat(64), runtimeValidationLockfileChecksum: input.runtimeValidation?.lockfileChecksum ?? "0".repeat(64), selectedBriefChecksum: input.plan.selectedBriefChecksum, selectedPlanningChecksum: input.plan.selectedPlanningChecksum, selectedDesignChecksum: input.plan.selectedDesignChecksum, warnings: [] });
  }

  private async runScenario(scenario: FunctionalQaScenario, signal: AbortSignal, onStep: (index: number, step: FunctionalQaStep) => void) { const startedAt = new Date().toISOString(); const started = Date.now(); const evidence: FunctionalQaReport["scenarios"][number]["evidence"] = []; try { for (let index = 0; index < scenario.steps.length; index++) { const step = scenario.steps[index]!; onStep(index, step); if (signal.aborted) throw new FunctionalQaError("QA_CANCELLED", "Scenario cancelled."); const stepStarted = Date.now(); await this.runStep(step, signal); evidence.push(FunctionalQaEvidenceSchema.parse({ scenarioId: scenario.scenarioId, stepId: step.stepId, stepIndex: index, action: step.action, result: "passed", route: step.route ?? step.expectedUrl, expectedState: step.expectedText, actualSafeSummary: "Approved functional step passed.", durationMs: Date.now() - stepStarted })); } return FunctionalQaScenarioResultSchema.parse({ scenarioId: scenario.scenarioId, scenarioType: scenario.scenarioType, route: scenario.startRoute, status: "passed", startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, evidence, summary: "Approved functional scenario passed." }); } catch (error) { const failedIndex = evidence.length; const step = scenario.steps[failedIndex]; const code = error instanceof FunctionalQaError ? error.code : scenario.failureCategory; evidence.push(FunctionalQaEvidenceSchema.parse({ scenarioId: scenario.scenarioId, stepId: step?.stepId, stepIndex: failedIndex, action: step?.action ?? "waitFor", result: "failed", route: step?.route ?? step?.expectedUrl ?? scenario.startRoute, expectedState: step?.expectedText, actualSafeSummary: "Approved functional scenario failed safely.", durationMs: Date.now() - started, safeErrorCode: code.startsWith("QA_") ? code : scenario.failureCategory })); return FunctionalQaScenarioResultSchema.parse({ scenarioId: scenario.scenarioId, scenarioType: scenario.scenarioType, route: scenario.startRoute, status: "failed", startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, evidence, safeFailureCode: code.startsWith("QA_") ? code : scenario.failureCategory, summary: error instanceof Error ? error.message.slice(0, 1000) : "Functional scenario failed safely." }); } }
  private async runStep(step: FunctionalQaStep, signal: AbortSignal) { if (signal.aborted) throw new FunctionalQaError("QA_CANCELLED", "Functional QA was cancelled."); const b = this.browser; switch (step.action) { case "navigate": await b.navigate(step.route!, step.timeoutMs); break; case "fill": await b.fill(step.selector!, step.value ?? "", step.timeoutMs); break; case "click": await b.click(step.selector!, step.timeoutMs); break; case "submit": await b.submit(step.selector!, step.timeoutMs); break; case "select": await b.select(step.selector!, step.value ?? "", step.timeoutMs); break; case "check": await b.check(step.selector!, step.timeoutMs); break; case "waitFor": await b.waitFor({ selector: step.selector, timeoutMs: step.timeoutMs }); break; case "assertText": await b.assertText(step.selector!, step.expectedText!, step.timeoutMs); break; case "assertVisible": await b.assertVisible(step.selector!, step.timeoutMs); break; case "assertUrl": await b.assertUrl(step.expectedUrl ?? step.route!); break; case "assertStatus": await b.assertStatus(step.expectedStatus!); break; } }
  private failedScenarioResult(scenario: FunctionalQaScenario, stepIndex: number | undefined, code: string, summary: string) { const now = new Date().toISOString(); const step = stepIndex === undefined ? undefined : scenario.steps[stepIndex]; return FunctionalQaScenarioResultSchema.parse({ scenarioId: scenario.scenarioId, scenarioType: scenario.scenarioType, route: scenario.startRoute, status: "failed", startedAt: now, completedAt: now, durationMs: 0, evidence: [FunctionalQaEvidenceSchema.parse({ scenarioId: scenario.scenarioId, stepId: step?.stepId, stepIndex: stepIndex ?? 0, action: step?.action ?? "waitFor", result: "failed", route: step?.route ?? step?.expectedUrl ?? scenario.startRoute, expectedState: step?.expectedText, actualSafeSummary: "Approved functional scenario failed safely.", durationMs: 0, safeErrorCode: code.startsWith("QA_") ? code : scenario.failureCategory })], safeFailureCode: code.startsWith("QA_") ? code : scenario.failureCategory, summary }); }
}

export const createFunctionalQaService = () => new FunctionalQaService();
