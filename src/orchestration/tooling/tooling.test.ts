import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { implementationAgentDefinition, leadAgentDefinition } from "@/agents/catalog";
import { AgentTaskSchema, type AgentTask } from "@/domain/tasks/schema";
import { ToolRequestSchema } from "@/domain/tooling/schema";
import { isPathWithinToolScopes, isSafeToolRelativePath } from "@/domain/tooling/path-policy";
import { RuntimeCommandResultSchema, type GeneratedProjectRuntimeValidator } from "@/runtime/validation/contracts";
import { FunctionalQaReportSchema } from "@/runtime/qa/contracts";
import { authorizeToolRequest, resolveAuthorizedToolOperations, taskCapabilitiesFor } from "./authority";
import { boundToolText, executeControlledRuntimeOperation, registeredOutputToToolResult, runtimeResultToToolResult } from "./executors";
import { createHostToolContext, isTrustedToolHostContext, type ToolHostContext } from "./host-context";
import { CAPABILITY_REGISTRY, TOOL_REGISTRY, validateToolRegistry } from "./registry";
import { resolveTools, validateToolPolicy } from "@/orchestration/orchestrator/tools";

const projectId = "11111111-1111-4111-8111-111111111111";
const workspace = { projectId, projectVersion: 1, taskId: "22222222-2222-4222-8222-222222222222", workspaceIdentity: "workspace:project-1:v1", workspaceReference: "project-1/v1/.staging/task", allowedFileScopes: ["src/**"], current: true, mutable: true };

function task(overrides: Partial<AgentTask> = {}) {
  return AgentTaskSchema.parse({ id: workspace.taskId, projectId, projectVersion: 1, role: "implementation", taskType: "implement-page", title: "Implement page", objective: "Implement approved page", inputs: [], expectedOutputs: [], allowedSkills: [], allowedTools: ["Context7-read", "shadcn-registry-read", "codebase-memory-read"], fileScopes: ["src/**"], dependencies: [], status: "ready", attempt: 0, maxAttempts: 2, createdAt: "2026-01-01T00:00:00.000Z", requiredCapabilities: ["docs.library-read", "ui.registry-read", "codebase.structure-read", "source.inspect"], ...overrides });
}

function host(scope = workspace, trustedExecutorIds: readonly ("openai-structured-output-provider" | "context7-documentation-service" | "shadcn-registry-service" | "codebase-memory-service" | "generated-runtime-validator" | "functional-qa-service")[] = [], canonicalTask: AgentTask = task({ id: scope.taskId, projectId: scope.projectId, projectVersion: scope.projectVersion })) {
  const agentDefinition = implementationAgentDefinition.supportedTaskTypes.includes(canonicalTask.taskType) ? implementationAgentDefinition : undefined;
  return createHostToolContext({ currentScope: scope, trustedExecutorIds, task: { id: canonicalTask.id, projectId: canonicalTask.projectId, projectVersion: canonicalTask.projectVersion, taskType: canonicalTask.taskType, taskCapabilities: taskCapabilitiesFor(canonicalTask), fileScopes: canonicalTask.fileScopes, allowedTools: canonicalTask.allowedTools }, agentDefinition });
}

function validationTask(overrides: Partial<AgentTask> = {}) {
  return task({ taskType: "validate-typecheck", role: "qa-release", allowedTools: ["filesystem-read"], requiredCapabilities: ["validation.typecheck", "dependency.materialize"], fileScopes: [], ...overrides });
}

function request(overrides: Record<string, unknown> = {}) {
  return ToolRequestSchema.parse({ requestId: randomUUID(), projectId, projectVersion: 1, taskId: workspace.taskId, toolId: "context7-read", operationId: "query-documentation", input: { packageName: "next", resolvedLibraryId: "nextjs", topic: "server components", reason: "Read the approved API reference." }, ...overrides });
}

