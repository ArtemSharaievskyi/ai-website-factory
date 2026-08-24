import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { taskExecutionCapability } from "@/orchestration/execution/capabilities";
import { validateFileScopes } from "@/orchestration/orchestrator/validation";
import { ContractAuditProvider } from "./ports";
import { assertProjectIdentity, type ContractAuditInput } from "./contracts";
import { ContractAuditProviderOutputSchema, type ContractAuditFinding } from "@/domain/review/schema";
import { createReviewEvidenceCatalog, toProviderReviewEvidence, withoutProviderEvidenceCatalog } from "../evidence";
import { canonicalContractEvidence } from "./service";

const reviewed = ["requirements", "planning-package", "architecture-review", "selected-design", "task-graph"];
const text = (value: unknown) => JSON.stringify(value).toLowerCase();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const refsForPlanning = (input: ContractAuditInput) => unique([
  ...input.acceptedPlanningPackage.traceability.map((item) => `decision:${item.decisionId}`),
  ...input.acceptedPlanningPackage.traceability.flatMap((item) => item.requirementReferences),
  ...input.acceptedPlanningPackage.sitemap.routes.flatMap((item) => [item.id, ...item.requirementReferences]),
  ...input.acceptedPlanningPackage.pages.pages.flatMap((item) => [item.id, item.routeId, ...item.requirementReferences]),
  ...input.acceptedPlanningPackage.forms.forms.flatMap((item) => [item.id, ...item.requirementReferences, ...item.fields.flatMap((field) => "fieldId" in field ? [field.fieldId] : [])]),
  ...input.acceptedPlanningPackage.dataModel.entities.map((item) => item.id),
  ...input.acceptedPlanningPackage.userFlows.flows.map((item) => item.id),
  ...input.acceptedPlanningPackage.navigation.routeReferences,
]);
const refsForRequirements = (input: ContractAuditInput) => unique([
  ...input.approvedBrief.pages.map((item) => `requirement:page:${item.slug}`),
  ...input.approvedBrief.features.map((item) => `requirement:feature:${item}`),
  ...input.acceptedPlanningPackage.traceability.flatMap((item) => item.requirementReferences),
]);
const taskText = (task: ContractAuditInput["taskGraph"]["tasks"][number]) => text({ objective: task.objective, inputs: task.inputs, outputs: task.expectedOutputs, acceptance: task.acceptanceCriteria });
const finding = (findingId: string, category: ContractAuditFinding["category"], summary: string, evidenceRefs: string[], affectedArtifacts: string[], recommendedAction: string, correctionTarget: ContractAuditFinding["correctionTarget"] = "TASKGRAPH", severity: ContractAuditFinding["severity"] = "ERROR"): ContractAuditFinding => ({ findingId: findingId.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-"), severity, category, summary, evidenceRefs, affectedArtifacts, recommendedAction, correctionTarget });

export function deterministicContractAudit(rawInput: ContractAuditInput) {
  const input = withoutProviderEvidenceCatalog(rawInput);
  assertProjectIdentity(
    input,
    [
      { label: "approvedBrief", value: input.approvedBrief },
      { label: "acceptedPlanningPackage", value: input.acceptedPlanningPackage },
      { label: "approvedArchitectureReview", value: input.approvedArchitectureReview },
      { label: "selectedDesign", value: input.selectedDesign },
      { label: "taskGraph", value: input.taskGraph },
    ],
  );
  const findings: ContractAuditFinding[] = [];
  const planningRefs = new Set(refsForPlanning(input)); const requirementRefs = new Set(refsForRequirements(input)); const tasks = input.taskGraph.tasks;
  const add = (...args: Parameters<typeof finding>) => findings.push(finding(...args));
  const taskByType = (type: string) => tasks.filter((task) => task.taskType === type);
  if (input.taskGraph.graphChecksum !== input.taskGraphChecksum || input.taskGraphChecksum !== checksumPersistedDocument({ ...input.taskGraph, graphChecksum: undefined })) add("graph-checksum-stale", "REFERENCE_NOT_FOUND", "The supplied TaskGraph checksum is not current.", ["task-graph", "taskGraphChecksum"], ["task-graph"], "Regenerate the TaskGraph from the current canonical inputs.");
  if (input.taskGraph.sourceDocumentChecksums?.brief !== input.briefChecksum || input.taskGraph.sourceDocumentChecksums?.planning !== input.planningChecksum || input.taskGraph.sourceDocumentChecksums?.design !== input.designChecksum) add("graph-source-checksum-mismatch", "IDENTITY_MISMATCH", "TaskGraph source checksums do not match the supplied canonical artifacts.", ["task-graph.sourceDocumentChecksums", "requirements", "planning-package", "selected-design"], ["task-graph"], "Regenerate the TaskGraph with current artifact checksums.");
  for (const task of tasks) {
    for (const ref of [...(task.requirementReferences ?? []), ...(task.planningReferences ?? [])]) if (!planningRefs.has(ref) && !requirementRefs.has(ref)) add(`missing-reference-${task.id}-${ref}`, "REFERENCE_NOT_FOUND", `Task ${task.id} references an unknown contract object.`, [`task:${task.id}`, ref], [`task:${task.id}`], "Replace the reference with a current canonical requirement or planning ID.");
    for (const ref of task.selectedDesignReferences ?? []) if (ref !== input.selectedDesign.selectedDirectionId) add(`design-reference-${task.id}`, "DESIGN_CONTRACT_MISMATCH", `Task ${task.id} references a design identity different from the selected Design.`, [`task:${task.id}`, "selected-design"], [`task:${task.id}`], "Update the TaskGraph design reference.");
    const capability = taskExecutionCapability(task.taskType); if (capability && !input.executorCatalog.some((executor) => executor.current && executor.capabilities.includes(capability))) add(`executor-${task.id}`, "EXECUTOR_MISSING", `No current trusted executor provides ${capability} for task ${task.id}.`, [`task:${task.id}`, `capability:${capability}`], [`task:${task.id}`], "Provide a current trusted executor or remove the task.");
  }
  try { validateFileScopes(tasks); } catch { add("task-scope-invalid", "SCOPE_CONTRACT_MISMATCH", "Task scopes are invalid or incompatible with the current ownership policy.", ["task-graph"], ["task-graph"], "Regenerate the TaskGraph with bounded non-overlapping scopes."); }
  const pageOwners = new Set(tasks.filter((task) => task.taskType === "implement-page").flatMap((task) => task.planningReferences ?? []));
  for (const route of input.acceptedPlanningPackage.sitemap.routes) if (!pageOwners.has(route.id) && !tasks.some((task) => task.taskType === "implement-page" && (task.planningReferences ?? []).includes(route.id))) add(`route-owner-${route.id}`, "ROUTE_CONTRACT_MISMATCH", `Required route ${route.path} has no implementation task owner.`, [`route:${route.id}`, `planning:${route.id}`], ["task-graph"], "Add or correct the route implementation task.");
  for (const form of input.acceptedPlanningPackage.forms.forms) {
    const owner = tasks.find((task) => task.taskType === "implement-form" && (task.planningReferences ?? []).some((ref) => ref === form.id || ref === form.requirementReferences[0]));
    if (!owner) add(`form-owner-${form.id}`, "ARTIFACT_NOT_OWNED", `Form ${form.id} has no implementation task owner.`, [`form:${form.id}`], ["task-graph"], "Add a bounded form implementation task.");
    const fields = form.fields.flatMap((field) => "fieldId" in field ? [field.fieldId] : []); if (fields.length && owner) { const ownerText = taskText(owner); const ownerRefs = owner.planningReferences ?? []; for (const field of form.fields) if ("fieldId" in field && ownerRefs.includes(field.label) && !ownerRefs.includes(field.fieldId)) add(`form-label-${form.id}-${field.fieldId}`, "IDENTITY_MISMATCH", `Form ${form.id} uses localized display label ${field.label} as an implementation identity.`, [`form:${form.id}`, `field:${field.fieldId}`, `task:${owner.id}`], [`task:${owner.id}`], "Use the stable fieldId rather than the localized label."); const explicitFieldMapping = fields.some((fieldId) => ownerRefs.includes(fieldId)); if (explicitFieldMapping) for (const fieldId of fields) if (!ownerText.includes(fieldId.toLowerCase()) && !ownerRefs.includes(fieldId)) add(`form-field-${form.id}-${fieldId.toLowerCase()}`, "IDENTITY_MISMATCH", `Form ${form.id} field ${fieldId} is not carried into its implementation contract.`, [`form:${form.id}`, `field:${fieldId}`, `task:${owner.id}`], [`task:${owner.id}`], "Carry the stable fieldId into the form task contract."); }
    const requiresZod = /zod/i.test(text(form)) || /zod/i.test(text(input.acceptedPlanningPackage.dependencies)); if (requiresZod && owner && !/zod/i.test(taskText(owner))) add(`form-zod-${form.id}`, "VALIDATION_NOT_SCHEDULED", `Form ${form.id} requires Zod or explicit schema validation, but its task does not carry that obligation.`, [`form:${form.id}`, `task:${owner.id}`], [`task:${owner.id}`], "Add the approved validation requirement to the form task.");
  }
  const needsDatabase = input.acceptedPlanningPackage.dataModel.entities.length > 0 || input.acceptedPlanningPackage.supabase.postgres; if (needsDatabase && !taskByType("implement-database-schema").length) add("database-owner-missing", "DATA_CONTRACT_MISMATCH", "Persistent data is planned without a database implementation owner.", ["data-model-plan", "supabase-plan"], ["task-graph"], "Add the database schema task."); if (needsDatabase && !taskByType("implement-rls-policy").length) add("rls-owner-missing", "DATA_CONTRACT_MISMATCH", "Persistent data is planned without an RLS implementation owner.", ["data-model-plan", "supabase-plan"], ["task-graph"], "Add the RLS policy task.");
  const needsAuth = input.approvedBrief.authenticationDecision === "authentication-required" || input.acceptedPlanningPackage.authentication.decision === "supabase-auth"; if (needsAuth && !taskByType("implement-authentication").length) add("auth-owner-missing", "REQUIREMENT_NOT_TRACED", "Authentication is required but no authentication task owns it.", ["requirements.authenticationDecision", "authentication-plan"], ["task-graph"], "Add the authentication implementation task."); if (!needsAuth && taskByType("implement-authentication").length) add("unexpected-auth-task", "REQUIREMENT_CONTRADICTION", "The TaskGraph schedules authentication although the canonical contract does not require it.", ["requirements.authenticationDecision", "task-graph"], ["task-graph"], "Remove the unsupported authentication task.");
  const requiredGates = [["validate-lint", "lint"], ["validate-typecheck", "typecheck"], ["validate-unit-tests", "unit-tests"], ["validate-build", "build"], ["validate-functional-flow", "functional-qa"]] as const; for (const [type, label] of requiredGates) if (!taskByType(type).length) add(`quality-${type}`, "VALIDATION_NOT_SCHEDULED", `Mandatory ${label} quality responsibility is missing.`, ["test-strategy", "task-graph"], ["task-graph"], `Add the ${label} quality task.`);
  const build = taskByType("validate-build")[0]; const qa = taskByType("validate-functional-flow")[0]; if (build && qa && !qa.dependencies.includes(build.id)) add("qa-before-build", "DEPENDENCY_CONTRACT_MISMATCH", "Functional QA does not depend on the build gate.", [`task:${build.id}`, `task:${qa.id}`], ["task-graph"], "Make Functional QA depend on the passed build task.");
  for (let i = 0; i < tasks.length; i++) for (let j = i + 1; j < tasks.length; j++) { const left = tasks[i]!, right = tasks[j]!; const sharedOwnershipAllowed = ["implement-shared-component", "implement-form"].includes(left.taskType) && left.taskType === right.taskType; if (!sharedOwnershipAllowed && left.taskType === right.taskType && left.executionMode === "exclusive-write" && left.fileScopes.some((scope) => right.fileScopes.includes(scope))) add(`multiple-owner-${left.id}-${right.id}`, "ARTIFACT_MULTIPLE_OWNERS", "Two exclusive tasks claim the same canonical writable scope.", [`task:${left.id}`, `task:${right.id}`, `scope:${left.fileScopes[0]}`], ["task-graph"], "Assign the scope to one bounded owner or split the scope."); }
  const blocking = findings.some((item) => item.severity === "ERROR" || item.severity === "CRITICAL");
  const catalog = createReviewEvidenceCatalog({ projectId: input.projectId, projectVersion: input.projectVersion, evidenceRefs: canonicalContractEvidence(input), requestContext: input });
  return ContractAuditProviderOutputSchema.parse(toProviderReviewEvidence(rawInput, { verdict: blocking ? "CHANGES_REQUIRED" : "APPROVED", findings, reviewedArtifactRefs: reviewed }, catalog));
}

export class DeterministicContractAuditProvider implements ContractAuditProvider { readonly promptVersion = "contract-auditor.v1"; async review(input: ContractAuditInput) { return deterministicContractAudit(input); } }
