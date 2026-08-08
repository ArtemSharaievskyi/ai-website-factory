import type { AgentTask } from "../domain/tasks/schema";
import type { ImplementationChangeProposal } from "./contracts";
import { ImplementationError } from "./errors";
import { BACKEND_TASK_TYPES, validateBackendProposal, type BackendPlans } from "./backend";
import { FOUNDATION_PACKAGE_POLICY } from "./foundation-policy";
export const SUPPORTED_IMPLEMENTATION_TASK_TYPES = new Set(["prepare-workspace", "implement-project-foundation", "implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "integrate-content", "integrate-assets", "implement-seo", "write-unit-tests", "write-integration-tests", "write-e2e-tests", ...BACKEND_TASK_TYPES]);
export function validateSupportedTask(task: AgentTask) { if (!SUPPORTED_IMPLEMENTATION_TASK_TYPES.has(task.taskType) || (task.taskType === "implement-form" && !task.allowedTools.includes("shadcn-registry-read"))) throw new ImplementationError("IMPLEMENTATION_TASK_TYPE_UNSUPPORTED", "This Implementation Agent foundation does not support the requested task type without the relevant UI reference permission."); }
export function validateTaskResult(task: AgentTask, proposal: ImplementationChangeProposal, backendPlans: BackendPlans = {}) {
  if (task.taskType === "implement-project-foundation" && task.requiredArtifacts?.length) {
    const paths = new Set(proposal.operations.map((operation) => operation.relativePath.replaceAll("\\", "/")));
    const missing = task.requiredArtifacts.filter((path) => path !== "package-lock.json" && !paths.has(path));
    if (missing.length) throw new ImplementationError("IMPLEMENTATION_EXPECTED_FILE_MISSING", `Project foundation is missing required runtime artifacts: ${missing.join(", ")}.`);
    const packageOperation = proposal.operations.find((operation) => operation.relativePath.replaceAll("\\", "/") === "package.json" && "content" in operation);
    if (!packageOperation || !("content" in packageOperation)) throw new ImplementationError("IMPLEMENTATION_EXPECTED_FILE_MISSING", "Project foundation must propose package.json content.");
    let packageJson: { packageManager?: unknown; scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    try { packageJson = JSON.parse(packageOperation.content) as typeof packageJson; } catch (error) { throw new ImplementationError("PACKAGE_JSON_INVALID", "Foundation package.json is invalid JSON.", error); }
    if (packageJson.packageManager !== undefined && (typeof packageJson.packageManager !== "string" || !/^npm(?:@|$)/i.test(packageJson.packageManager))) throw new ImplementationError("PACKAGE_MANAGER_POLICY_VIOLATION", "Foundation package.json must use npm.");
    for (const [name, version] of Object.entries({ ...packageJson.dependencies, ...packageJson.devDependencies })) { const approved = { ...FOUNDATION_PACKAGE_POLICY.dependencies, ...FOUNDATION_PACKAGE_POLICY.devDependencies } as Record<string, string>; if (!(name in approved) || version !== approved[name]) throw new ImplementationError("UNAPPROVED_DEPENDENCY", `Foundation dependency ${name} is not in the approved version policy.`); }
    for (const [name, command] of Object.entries(FOUNDATION_PACKAGE_POLICY.scripts)) if (packageJson.scripts?.[name] !== command) throw new ImplementationError("IMPLEMENTATION_EXPECTED_FILE_MISSING", `Foundation package.json must define the canonical ${name} script.`);
  }
  if (BACKEND_TASK_TYPES.has(task.taskType)) validateBackendProposal(task, proposal, backendPlans);
  if (task.taskType === "implement-navigation" && proposal.operations.some((operation) => operation.relativePath.includes("/unplanned/"))) throw new ImplementationError("IMPLEMENTATION_REQUIREMENT_VIOLATION", "Navigation proposal references an unplanned route.");
  if (task.taskType === "integrate-content" && proposal.operations.some((operation) => /TODO|TBD|unknown fact/i.test("content" in operation ? operation.content : "newText" in operation ? operation.newText : ""))) throw new ImplementationError("IMPLEMENTATION_UNSUPPORTED_BUSINESS_FACT", "Content proposal contains unresolved factual markers.");
  if (task.taskType === "implement-page" && proposal.operations.some((operation) => /admin|dashboard/i.test(operation.relativePath) && !task.requirementReferences?.some((reference) => /admin|dashboard/i.test(reference)))) throw new ImplementationError("IMPLEMENTATION_UNAPPROVED_FEATURE", "Page proposal targets an unapproved protected feature.");
  return [{ name: task.taskType, status: "passed" as const, summary: "Deterministic task-specific validation passed." }];
}
