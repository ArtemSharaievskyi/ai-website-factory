import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { SecurityReviewProviderOutputSchema, type SecurityReviewResult, type SecuritySurface } from "@/domain/review/schema";
import { SecurityReviewInputSchema, type SecurityReviewInput } from "./contracts";
import type { SecurityReviewProvider } from "./ports";

const secretPattern = /(sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|(?:SERVICE_ROLE|DATABASE_URL|API_KEY|SECRET|TOKEN)\s*[:=]\s*['\"]?[A-Za-z0-9_./+=-]{8,})/i;
const finding = (id: string, category: SecurityReviewResult["findings"][number]["category"], summary: string, refs: string[], ownerTaskId?: string) => ({ findingId: id, severity: "ERROR" as const, category, summary, evidenceRefs: refs, affectedArtifacts: refs, recommendedAction: ownerTaskId ? `Correct the security-sensitive implementation owned by task ${ownerTaskId}.` : "Correct the security contract or implementation and rerun security review.", correctionTarget: ownerTaskId ? "IMPLEMENTATION_TASK" as const : "UPSTREAM_SECURITY_CONTRACT" as const, ...(ownerTaskId ? { ownerTaskId } : {}) });
export function classifySecuritySurface(raw: SecurityReviewInput): SecuritySurface[] {
  const input = SecurityReviewInputSchema.parse(raw); const surfaces = new Set<SecuritySurface>(); const planning = input.securityPolicySummary;
  if (input.acceptedPlanningPackage.forms.forms.length || input.sourceManifest.some((file) => /form/i.test(file.relativePath))) surfaces.add("FORM_INPUT");
  if (input.acceptedPlanningPackage.authentication.required || planning.authRequired || input.sourceManifest.some((file) => /auth|session|middleware/i.test(file.relativePath))) surfaces.add("AUTH");
  if (planning.persistenceRequired || input.acceptedPlanningPackage.supabase.postgres || input.sourceManifest.some((file) => /database|supabase|migration|repository/i.test(file.relativePath))) surfaces.add("DATABASE");
  if (planning.storageDecision !== "not-required" || input.acceptedPlanningPackage.storage.decision !== "not-required") surfaces.add("STORAGE");
  if (planning.uploadRequired || input.sourceManifest.some((file) => /upload/i.test(file.relativePath))) surfaces.add("UPLOAD");
  if (planning.adminDecision !== "no-admin" || input.acceptedPlanningPackage.administration.decision !== "no-admin") surfaces.add("ADMIN");
  if (planning.emailRequired || input.acceptedPlanningPackage.email.decision !== "not-required") surfaces.add("EMAIL");
  if (planning.externalApiRequired || input.sourceSlices.some((slice) => /fetch\(|axios|external.?api/i.test(slice.content))) surfaces.add("EXTERNAL_API");
  if (input.sourceManifest.some((file) => /actions?|server-action/i.test(file.relativePath))) surfaces.add("SERVER_ACTION");
  if (input.sourceManifest.some((file) => /route\.(ts|js)$|route-handler/i.test(file.relativePath))) surfaces.add("ROUTE_HANDLER");
  return surfaces.size ? [...surfaces] : ["NONE"];
}
export function deterministicSecurityReview(raw: SecurityReviewInput) {
  const input = SecurityReviewInputSchema.parse(raw); const surfaces = classifySecuritySurface(input); const findings = [] as SecurityReviewResult["findings"];
  const evidence = new Set(["brief", "planning-package", "architecture-review", "selected-design", "contract-audit", "code-integration-review", "task-graph", "source", ...input.deterministicSecurityEvidence.evidenceRefs, ...input.unitTestEvidence.evidenceRefs, ...input.sourceManifest.map((file) => `source:${file.relativePath}`), ...input.taskGraph.tasks.map((task) => task.id), ...input.securitySensitiveArtifacts.map((artifact) => artifact.relativePath)]);
  if (input.deterministicSecurityEvidence.status !== "PASSED" && input.deterministicSecurityEvidence.status !== "NOT_REQUIRED") findings.push(finding("security-evidence-invalid", "SECURITY_CONTRACT_MISMATCH", "Deterministic security evidence is not valid.", ["source"]));
  if (input.deterministicSecurityEvidence.npmAudit !== "PASSED" && input.deterministicSecurityEvidence.npmAudit !== "NOT_REQUIRED") findings.push(finding("dependency-audit-failed", "DEPENDENCY_SECURITY", "Current dependency audit evidence is not passing.", ["source"]));
  if (input.approvedCodeIntegrationReview.result.verdict !== "APPROVED") findings.push(finding("code-review-not-approved", "SECURITY_CONTRACT_MISMATCH", "Security review requires a current approved Code / Integration Review.", ["code-integration-review"]));
  if (checksumPersistedDocument(input.approvedCodeIntegrationReview) !== input.codeIntegrationReviewChecksum) findings.push(finding("code-review-stale", "SECURITY_CONTRACT_MISMATCH", "The bound Code / Integration Review checksum is stale.", ["code-integration-review"]));
  if (checksumPersistedDocument(input.approvedContractAudit) !== input.contractAuditChecksum) findings.push(finding("contract-audit-stale", "SECURITY_CONTRACT_MISMATCH", "The bound Contract Audit checksum is stale.", ["contract-audit"]));
  if (checksumPersistedDocument(input.approvedArchitectureReview) !== input.architectureReviewChecksum) findings.push(finding("architecture-review-stale", "SECURITY_CONTRACT_MISMATCH", "The bound Architecture Review checksum is stale.", ["architecture-review"]));
  if (checksumPersistedDocument(input.selectedDesign) !== input.designChecksum) findings.push(finding("design-stale", "SECURITY_CONTRACT_MISMATCH", "The bound selected Design checksum is stale.", ["selected-design"]));
  if (checksumPersistedDocument(input.acceptedPlanningPackage) !== input.planningChecksum) findings.push(finding("planning-stale", "SECURITY_CONTRACT_MISMATCH", "The bound Planning checksum is stale.", ["planning-package"]));
  if (checksumPersistedDocument(input.approvedBrief) !== input.briefChecksum) findings.push(finding("brief-stale", "SECURITY_CONTRACT_MISMATCH", "The bound Brief checksum is stale.", ["brief"]));
  if (input.deterministicSecurityEvidence.checksum !== checksumPersistedDocument({ sourceChecksum: input.sourceChecksum, surfaces })) findings.push(finding("security-evidence-stale", "SECURITY_CONTRACT_MISMATCH", "Deterministic security evidence is stale for the current source and surface.", ["source"]));
  for (const slice of input.sourceSlices) if (!evidence.has(`source:${slice.relativePath}`)) findings.push(finding(`source-slice-${slice.relativePath.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, "TRUST_BOUNDARY", "A security source slice is not present in the bounded source manifest.", [`source:${slice.relativePath}`]));
  for (const slice of input.sourceSlices) {
    if (secretPattern.test(slice.content)) findings.push(finding(`secret-${slice.relativePath.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, "SECRET_EXPOSURE", "A secret-like value or privileged credential pattern is present in source context.", [`source:${slice.relativePath}`]));
    const client = /['\"]use client['\"]/.test(slice.content) || /\/components\/|\/app\/.*page\./i.test(slice.relativePath);
    if (client && /process\.env\.(?:DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|PRIVATE_KEY|SECRET)/i.test(slice.content)) findings.push(finding(`client-secret-${slice.relativePath.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, "SERVER_CLIENT_EXPOSURE", "Client-owned source references a server-only or privileged environment value.", [`source:${slice.relativePath}`]));
    for (const declaration of input.environmentDeclarations) if (client && declaration.serverOnly && new RegExp(`process\\.env\\.${declaration.name}\\b`).test(slice.content)) findings.push(finding(`client-env-${declaration.name.toLowerCase()}`, declaration.secret ? "SECRET_EXPOSURE" : "SERVER_CLIENT_EXPOSURE", `Client-owned source references server-only environment declaration ${declaration.name}.`, [`source:${slice.relativePath}`]));
  }
  const passedTasks = new Set(input.taskGraph.tasks.filter((task) => task.status === "passed").map((task) => task.taskType));
  if (input.securityPolicySummary.authRequired && !passedTasks.has("implement-authentication")) findings.push(finding("auth-owner-missing", "AUTHENTICATION_FLOW", "Authentication is required but no completed authentication responsibility exists.", ["planning-package", "task-graph"]));
  if (input.securityPolicySummary.rlsRequired && !passedTasks.has("implement-rls-policy")) findings.push(finding("rls-owner-missing", "RLS_POLICY", "RLS is required but no completed RLS responsibility exists.", ["planning-package", "task-graph"]));
  if (input.securityPolicySummary.storageDecision !== "not-required" && !passedTasks.has("implement-storage")) findings.push(finding("storage-owner-missing", "STORAGE_ACCESS", "Storage is required but no completed storage responsibility exists.", ["planning-package", "task-graph"]));
  if (input.securityPolicySummary.adminDecision !== "no-admin" && !passedTasks.has("implement-authentication")) findings.push(finding("admin-owner-missing", "ADMIN_PROTECTION", "Admin functionality requires a completed authorization responsibility.", ["planning-package", "task-graph"]));
  const result = { verdict: findings.length ? "CHANGES_REQUIRED" as const : "APPROVED" as const, findings, reviewedArtifactRefs: ["brief", "planning-package", "architecture-review", "selected-design", "contract-audit", "code-integration-review", "task-graph", "source"] };
  return SecurityReviewProviderOutputSchema.parse(result);
}
export class DeterministicSecurityReviewProvider implements SecurityReviewProvider { readonly promptVersion = "security-reviewer.v1"; async review(input: SecurityReviewInput) { return deterministicSecurityReview(input); } }