describe("Phase 7B developer tooling authority", () => {
  it("has a deterministic registry with no generic mutation or shell operations", () => {
    expect(validateToolRegistry()).toEqual({ tools: 6, operations: 15, capabilities: 10 });
    const operations = Object.values(TOOL_REGISTRY).flatMap((tool) => tool.operations.map((operation) => operation.operationId));
    expect(operations).not.toEqual(expect.arrayContaining(["write-file", "edit-file", "delete-file", "move-file", "shell", "terminal", "execute-command"]));
    expect(CAPABILITY_REGISTRY.every((capability) => capability.eligibleOperations.length > 0)).toBe(true);
  });

  it("allows only the intersection of current task capability, agent permission, and scope", () => {
    const decision = authorizeToolRequest({ request: request(), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition });
    expect(decision).toMatchObject({ allowed: true, code: "ALLOWED", toolId: "context7-read", operationId: "query-documentation", hostContextIdentity: `host:implementation:${projectId}:1:${workspace.taskId}` });
    expect(resolveAuthorizedToolOperations({ task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition })).toEqual([
      { toolId: "context7-read", operationId: "resolve-library" },
      { toolId: "context7-read", operationId: "query-documentation" },
      { toolId: "shadcn-registry-read", operationId: "resolve-component" },
      { toolId: "shadcn-registry-read", operationId: "fetch-component-reference" },
      { toolId: "codebase-memory-read", operationId: "ensure-index" },
      { toolId: "codebase-memory-read", operationId: "find-symbol" },
      { toolId: "codebase-memory-read", operationId: "get-relevant-source" },
    ]);
  });

  it("requires a host-created context and rejects structural forgery", () => {
    const trusted = host();
    const forged = { ...trusted } as unknown as ToolHostContext;
    expect(isTrustedToolHostContext(trusted)).toBe(true);
    expect(isTrustedToolHostContext(forged)).toBe(false);
    expect(authorizeToolRequest({ request: request(), task: task(), hostContext: forged, agentDefinition: implementationAgentDefinition })).toMatchObject({ allowed: false, code: "HOST_CONTEXT_UNTRUSTED" });
    expect(() => createHostToolContext({ currentScope: workspace, trustedExecutorIds: [], task: { id: "44444444-4444-4444-8444-444444444444", projectId, projectVersion: 1, taskType: "implement-page", taskCapabilities: taskCapabilitiesFor(task()), fileScopes: ["src/**"], allowedTools: task().allowedTools } })).toThrow(/does not match/);
  });

  it("denies unknown tools, unknown operations, missing agent permissions, missing task capabilities, and stale identity", () => {
    expect(authorizeToolRequest({ request: request({ toolId: "not-registered" }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("UNKNOWN_TOOL");
    expect(authorizeToolRequest({ request: request({ operationId: "execute-command" }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("UNKNOWN_OPERATION");
    expect(authorizeToolRequest({ request: request(), task: task(), hostContext: host(), agentDefinition: leadAgentDefinition }).code).toBe("AGENT_TOOL_NOT_ALLOWED");
    const missingCapabilityTask = task({ requiredCapabilities: ["source.inspect"] });
    expect(authorizeToolRequest({ request: request(), task: missingCapabilityTask, hostContext: host(workspace, [], missingCapabilityTask), agentDefinition: implementationAgentDefinition }).code).toBe("TASK_CAPABILITY_MISSING");
    expect(authorizeToolRequest({ request: request(), task: task({ status: "cancelled", completedAt: "2026-01-01T00:01:00.000Z" }), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("TASK_NOT_CURRENT");
    expect(authorizeToolRequest({ request: request({ projectId: "33333333-3333-4333-8333-333333333333" }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("PROJECT_SCOPE_INVALID");
    expect(authorizeToolRequest({ request: request({ projectVersion: 2 }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("PROJECT_SCOPE_INVALID");
    expect(authorizeToolRequest({ request: request({ taskId: "44444444-4444-4444-8444-444444444444" }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("PROJECT_SCOPE_INVALID");
    expect(authorizeToolRequest({ request: request({ toolId: "Context7-read" }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("ALLOWED");
    const mismatchedScopeTask = validationTask({ id: "33333333-3333-4333-8333-333333333333" });
    expect(authorizeToolRequest({ request: request({ toolId: "generated-runtime-validation", operationId: "typecheck", input: {} }), task: mismatchedScopeTask, hostContext: host({ ...workspace, taskId: "33333333-3333-4333-8333-333333333333", allowedFileScopes: [] }, ["generated-runtime-validator"], mismatchedScopeTask) }).code).toBe("PROJECT_SCOPE_INVALID");
    expect(authorizeToolRequest({ request: request(), task: task(), hostContext: host({ ...workspace, current: false }), agentDefinition: implementationAgentDefinition }).code).toBe("TASK_SCOPE_INVALID");
    const runtimeTask = validationTask();
    expect(authorizeToolRequest({ request: request({ toolId: "generated-runtime-validation", operationId: "typecheck", input: {} }), task: runtimeTask, hostContext: host({ ...workspace, allowedFileScopes: [] }, [], runtimeTask) }).code).toBe("EXECUTOR_NOT_TRUSTED");
    expect(authorizeToolRequest({ request: request({ toolId: "generated-runtime-validation", operationId: "typecheck", input: {} }), task: runtimeTask, hostContext: host({ ...workspace, allowedFileScopes: [], mutable: false }, ["generated-runtime-validator"], runtimeTask) }).code).toBe("TASK_SCOPE_INVALID");
  });

  it("rejects forged authority, traversal, secrets, arbitrary URLs, raw commands, and package arguments", () => {
    expect(authorizeToolRequest({ request: request({ input: { capability: "validation.build" } }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("INPUT_NOT_ALLOWED");
    expect(authorizeToolRequest({ request: request({ toolId: "codebase-memory-read", operationId: "get-relevant-source", input: { file: "../outside.ts" } }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("INPUT_NOT_ALLOWED");
    expect(authorizeToolRequest({ request: request({ toolId: "codebase-memory-read", operationId: "get-relevant-source", input: { file: ".env" } }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("INPUT_NOT_ALLOWED");
    expect(authorizeToolRequest({ request: request({ toolId: "shadcn-registry-read", operationId: "resolve-component", input: { registryUrl: "https://evil.example" } }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("INPUT_NOT_ALLOWED");
    const commandTask = validationTask();
    expect(authorizeToolRequest({ request: request({ toolId: "generated-runtime-validation", operationId: "typecheck", input: { command: "npm run build && whoami" } }), task: commandTask, hostContext: host({ ...workspace, allowedFileScopes: [] }, ["generated-runtime-validator"], commandTask) }).code).toBe("INPUT_NOT_ALLOWED");
    const foundationTask = task({ taskType: "implement-project-foundation", allowedTools: ["filesystem-read", "filesystem-write"], requiredCapabilities: ["dependency.materialize"] });
    expect(authorizeToolRequest({ request: request({ toolId: "generated-runtime-validation", operationId: "install-locked", input: { package: "unapproved-package" } }), task: foundationTask, hostContext: host(workspace, ["generated-runtime-validator"], foundationTask) }).code).toBe("INPUT_NOT_ALLOWED");
    expect(authorizeToolRequest({ request: request({ toolId: "codebase-memory-read", operationId: "get-relevant-source", input: { file: "src/page.ts", relativePath: "src2/secret.ts" } }), task: task(), hostContext: host(), agentDefinition: implementationAgentDefinition }).code).toBe("INPUT_NOT_ALLOWED");
    const narrowerTask = task({ fileScopes: ["src/components/**"] });
    expect(authorizeToolRequest({ request: request({ toolId: "codebase-memory-read", operationId: "get-relevant-source", input: { file: "src/page.ts" } }), task: narrowerTask, hostContext: host(workspace, [], narrowerTask), agentDefinition: implementationAgentDefinition }).code).toBe("INPUT_NOT_ALLOWED");
  });

  it("authorizes a host-controlled runtime operation without exposing command arguments", async () => {
    const command = RuntimeCommandResultSchema.parse({ commandId: randomUUID(), validationRunId: randomUUID(), projectId, projectVersion: 1, commandType: "typecheck", executableIdentity: "npm", safeArgsSummary: "run typecheck", cwdReference: "project-1/v1/.staging/task", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z", durationMs: 1000, exitCode: 0, terminationReason: "completed", stdoutSummary: "passed\nOPENAI_API_KEY=sk-123456789012345", stderrSummary: "", stdoutBytes: 40, stderrBytes: 0, outputTruncated: false, timeout: false, cancelled: false, passed: true, sourceChecksum: "a".repeat(64), diagnostics: [] });
    const validator = { runTypecheck: async () => command } as unknown as GeneratedProjectRuntimeValidator;
    const runtimeTask = validationTask();
    const authority = authorizeToolRequest({ request: request({ toolId: "generated-runtime-validation", operationId: "typecheck", input: {} }), task: runtimeTask, hostContext: host({ ...workspace, allowedFileScopes: [] }, ["generated-runtime-validator"], runtimeTask) });
    expect(authority.allowed).toBe(true);
    const result = await executeControlledRuntimeOperation({ operationId: "typecheck", runtimeInput: { projectId, projectVersion: 1, workspacePath: "C:\\generated\\project-1\\.staging\\task", generatedProjectsRoot: "C:\\generated" }, validator });
    expect(result.status).toBe("passed");
    expect(result.summary).toContain("[REDACTED]");
    expect(result.summary).not.toContain("sk-123456789012345");
  });

  it("bounds output and supports zero-tool tasks without forcing a tool", () => {
    const bounded = boundToolText(`${"x".repeat(20_000)}\nBearer secret-token`, 1_000, 20_000);
    expect(bounded.truncated).toBe(true);
    expect(bounded.value).not.toContain("secret-token");
    expect(resolveAuthorizedToolOperations({ task: task({ taskType: "implement-project-foundation", allowedTools: ["filesystem-read"], requiredCapabilities: [] }), hostContext: host(), agentDefinition: implementationAgentDefinition })).toEqual([]);
  });

  it("keeps source selectors segment-aware and denies sensitive paths", () => {
    expect(isSafeToolRelativePath("src/page.ts")).toBe(true);
    expect(isSafeToolRelativePath("C:\\project\\src\\page.ts")).toBe(false);
    expect(isSafeToolRelativePath("/project/src/page.ts")).toBe(false);
    expect(isSafeToolRelativePath("src/../outside.ts")).toBe(false);
    expect(isSafeToolRelativePath(".env.local")).toBe(false);
    expect(isSafeToolRelativePath("src/.qa-foundation-old/report.json")).toBe(false);
    expect(isSafeToolRelativePath("src/node_modules/pkg/index.ts")).toBe(false);
    expect(isPathWithinToolScopes("src/page.ts", ["src/**"])).toBe(true);
    expect(isPathWithinToolScopes("src2/page.ts", ["src/**"])).toBe(false);
    expect(isPathWithinToolScopes("src/page.ts", ["src/*"])).toBe(true);
    expect(isPathWithinToolScopes("src/nested/page.ts", ["src/*"])).toBe(false);
  });

  it("keeps generated task tool policy and capability authority aligned", () => {
    const resolved = resolveTools("validate-typecheck");
    const generated = task({ taskType: "validate-typecheck", role: "qa-release", allowedTools: resolved.allowed, requiredCapabilities: undefined, fileScopes: [] });
    validateToolPolicy(generated);
    expect(generated.allowedTools).toContain("generated-runtime-validation");
    expect(taskCapabilitiesFor(generated)).toEqual(expect.arrayContaining(["validation.typecheck", "dependency.materialize"]));
    expect(resolveTools("validate-functional-flow").allowed).toEqual(expect.arrayContaining(["Playwright-functional", "playwright-functional-qa"]));
  });

  it("converts failed, cancelled, redacted, and oversized runtime output into bounded results", () => {
    const command = RuntimeCommandResultSchema.parse({ commandId: randomUUID(), validationRunId: randomUUID(), projectId, projectVersion: 1, commandType: "typecheck", executableIdentity: "npm", safeArgsSummary: "run typecheck", cwdReference: "project-1/v1/.staging/task", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z", durationMs: 1000, exitCode: 1, terminationReason: "completed", stdoutSummary: "", stderrSummary: "OPENAI_API_KEY=sk-123456789012345", stdoutBytes: 40, stderrBytes: 40, outputTruncated: false, timeout: false, cancelled: false, passed: false, sourceChecksum: "a".repeat(64), diagnostics: Array.from({ length: 50 }, (_, index) => ({ relativePath: `src/${index}.ts`, safeMessage: "x".repeat(500) })) });
    const failed = runtimeResultToToolResult("typecheck", command);
    expect(failed.status).toBe("failed");
    expect(failed.retryable).toBe(true);
    expect(failed.stderr).not.toContain("sk-123456789012345");
    expect(failed.outputTruncated).toBe(true);
    expect(failed.data).toHaveProperty("truncated", true);
    const cancelled = runtimeResultToToolResult("typecheck", RuntimeCommandResultSchema.parse({ ...command, exitCode: null, terminationReason: "cancelled", cancelled: true, passed: false }));
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.retryable).toBe(false);
  });

  it("validates typed external outputs as untrusted and dispatches every fixed runtime family", async () => {
    const external = registeredOutputToToolResult("context7-read", "resolve-library", { packageName: "next", resolvedLibraryId: "nextjs", versionUnresolved: false, source: "fixed-stack" });
    expect(external.contentTrust).toBe("UNTRUSTED_EXTERNAL");
    expect(external.data).toHaveProperty("structured");
    const qaReport = FunctionalQaReportSchema.parse({ runId: randomUUID(), projectId, projectVersion: 1, taskId: workspace.taskId, runtimeValidationRunId: randomUUID(), startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z", status: "passed", scenarios: [], passedCount: 0, failedCount: 0, skippedCount: 0, browserErrors: [], diagnostics: [], unexpectedExternalRequests: [], repairEligible: false, qualityCheck: { name: "e2e", status: "passed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z", resultSummary: "No scenarios were scheduled.", attempt: 0, required: true, command: "Playwright functional QA" }, policyVersion: "functional-qa-diagnostics-v13", runtimeValidationPackageChecksum: "a".repeat(64), runtimeValidationLockfileChecksum: "b".repeat(64), selectedBriefChecksum: "c".repeat(64), selectedPlanningChecksum: "d".repeat(64), selectedDesignChecksum: "e".repeat(64), warnings: [] });
    const qaResult = registeredOutputToToolResult("playwright-functional-qa", "run-functional-flow", qaReport);
    expect(qaResult).toMatchObject({ operationId: "run-functional-flow", contentTrust: "UNTRUSTED_EXTERNAL" });
    expect(() => registeredOutputToToolResult("playwright-functional-qa", "run-functional-flow", { invalid: true })).toThrow();
    const command = (commandType: "npm-lockfile" | "npm-ci" | "lint" | "typecheck" | "tests" | "build") => RuntimeCommandResultSchema.parse({ commandId: randomUUID(), validationRunId: randomUUID(), projectId, projectVersion: 1, commandType, executableIdentity: "npm", safeArgsSummary: "fixed", cwdReference: "project-1/v1/.staging/task", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z", durationMs: 1000, exitCode: 0, terminationReason: "completed", stdoutSummary: "passed", stderrSummary: "", stdoutBytes: 6, stderrBytes: 0, outputTruncated: false, timeout: false, cancelled: false, passed: true, sourceChecksum: "a".repeat(64), diagnostics: [] });
    const calls: string[] = [];
    const validator = { prepareNpmLockfile: async () => { calls.push("install-locked"); return command("npm-lockfile"); }, runNpmCi: async () => { calls.push("npm-ci"); return command("npm-ci"); }, runLint: async () => { calls.push("lint"); return command("lint"); }, runTypecheck: async () => { calls.push("typecheck"); return command("typecheck"); }, runTests: async () => { calls.push("unit-test"); return command("tests"); }, runBuild: async () => { calls.push("build"); return command("build"); } } as unknown as GeneratedProjectRuntimeValidator;
    for (const [operationId, commandType] of [["install-locked", "npm-lockfile"], ["npm-ci", "npm-ci"], ["lint", "lint"], ["typecheck", "typecheck"], ["unit-test", "tests"], ["build", "build"]] as const) {
      await expect(executeControlledRuntimeOperation({ operationId, runtimeInput: { projectId, projectVersion: 1, workspacePath: "C:\\generated\\project-1\\.staging\\task", generatedProjectsRoot: "C:\\generated" }, validator })).resolves.toMatchObject({ status: "passed", contentTrust: "HOST_VALIDATED", operationId, data: { structured: { commandType } } });
      expect(calls.at(-1)).toBe(operationId);
    }
  });
});
