import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { architectureReviewerAgentDefinition, codeIntegrationReviewerAgentDefinition, contractAuditorAgentDefinition, securityReviewerAgentDefinition } from "@/agents/catalog";
import { ArchitectureReviewProviderOutputSchema, CodeIntegrationReviewProviderOutputSchema, ContractAuditProviderOutputSchema, SecurityReviewProviderOutputSchema } from "@/domain/review/schema";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import { readAiProviderConfig } from "@/integrations/openai/config";
import { prepareAgentSkillContext, type AgentSkillSelection } from "@/skills/runtime/resolver";
import { SkillRegistry } from "@/skills/registry/registry";
import { loadFactoryCliEnv } from "./cli-env";

export const CG02_GROUP_ID = "cg-02-authentication-authorization-rls" as const;
export const CG02_FINDING_IDS = [
  "finding-0590fb313e72090696f0",
  "finding-233d7f1502c96cf535e1",
  "finding-7586dd5bd4661d954bf4",
  "finding-865697184809f419d1b7",
  "finding-c200a7f61e715bc94be1",
  "finding-e055bfdcbad92c9b36eb",
] as const;
export const CG03_GROUP_ID = "cg-03-storage-ownership-controls" as const;
export const CG03_FINDING_IDS = ["finding-b227589f057cc3fa00ac", "finding-eb166a34da7872c62d77"] as const;
export const CG04_GROUP_ID = "cg-04-provider-config-and-lifecycle" as const;
export const CG04_FINDING_IDS = ["finding-24cb4b563e9b341a84fd", "finding-3ea29b90bbf550eecdb3"] as const;
export const CG05_GROUP_ID = "cg-05-design-durable-state-authority" as const;
export const CG05_FINDING_IDS = ["finding-1540c99220f633245955", "finding-efa4502938176a741e32"] as const;
export const CG06_GROUP_ID = "cg-06-database-error-propagation" as const;
export const CG06_FINDING_IDS = ["finding-c94e4c6dd19f957eeb40"] as const;
export const PHASE6A_PLAN_IDENTITY = "819b825a599793b3bcf3b82ec48df40e13fb1dfc7f1f632585f8ce83b36dfd00" as const;
export const PHASE6A_PLAN_PATH = "docs/admin/phase-6/factory-findings-currentness-plan-2026-08-10.json" as const;
export const VERIFICATION_MACHINE_PATH = "docs/admin/phase-6/cg-02-authentication-authorization-rls-verification-2026-08-10.json" as const;
export const VERIFICATION_REPORT_PATH = "docs/admin/phase-6/cg-02-authentication-authorization-rls-verification-2026-08-10.md" as const;
export const CG03_VERIFICATION_MACHINE_PATH = "docs/admin/phase-6/cg-03-storage-ownership-controls-verification-rev2-2026-08-10.json" as const;
export const CG03_VERIFICATION_REPORT_PATH = "docs/admin/phase-6/cg-03-storage-ownership-controls-verification-rev2-2026-08-10.md" as const;
export const CG04_VERIFICATION_MACHINE_PATH = "docs/admin/phase-6/cg-04-provider-config-and-lifecycle-verification-2026-08-10.json" as const;
export const CG04_VERIFICATION_REPORT_PATH = "docs/admin/phase-6/cg-04-provider-config-and-lifecycle-verification-2026-08-10.md" as const;
export const CG05_VERIFICATION_MACHINE_PATH = "docs/admin/phase-6/cg-05-design-durable-state-authority-verification-2026-08-10.json" as const;
export const CG05_VERIFICATION_REPORT_PATH = "docs/admin/phase-6/cg-05-design-durable-state-authority-verification-2026-08-10.md" as const;
export const CG06_VERIFICATION_MACHINE_PATH = "docs/admin/phase-6/cg-06-database-error-propagation-verification-2026-08-11.json" as const;
export const CG06_VERIFICATION_REPORT_PATH = "docs/admin/phase-6/cg-06-database-error-propagation-verification-2026-08-11.md" as const;

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const git = (root: string, args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const StateSchema = z.enum(["RESOLVED", "PARTIALLY_RESOLVED", "STILL_ACTIVE", "REGRESSION_FOUND", "VERIFICATION_FAILED"]);
type ReviewerId = "security-reviewer" | "contract-auditor" | "architecture-reviewer" | "code-integration-reviewer";
type EvidenceSlice = { id: string; relativePath: string; startLine: number; endLine: number; checksum: string; currentHead: string; content: string };
type CorrectionConfig = {
  groupId: string;
  findingIds: readonly string[];
  machinePath: string;
  reportPath: string;
  documentType: string;
  title: string;
  fixedRefs: readonly string[];
  originalFindings: readonly Record<string, string>[];
  correctionGoal: string;
  trustBoundary: string;
  nonGoals: readonly string[];
  deterministicChecks: readonly string[];
  requiredReviewerIds: readonly ReviewerId[];
  idempotencyPrefix: string;
};

const CG02_CONFIG: CorrectionConfig = {
  groupId: CG02_GROUP_ID,
  findingIds: CG02_FINDING_IDS,
  machinePath: VERIFICATION_MACHINE_PATH,
  reportPath: VERIFICATION_REPORT_PATH,
  documentType: "phase-6c-correction-verification",
  title: "cg-02 Authentication, Authorization, and RLS Verification",
  fixedRefs: ["original-findings", "cg02-contract", "authentication-vs-authorization", "rls-ownership-contract", "deterministic-regression-tests"],
  originalFindings: [
    { findingId: CG02_FINDING_IDS[0], severity: "ERROR", category: "AUTHENTICATION_FLOW", summary: "Authentication always returns null; no authenticated principal is available." },
    { findingId: CG02_FINDING_IDS[1], severity: "CRITICAL", category: "RLS_POLICY", summary: "Generated RLS allows every authenticated user to select every row." },
    { findingId: CG02_FINDING_IDS[2], severity: "ERROR", category: "DATABASE_ACCESS", summary: "Generated protected schema has no ownership column." },
    { findingId: CG02_FINDING_IDS[3], severity: "WARNING", category: "RLS_POLICY", summary: "Authenticated access is broad because no ownership or audience policy is present." },
    { findingId: CG02_FINDING_IDS[4], severity: "ERROR", category: "AUTHENTICATION_FLOW", summary: "Authentication is a stub and does not establish a verified principal." },
    { findingId: CG02_FINDING_IDS[5], severity: "ERROR", category: "AUTHORIZATION", summary: "Protected handlers do not enforce authentication and ownership authorization at runtime." },
  ],
  correctionGoal: "Make authenticated identity and user-scoped authorization mandatory before protected database behavior is considered valid.",
  trustBoundary: "Generated customer backend: server-side Supabase Auth identity, Server Action/Route Handler authorization, and Postgres RLS ownership.",
  nonGoals: ["No Factory metadata migration", "No storage redesign", "No service-role bypass", "No new auth or policy framework", "No unrelated findings"],
  deterministicChecks: ["server-side Supabase Auth getUser with fail-closed null handling", "protected handlers re-check identity and compare database owner to user.id", "protected schema binds user_id to auth.users", "RLS ownership predicates cover SELECT/INSERT/UPDATE/DELETE and write WITH CHECK", "no service-role credential or public policy"],
  requiredReviewerIds: ["security-reviewer", "contract-auditor"],
  idempotencyPrefix: "phase6c1",
};

const CG03_CONFIG: CorrectionConfig = {
  groupId: CG03_GROUP_ID,
  findingIds: CG03_FINDING_IDS,
  machinePath: CG03_VERIFICATION_MACHINE_PATH,
  reportPath: CG03_VERIFICATION_REPORT_PATH,
  documentType: "phase-6d-correction-verification",
  title: "cg-03 Storage Ownership Controls Verification",
  fixedRefs: ["original-findings", "cg03-contract", "cg02-authentication-authorization-boundary", "storage-ownership-contract", "deterministic-storage-regression-tests"],
  originalFindings: [
    { findingId: CG03_FINDING_IDS[0], severity: "ERROR", category: "FILE_UPLOAD_SECURITY", summary: "Generated storage only validates caller-supplied type and size; no bucket, object ownership, access, or signed-URL controls are established." },
    { findingId: CG03_FINDING_IDS[1], severity: "WARNING", category: "STORAGE_ACCESS", summary: "Generated storage has no bucket access policy or user-scoped object authorization." },
  ],
  correctionGoal: "Replace type/size-only validation with an explicit bucket, object ownership, access, and signed-URL contract where storage is required.",
  trustBoundary: "Generated customer project storage: cg-02 server-side Supabase Auth identity -> user.id owner prefix -> server-selected Supabase Storage bucket and authorized object operations.",
  nonGoals: ["No storage feature invention", "No unrelated auth redesign", "No Factory metadata migration", "No public asset behavior change", "No service-role bypass"],
  deterministicChecks: ["authenticated owner is required before storage operations", "bucket selection is explicit and server-owned", "object paths derive from user.id and reject unsafe names", "signed upload/download URLs are issued only after ownership checks", "update and delete enforce the same owner contract", "no service-role credential or caller-selected bucket/owner"],
  requiredReviewerIds: ["contract-auditor", "security-reviewer"],
  idempotencyPrefix: "phase6d1",
};

const CG04_CONFIG: CorrectionConfig = {
  groupId: CG04_GROUP_ID,
  findingIds: CG04_FINDING_IDS,
  machinePath: CG04_VERIFICATION_MACHINE_PATH,
  reportPath: CG04_VERIFICATION_REPORT_PATH,
  documentType: "phase-6e-correction-verification",
  title: "cg-04 Provider Configuration and External Work Lifecycle Verification",
  fixedRefs: ["original-findings", "cg04-provider-lifecycle-contract", "provider-config-contract", "cancellation-concurrency-contract", "deterministic-provider-lifecycle-tests"],
  originalFindings: [
    { findingId: CG04_FINDING_IDS[0], severity: "ERROR", category: "PROVIDER_CONFIGURATION", summary: "OpenAI provider can be constructed with an empty model identifier when OPENAI_MODEL is absent." },
    { findingId: CG04_FINDING_IDS[1], severity: "WARNING", category: "EXTERNAL_WORK_LIFECYCLE", summary: "Configured concurrency limits do not necessarily bound active external work after timeout because capacity can be released before transport settlement." },
  ],
  correctionGoal: "Reject empty provider model configuration and ensure configured limits remain truthful when external work is cancelled or times out.",
  trustBoundary: "Factory-side OpenAI, Context7, and Codebase Memory provider adapters: validated configuration, transport cancellation, bounded concurrency, and stable error taxonomy.",
  nonGoals: ["No model migration", "No new queue framework", "No provider fallback policy", "No AI timeout policy", "No unrelated findings"],
  deterministicChecks: ["missing OPENAI_MODEL is rejected before client construction", "configured model remains unchanged in the official structured API request", "queued cancellation removes only the cancelled waiter and preserves FIFO progress", "Context7 timeout aborts and awaits transport settlement before releasing a slot", "Codebase Memory timeout aborts and awaits transport settlement before releasing a slot", "existing stable cancellation and timeout error taxonomy is preserved"],
  requiredReviewerIds: ["architecture-reviewer", "code-integration-reviewer"],
  idempotencyPrefix: "phase6e1",
};

const CG05_CONFIG: CorrectionConfig = {
  groupId: CG05_GROUP_ID,
  findingIds: CG05_FINDING_IDS,
  machinePath: CG05_VERIFICATION_MACHINE_PATH,
  reportPath: CG05_VERIFICATION_REPORT_PATH,
  documentType: "phase-6f-correction-verification",
  title: "cg-05 Design Durable State Authority Verification",
  fixedRefs: ["original-findings", "cg05-durable-design-state-contract", "database-authority-project-memory-projection", "restart-resume-contract", "deterministic-design-durability-tests"],
  originalFindings: [
    { findingId: CG05_FINDING_IDS[0], severity: "WARNING", category: "SOURCE_OF_TRUTH", summary: "DesignAgentService keeps workflow and idempotency state in process-local Maps despite having persistence repositories and memory synchronization ports." },
    { findingId: CG05_FINDING_IDS[1], severity: "ERROR", category: "DATA_ARCHITECTURE", summary: "Design persistence is split across database and filesystem paths, while the injected DecisionRepository is unused by DesignMemoryAdapter." },
  ],
  correctionGoal: "Make durable repositories and Project Memory the authoritative state path instead of process-local Maps and split filesystem/database state.",
  trustBoundary: "Design Agent state: database repositories own canonical project documents, workflow, and decisions; Project Memory is a synchronized filesystem projection; service process state is ephemeral only.",
  nonGoals: ["No design behavior changes", "No new persistence technology", "No new state framework", "No visual design changes", "No other correction groups"],
  deterministicChecks: ["Design direction set remains exactly three directions", "direction set and selected design are recovered from durable repository state after service restart", "repeated generation does not call the provider after durable current state exists", "explicit selection retry after restart returns the persisted selected design", "revision supersedes the prior set and invalidates selection", "projectId and projectVersion remain bound", "selectDesignDirection rejects request.projectVersion when it differs from durable FactoryProject.currentVersion", "stale selection rejects before selected-design, decision, Project Memory, workflow, event, or replay side effects", "current-version selection succeeds", "database integrity remains valid"],
  requiredReviewerIds: ["code-integration-reviewer"],
  idempotencyPrefix: "phase6f2",
};

const CG06_CONFIG: CorrectionConfig = {
  groupId: CG06_GROUP_ID,
  findingIds: CG06_FINDING_IDS,
  machinePath: CG06_VERIFICATION_MACHINE_PATH,
  reportPath: CG06_VERIFICATION_REPORT_PATH,
  documentType: "phase-6g-correction-verification",
  title: "cg-06 Database Error Propagation Verification",
  fixedRefs: ["original-findings", "cg06-database-error-contract", "safe-cli-error-propagation", "deterministic-database-script-tests"],
  originalFindings: [
    { findingId: CG06_FINDING_IDS[0], severity: "ERROR", category: "ERROR_HANDLING", summary: "Database configuration failures bypass the scripts' safe error-propagation path." },
  ],
  correctionGoal: "Ensure database configuration failures travel through the established safe error path without bypasses.",
  trustBoundary: "Factory database CLI scripts: pool configuration, safe error normalization, deterministic nonzero process exit, and no raw driver/configuration details in operational output.",
  nonGoals: ["No database schema change", "No migration redesign", "No new retry or ORM framework", "No generated customer database changes", "No unrelated correction groups"],
  deterministicChecks: ["missing DATABASE_URL is normalized to DATABASE_CONFIGURATION_MISSING", "pool construction occurs inside each script's protected error path", "db-migrate, db-status, db-verify, and db-smoke exit nonzero without raw stack output", "database validation and verification continue to pass", "unexpected database failures retain safe connection/permission/timeout categories"],
  requiredReviewerIds: ["code-integration-reviewer"],
  idempotencyPrefix: "phase6g1",
};

async function currentSlice(root: string, id: string, relativePath: string, startLine: number, endLine: number): Promise<EvidenceSlice> {
  const bytes = await readFile(path.resolve(root, relativePath));
  const lines = bytes.toString("utf8").split(/\r?\n/);
  if (startLine < 1 || endLine < startLine || endLine > lines.length) throw new Error(`VERIFICATION_EVIDENCE_RANGE_INVALID:${relativePath}:${startLine}-${endLine}`);
  return { id, relativePath, startLine, endLine, checksum: sha256(bytes), currentHead: git(root, ["rev-parse", "--short", "HEAD"]), content: lines.slice(startLine - 1, endLine).join("\n") };
}

async function buildEvidence(root: string, config: CorrectionConfig) {
  const slices = await Promise.all(config.groupId === CG06_GROUP_ID ? [
    currentSlice(root, "current:db-common", "scripts/db-common.mjs", 14, 31),
    currentSlice(root, "current:db-migrate", "scripts/db-migrate.mjs", 1, 26),
    currentSlice(root, "current:db-status", "scripts/db-status.mjs", 1, 5),
    currentSlice(root, "current:db-verify", "scripts/db-verify.mjs", 1, 22),
    currentSlice(root, "current:db-smoke", "scripts/db-smoke.ts", 1, 43),
    currentSlice(root, "test:db-error-propagation", "src/persistence/database/db-script-error-propagation.test.ts", 1, 48),
  ] : config.groupId === CG05_GROUP_ID ? [
    currentSlice(root, "current:design-service", "src/agents/design/service.ts", 60, 95),
    currentSlice(root, "current:design-persistence-path", "src/agents/design/service.ts", 210, 337),
    currentSlice(root, "current:design-selection-persistence", "src/agents/design/service.ts", 353, 540),
    currentSlice(root, "current:design-revision-recovery", "src/agents/design/service.ts", 580, 645),
    currentSlice(root, "current:design-memory-adapter", "src/agents/design/memory.ts", 1, 20),
    currentSlice(root, "current:design-document-contract", "src/domain/design/schema.ts", 9, 12),
    currentSlice(root, "current:design-server-wiring", "src/agents/design/server.ts", 1, 7),
    currentSlice(root, "current:production-design-wiring", "src/runtime/production-factory-runtime-core.ts", 400, 414),
    currentSlice(root, "test:design-durable-state", "src/agents/design/design.test.ts", 38, 42),
  ] : config.groupId === CG04_GROUP_ID ? [
    currentSlice(root, "current:openai-config", "src/integrations/openai/config.ts", 4, 12),
    currentSlice(root, "current:openai-client", "src/integrations/openai/client.ts", 23, 40),
    currentSlice(root, "current:openai-limiter", "src/integrations/openai/limiter.ts", 1, 13),
    currentSlice(root, "current:context7-lifecycle", "src/integrations/context7/service.ts", 27, 51),
    currentSlice(root, "current:codebase-memory-lifecycle", "src/integrations/codebase-memory/service.ts", 27, 40),
    currentSlice(root, "test:openai-provider-lifecycle", "src/integrations/openai/provider.test.ts", 153, 161),
    currentSlice(root, "test:context7-lifecycle", "src/integrations/context7/context7.test.ts", 19, 20),
    currentSlice(root, "test:codebase-memory-lifecycle", "src/integrations/codebase-memory/codebase-memory.test.ts", 19, 20),
  ] : [
    currentSlice(root, "current:planner-contract", "src/agents/planner/contracts.ts", 45, 65),
    currentSlice(root, "current:planner-deterministic", "src/agents/planner/deterministic.ts", 30, 40),
    currentSlice(root, "current:implementation-contract", "src/agents/implementation/contracts.ts", 20, 30),
    currentSlice(root, "current:implementation-service", "src/agents/implementation/service.ts", 385, 402),
    currentSlice(root, "current:implementation-provider", "src/agents/implementation/provider.ts", 1, 184),
    currentSlice(root, "current:implementation-backend", "src/agents/implementation/backend.ts", 1, 99),
    currentSlice(root, "current:security-validator", "src/runtime/validation/security.ts", 1, 75),
    currentSlice(root, "test:backend-security", "src/agents/implementation/backend.test.ts", 1, 30),
    currentSlice(root, "test:planner-storage", "src/agents/planner/planner.test.ts", 1, 36),
  ]);
  return { slices, fixedRefs: config.fixedRefs, allowed: new Set([...config.fixedRefs, ...slices.flatMap((slice) => [slice.id, `${slice.relativePath}:${slice.startLine}-${slice.endLine}`])]) };
}

function correctionDiff(root: string, config: CorrectionConfig) {
  const files = config.groupId === CG06_GROUP_ID ? ["scripts/db-common.mjs", "scripts/db-migrate.mjs", "scripts/db-status.mjs", "scripts/db-verify.mjs", "scripts/db-smoke.ts", "src/persistence/database/db-script-error-propagation.test.ts"] : config.groupId === CG05_GROUP_ID ? ["src/agents/design/service.ts", "src/agents/design/memory.ts", "src/agents/design/server.ts", "src/runtime/production-factory-runtime-core.ts", "src/domain/design/schema.ts", "src/agents/design/design.test.ts"] : config.groupId === CG04_GROUP_ID ? ["src/integrations/openai/config.ts", "src/integrations/openai/client.ts", "src/integrations/openai/limiter.ts", "src/integrations/context7/service.ts", "src/integrations/codebase-memory/service.ts", "src/integrations/openai/provider.test.ts", "src/integrations/context7/context7.test.ts", "src/integrations/codebase-memory/codebase-memory.test.ts"] : ["src/agents/planner/contracts.ts", "src/agents/planner/deterministic.ts", "src/agents/planner/planner.test.ts", "src/agents/implementation/contracts.ts", "src/agents/implementation/service.ts", "src/agents/implementation/policy.ts", "src/agents/implementation/provider.ts", "src/agents/implementation/backend.ts", "src/agents/implementation/backend.test.ts", "src/runtime/validation/security.ts", "src/integrations/openai/adapters.ts", "scripts/backend-smoke.ts"];
  return git(root, ["diff", "--no-ext-diff", "--unified=3", "--", ...files]).slice(0, 30000);
}

async function resolveSkills(root: string, reviewerId: ReviewerId, config: CorrectionConfig): Promise<AgentSkillSelection> {
  const registry = new SkillRegistry(path.resolve(root, "skills"));
  if (reviewerId === "architecture-reviewer") return prepareAgentSkillContext(registry, { agent: architectureReviewerAgentDefinition, capability: "review.architecture", taskType: "review-architecture", projectSurfaces: ["architecture", "modules", "providers", "concurrency", "cancellation"], requiredCoverage: ["module-boundaries", "architecture-review"], requestedTools: [], contextBudgetBytes: architectureReviewerAgentDefinition.contextPolicy.maxBytes });
  if (reviewerId === "code-integration-reviewer") return prepareAgentSkillContext(registry, { agent: codeIntegrationReviewerAgentDefinition, capability: "review.integration", taskType: "review-code-integration", projectSurfaces: ["typescript", "providers", "openai", "context7", "codebase-memory", "concurrency", "cancellation"], requiredCoverage: ["react-review", "nextjs-review"], requestedTools: [], contextBudgetBytes: codeIntegrationReviewerAgentDefinition.contextPolicy.maxBytes });
  if (reviewerId === "security-reviewer") {
    const storage = config.groupId === CG03_GROUP_ID;
    return prepareAgentSkillContext(registry, { agent: securityReviewerAgentDefinition, capability: "review.security", taskType: "review-security", projectSurfaces: storage ? ["auth", "storage", "uploads", "sessions", "ownership"] : ["supabase", "postgres", "rls", "database", "auth", "sessions", "ownership"], requiredCoverage: storage ? ["storage-upload-security"] : ["supabase-rls", "row-level-authorization", "auth-security"], requestedTools: [], contextBudgetBytes: securityReviewerAgentDefinition.contextPolicy.maxBytes });
  }
  return prepareAgentSkillContext(registry, { agent: contractAuditorAgentDefinition, capability: "review.contracts", taskType: "review-contracts", projectSurfaces: ["requirements", "contracts", "traceability", "auth", "database", "ownership"], requiredCoverage: ["requirements-traceability", "cross-stage-consistency", "traceability-evidence"], requestedTools: [], contextBudgetBytes: contractAuditorAgentDefinition.contextPolicy.maxBytes });
}

function classifyReviewerOutput(reviewerId: ReviewerId, output: unknown, allowedEvidence: ReadonlySet<string>, realGptCalls: number, config: CorrectionConfig) {
  const parsed = reviewerId === "security-reviewer" ? SecurityReviewProviderOutputSchema.parse(output) : reviewerId === "architecture-reviewer" ? ArchitectureReviewProviderOutputSchema.parse(output) : reviewerId === "code-integration-reviewer" ? CodeIntegrationReviewProviderOutputSchema.parse(output) : ContractAuditProviderOutputSchema.parse(output);
  const evidence = [...parsed.reviewedArtifactRefs, ...parsed.findings.flatMap((finding) => [...finding.evidenceRefs, ...finding.affectedArtifacts])];
  const invalidEvidence = evidence.filter((reference) => !allowedEvidence.has(reference));
  if (invalidEvidence.length) throw new Error(`VERIFICATION_EVIDENCE_INVALID:${invalidEvidence.join(",")}`);
  const firstFinding = parsed.findings[0];
  const state = parsed.verdict === "APPROVED" && parsed.findings.length === 0 ? "RESOLVED" : parsed.verdict === "CHANGES_REQUIRED" ? "STILL_ACTIVE" : "VERIFICATION_FAILED";
  return { reviewerId, state, evidence, invalidEvidence, explanation: state === "RESOLVED" ? `The reviewer approved the bounded ${config.groupId} correction with no remaining findings.` : firstFinding?.summary ?? parsed.blockedReason ?? "Reviewer verification did not confirm closure.", remainingIssue: state === "RESOLVED" ? null : firstFinding?.summary ?? parsed.blockedReason ?? "Reviewer verification did not confirm closure.", providerVerdict: parsed.verdict, structuredOutputValid: true, evidenceValid: true, realGptCalls };
}

function verificationInput(reviewerId: ReviewerId, currentHead: string, evidence: Awaited<ReturnType<typeof buildEvidence>>, diff: string, config: CorrectionConfig) {
  return {
    verificationType: "targeted-correction-verification",
    groupId: config.groupId,
    findingIds: config.findingIds,
    reviewerId,
    currentHead,
    correctionSnapshot: "working-tree-before-correction-commit",
    originalFindings: config.originalFindings,
    correctionGoal: config.correctionGoal,
    trustBoundary: config.trustBoundary,
    nonGoals: config.nonGoals,
    verificationQuestion: config.groupId === CG06_GROUP_ID ? "Does the current cg-06 correction preserve meaningful database configuration failure semantics through the affected Factory CLI script boundary, so missing or failed pool construction cannot be mistaken for valid empty or successful state, while preserving the existing persistence architecture? Return APPROVED with no findings only when pool construction is protected, safe typed codes and nonzero exits are deterministic, and the four-script regression evidence is valid. Do not report fresh repository findings or unrelated correction groups." : config.groupId === CG05_GROUP_ID ? "Does the current cg-05 revision-2 correction preserve the Architecture-approved durable Design state and ensure selectDesignDirection rejects any request whose projectVersion differs from the trusted current FactoryProject.currentVersion before replay or mutation, resolving only the two assigned findings? Return APPROVED with no findings only when the typed request, trusted durable version source, guard ordering, stale no-side-effect regression, current-version success, and existing checksum/idempotency behavior are evidenced. Do not report fresh repository findings or unrelated correction groups." : config.groupId === CG04_GROUP_ID ? "Does the current cg-04 correction resolve the exact assigned provider-configuration and external-work-lifecycle findings without introducing a regression in the reviewed boundary? Return APPROVED with no findings only when empty model configuration is rejected and configured concurrency remains truthful through cancellation and timeout settlement. Do not report fresh repository findings or unrelated correction groups." : config.groupId === CG03_GROUP_ID ? "Does the current cg-03 correction resolve the exact assigned storage-ownership finding/root cause without introducing a regression in the reviewed boundary? Return APPROVED with no findings only when the assigned storage ownership and access contract is resolved. Do not report fresh repository findings or unrelated correction groups." : "Does the current bounded cg-02 correction resolve only the assigned authentication, authorization, ownership, and RLS findings? Return APPROVED with no findings only when all six assigned root causes are resolved. Do not report fresh repository findings or unrelated correction groups.",
    evidenceCatalog: [...evidence.fixedRefs, ...evidence.slices.map(({ id, relativePath, startLine, endLine, checksum, currentHead: sliceHead, content }) => ({ id, relativePath, startLine, endLine, checksum, currentHead: sliceHead, content }))],
    correctionDiff: diff,
    deterministicChecks: config.deterministicChecks,
    outputEvidenceRule: "Use only evidenceRefs, affectedArtifacts, and reviewedArtifactRefs present in evidenceCatalog. Return the existing strict reviewer result schema only.",
  };
}

export async function runTargetedCorrectionVerification(root: string, config: CorrectionConfig) {
  const resolvedRoot = path.resolve(root);
  const currentHead = git(resolvedRoot, ["rev-parse", "--short", "HEAD"]);
  loadFactoryCliEnv(resolvedRoot);
  const providerConfig = readAiProviderConfig(process.env, true);
  const plan = JSON.parse(await readFile(path.resolve(resolvedRoot, PHASE6A_PLAN_PATH), "utf8")) as { phase6APlanIdentity: string; correctionGroups: Array<{ groupId: string }> };
  if (plan.phase6APlanIdentity !== PHASE6A_PLAN_IDENTITY || !plan.correctionGroups.some((group) => group.groupId === config.groupId)) throw new Error("VERIFICATION_PLAN_IDENTITY_INVALID");
  const evidence = await buildEvidence(resolvedRoot, config);
  const diff = correctionDiff(resolvedRoot, config);
  const events: Array<{ type: string; role?: string; requestId?: string; code?: string }> = [];
  const bundle = createProductionProviderBundle({ eventSink: (event) => events.push({ type: event.type, role: event.role, requestId: "requestId" in event ? event.requestId : undefined, code: "code" in event ? event.code : undefined }) });
  const selections: Record<ReviewerId, AgentSkillSelection> = {} as Record<ReviewerId, AgentSkillSelection>;
  const records: Array<Record<string, unknown>> = [];
  const outputs: Record<string, unknown> = {};
  for (const reviewerId of config.requiredReviewerIds) {
    selections[reviewerId] = await resolveSkills(resolvedRoot, reviewerId, config);
    const beforeCalls = events.filter((event) => event.type === "request.started").length;
    const input = verificationInput(reviewerId, currentHead, evidence, diff, config);
    const output = reviewerId === "security-reviewer"
      ? await bundle.securityReviewer.review({ ...input, idempotencyKey: `${config.idempotencyPrefix}:${config.groupId}:${reviewerId}:${currentHead}` } as never, undefined, selections[reviewerId].contexts, selections[reviewerId].identityChecksum)
      : reviewerId === "architecture-reviewer"
        ? await bundle.architectureReviewer.review({ ...input, idempotencyKey: `${config.idempotencyPrefix}:${config.groupId}:${reviewerId}:${currentHead}` } as never, undefined, selections[reviewerId].contexts, selections[reviewerId].identityChecksum)
        : reviewerId === "code-integration-reviewer"
          ? await bundle.codeIntegrationReviewer.review({ ...input, idempotencyKey: `${config.idempotencyPrefix}:${config.groupId}:${reviewerId}:${currentHead}` } as never, undefined, selections[reviewerId].contexts, selections[reviewerId].identityChecksum)
          : await bundle.contractAuditor.review({ ...input, idempotencyKey: `${config.idempotencyPrefix}:${config.groupId}:${reviewerId}:${currentHead}` } as never, undefined, selections[reviewerId].contexts, selections[reviewerId].identityChecksum);
    outputs[reviewerId] = output;
    const calls = events.filter((event) => event.type === "request.started").length - beforeCalls;
    records.push(classifyReviewerOutput(reviewerId, output, evidence.allowed, calls, config));
  }
  const state = StateSchema.parse(records.every((record) => record.state === "RESOLVED") ? "RESOLVED" : records.some((record) => record.state === "STILL_ACTIVE") ? "STILL_ACTIVE" : "VERIFICATION_FAILED");
  const artifact = {
    schemaVersion: 1,
    documentType: config.documentType,
    groupId: config.groupId,
    findingIds: config.findingIds,
    baselineCommit: currentHead,
    sourcePlanIdentity: PHASE6A_PLAN_IDENTITY,
    correctionSnapshot: "working-tree-before-correction-commit",
    reviewerResults: records,
    selectedSkills: Object.fromEntries(Object.entries(selections).map(([id, selection]) => [id, { selectedSkillIds: selection.selectedSkillIds, selectedSkillChecksums: selection.selectedSkillChecksums, identityChecksum: selection.identityChecksum }])),
    provider: { model: providerConfig.model, modelLabel: providerConfig.modelLabel, realGptCalls: events.filter((event) => event.type === "request.started").length, requestEvents: events },
    evidenceValidation: { valid: records.every((record) => record.evidenceValid === true), evidenceRefs: [...evidence.allowed].sort(), slices: evidence.slices.map((slice) => ({ id: slice.id, relativePath: slice.relativePath, startLine: slice.startLine, endLine: slice.endLine, checksum: slice.checksum, currentHead: slice.currentHead })) },
    phaseStatus: state,
  };
  await writeFile(path.resolve(resolvedRoot, config.machinePath), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(path.resolve(resolvedRoot, config.reportPath), `# ${config.title}\n\n- Status: **${state}**\n- Baseline commit: \`${currentHead}\`\n${config.requiredReviewerIds.map((id) => `- ${id}: **${String(records.find((record) => record.reviewerId === id)?.state)}**`).join("\n")}\n- Real GPT calls: **${artifact.provider.realGptCalls}**\n- Evidence validation: **${artifact.evidenceValidation.valid ? "PASS" : "FAIL"}**\n\nThe shared targeted correction verifier loaded the repository environment before provider configuration, selected only resolver-approved reviewer skills, supplied bounded current source slices, and asked only the assigned closure question.\n\nMachine result: \`${config.machinePath}\`\n`, "utf8");
  return { artifact, outputs, selections };
}

export async function runCg02Verification(root = process.cwd()) { return runTargetedCorrectionVerification(root, CG02_CONFIG); }
export async function runCg03Verification(root = process.cwd()) { return runTargetedCorrectionVerification(root, CG03_CONFIG); }
export async function runCg04Verification(root = process.cwd()) { return runTargetedCorrectionVerification(root, CG04_CONFIG); }
export async function runCg05Verification(root = process.cwd()) { return runTargetedCorrectionVerification(root, CG05_CONFIG); }
export async function runCg06Verification(root = process.cwd()) { return runTargetedCorrectionVerification(root, CG06_CONFIG); }

if (process.argv[1]?.endsWith("phase-6c-cg02-verification.ts")) {
  const runner = process.env.PHASE6_CORRECTION_GROUP === CG06_GROUP_ID ? runCg06Verification : process.env.PHASE6_CORRECTION_GROUP === CG05_GROUP_ID ? runCg05Verification : process.env.PHASE6_CORRECTION_GROUP === CG04_GROUP_ID ? runCg04Verification : process.env.PHASE6_CORRECTION_GROUP === CG03_GROUP_ID ? runCg03Verification : runCg02Verification;
  runner().then((result) => console.log(JSON.stringify({ status: result.artifact.phaseStatus, groupId: result.artifact.groupId, realGptCalls: result.artifact.provider.realGptCalls, reviewers: result.artifact.reviewerResults }, null, 2))).catch((error) => { console.error(error instanceof Error ? error.message : "VERIFICATION_FAILED"); process.exitCode = 1; });
}
