import type { AgentTask } from "@/domain/tasks/schema";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ImplementationChangeProposal } from "./contracts";
import { ImplementationError } from "./errors";
import { BACKEND_TASK_TYPES, validateBackendProposal, type BackendPlans } from "./backend";
import { FOUNDATION_ESLINT_CONFIG_PATH, FOUNDATION_NEXT_CONFIG_PATH, FOUNDATION_PACKAGE_POLICY } from "./foundation-policy";
import { isWithinTaskScope } from "./scope";
export const SUPPORTED_IMPLEMENTATION_TASK_TYPES = new Set(["prepare-workspace", "implement-project-foundation", "implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "integrate-content", "integrate-assets", "implement-seo", "write-unit-tests", "write-integration-tests", "write-e2e-tests", "repair-targeted-failure", ...BACKEND_TASK_TYPES]);
export function validateSupportedTask(task: AgentTask) { if (!SUPPORTED_IMPLEMENTATION_TASK_TYPES.has(task.taskType) || (task.taskType === "implement-form" && !task.allowedTools.includes("shadcn-registry-read"))) throw new ImplementationError("IMPLEMENTATION_TASK_TYPE_UNSUPPORTED", "This Implementation Agent foundation does not support the requested task type without the relevant UI reference permission."); }
const matches = (pattern: string, candidate: string) => { const escaped = pattern.replaceAll("\\", "/").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("§§", ".*"); return new RegExp(`^${escaped}$`, "i").test(candidate.replaceAll("\\", "/")); };
const testArtifactPath = (task: AgentTask, relativePath: string) => task.fileScopes.some((scope) => isWithinTaskScope(scope, relativePath)) && /^src\/.*\.test\.(?:ts|tsx)$/i.test(relativePath);
const isPlaceholder = (content: string) => /expect\s*\(\s*true\s*\)/.test(content);
function discoverTestArtifacts(root: string, task: AgentTask) { const result: Array<{ relativePath: string; content: string }> = []; const walk = (directory: string) => { for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const full = path.join(directory, entry.name); const relative = path.relative(root, full).replaceAll("\\", "/"); if ([".git", ".factory", "node_modules", ".next", "dist", "coverage"].some((name) => relative === name || relative.startsWith(`${name}/`))) continue; if (lstatSync(full).isDirectory()) walk(full); else if (testArtifactPath(task, relative)) result.push({ relativePath: relative, content: readFileSync(full, "utf8") }); } }; walk(root); return result; }
export function validateTaskResult(task: AgentTask, proposal: ImplementationChangeProposal, backendPlans: BackendPlans = {}, workspacePath?: string) {
  if (task.taskType === "repair-targeted-failure") {
    const writable = proposal.operations.filter((operation) => operation.type !== "delete-file");
    if (writable.length === 0) throw new ImplementationError("IMPLEMENTATION_REPAIR_NOOP", "A targeted repair must contain a non-empty correction proposal.");
    if (writable.some((operation) => !task.fileScopes.some((scope) => isWithinTaskScope(scope, operation.relativePath.replaceAll("\\", "/"))))) throw new ImplementationError("IMPLEMENTATION_REPAIR_SCOPE_INVALID", "A targeted repair proposal modified a file outside its canonical repair scope.");
  }
  if (task.taskType === "prepare-workspace") {
    const marker = proposal.operations.find((operation) => operation.relativePath.replaceAll("\\", "/") === "src/app/factory-prepared.ts");
    if (!marker || !("content" in marker) || !/^export const factoryWorkspacePrepared = true;\s*$/.test(marker.content)) throw new ImplementationError("IMPLEMENTATION_EXPECTED_FILE_MISSING", "The workspace preparation marker must be valid TypeScript and export factoryWorkspacePrepared as true.");
  }
  if (task.taskType === "write-unit-tests") {
    const proposedPaths = proposal.operations.filter((operation) => operation.type !== "delete-file").map((operation) => operation.relativePath.replaceAll("\\", "/"));
    if (!proposedPaths.some((relativePath) => testArtifactPath(task, relativePath))) throw new ImplementationError("IMPLEMENTATION_EXPECTED_TEST_MISSING", "The unit-test task proposal contains no canonical Vitest test artifact.");
    if (proposedPaths.some((relativePath) => relativePath.includes("/spec.") || (relativePath.startsWith("src/") && !/^src\/.*\.test\.(?:ts|tsx)$/i.test(relativePath)))) throw new ImplementationError("IMPLEMENTATION_TEST_SCOPE_INVALID", "Unit tests must use the canonical src/**/*.test.ts or src/**/*.test.tsx layout.");
    if (workspacePath) { const artifacts = discoverTestArtifacts(workspacePath, task); if (artifacts.length < (task.requiredArtifactCount ?? 1)) throw new ImplementationError("IMPLEMENTATION_EXPECTED_TEST_MISSING", `The unit-test task requires at least ${task.requiredArtifactCount ?? 1} real test artifact.`); if (artifacts.some((artifact) => isPlaceholder(artifact.content))) throw new ImplementationError("IMPLEMENTATION_TEST_PLACEHOLDER", "A generated unit-test artifact is an obvious placeholder rather than an application behavior test."); }
  }
  if (task.taskType === "implement-project-foundation" && task.requiredArtifacts?.length) {
    const paths = new Set(proposal.operations.map((operation) => operation.relativePath.replaceAll("\\", "/")));
    const missing = task.requiredArtifacts.filter((path) => path !== "package-lock.json" && !paths.has(path));
    if (missing.length) throw new ImplementationError("IMPLEMENTATION_EXPECTED_FILE_MISSING", `Project foundation is missing required runtime artifacts: ${missing.join(", ")}.`);
    const packageOperation = proposal.operations.find((operation) => operation.relativePath.replaceAll("\\", "/") === "package.json" && "content" in operation);
    if (!packageOperation || !("content" in packageOperation)) throw new ImplementationError("IMPLEMENTATION_EXPECTED_FILE_MISSING", "Project foundation must propose package.json content.");
    const eslintOperation = proposal.operations.find((operation) => operation.relativePath.replaceAll("\\", "/") === FOUNDATION_ESLINT_CONFIG_PATH && "content" in operation);
    if (!eslintOperation || !("content" in eslintOperation)) throw new ImplementationError("IMPLEMENTATION_EXPECTED_FILE_MISSING", "Project foundation must propose the canonical flat ESLint configuration.");
    if (!/eslint-config-next\/core-web-vitals/.test(eslintOperation.content) || !/defineConfig/.test(eslintOperation.content)) throw new ImplementationError("IMPLEMENTATION_FOUNDATION_CONFIG_INVALID", "The foundation ESLint configuration must use the approved Next.js flat configuration.");
    const nextOperation = proposal.operations.find((operation) => operation.relativePath.replaceAll("\\", "/") === FOUNDATION_NEXT_CONFIG_PATH && "content" in operation);
    if (!nextOperation || !("content" in nextOperation) || !/turbopack/.test(nextOperation.content)) throw new ImplementationError("IMPLEMENTATION_FOUNDATION_CONFIG_INVALID", "The foundation Next.js config must pin the project filesystem root.");
    if (workspacePath && (!lstatSync(path.join(path.resolve(workspacePath), FOUNDATION_ESLINT_CONFIG_PATH), { throwIfNoEntry: false }) || !lstatSync(path.join(path.resolve(workspacePath), FOUNDATION_NEXT_CONFIG_PATH), { throwIfNoEntry: false }))) throw new ImplementationError("IMPLEMENTATION_EXPECTED_FILE_MISSING", "The applied foundation is missing a canonical runtime configuration.");
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
