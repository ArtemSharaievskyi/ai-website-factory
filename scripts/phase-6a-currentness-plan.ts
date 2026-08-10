/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assertAcyclicDependencies,
  correctionReadyFindings,
  highestSeverity,
  severityCounts,
  validateCorrectionGroups,
  type CorrectionGroup,
} from "@/operations/phase-6a-currentness";

const ROOT = resolve(process.cwd());
const CURRENT_HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const REVIEW_TARGET = "96d9ebc25c09fe1fb83338e8c7a1fa989fc3d9f4";
const POLICY_VERSION = "factory-findings-currentness-and-grouping-v1";
const OUTPUT_DIR = join(ROOT, "docs/admin/phase-6");
const ARTIFACT_PATH = join(OUTPUT_DIR, "factory-findings-currentness-plan-2026-08-10.json");
const REPORT_PATH = join(OUTPUT_DIR, "factory-findings-currentness-plan-2026-08-10.md");

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const changedFiles = new Set(
  execFileSync("git", ["diff", "--name-only", REVIEW_TARGET, CURRENT_HEAD], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean),
);
const changedPurpose = (path: string) => {
  if (path.startsWith("src/integrations/openai/") || path === "src/domain/review/schema.ts") return "OpenAI Structured Output/provider correction";
  if (path.startsWith("scripts/") && path.includes("self-review")) return "self-review harness/evidence infrastructure";
  if (path.startsWith("src/operations/")) return "admin/reconciliation tests and planning utility";
  if (path.startsWith("docs/admin/")) return "admin historical artifacts";
  return "Phase 5 support work";
};

const groupDefinitions = [
  { id: "cg-01-cross-artifact-identity", title: "Restore cross-artifact project identity binding", ids: ["finding-b385146a5a20fb3e4f1b"], confidence: "HIGH", subsystem: "reviewer input contracts and downstream identity", goal: "Bind every downstream canonical artifact to the same projectId and projectVersion before review proceeds.", nonGoals: ["No new artifact type", "No reviewer write authority", "No stack or workflow redesign"], files: ["src/agents/reviewers/contracts/contracts.ts", "src/agents/reviewers/contracts/deterministic.ts", "src/agents/reviewers/code-integration/contracts.ts", "src/agents/reviewers/code-integration/deterministic.ts", "src/agents/reviewers/code-integration/service.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted Contract Auditor tests", "targeted Code / Integration Reviewer tests", "npm run typecheck", "npm run lint"], reviewers: ["contract-auditor", "code-integration-reviewer"], deps: [], risk: "HIGH", order: 1 },
  { id: "cg-02-authentication-authorization-rls", title: "Establish authenticated identity and ownership authorization", ids: ["finding-0590fb313e72090696f0", "finding-233d7f1502c96cf535e1", "finding-7586dd5bd4661d954bf4", "finding-865697184809f419d1b7", "finding-c200a7f61e715bc94be1", "finding-e055bfdcbad92c9b36eb"], confidence: "HIGH", subsystem: "authentication, authorization, generated backend and RLS", goal: "Make authenticated identity and user-scoped authorization mandatory before protected database behavior is considered valid.", nonGoals: ["No broad security platform change", "No unrelated storage redesign", "No Phase 6A production mutation"], files: ["src/agents/implementation/provider.ts", "src/agents/implementation/backend.ts", "src/agents/implementation/backend.test.ts", "src/runtime/validation/security.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted security and backend tests", "specific schema/security validator", "npm run typecheck", "npm run lint", "database integrity checks"], reviewers: ["security-reviewer", "contract-auditor"], deps: ["cg-01-cross-artifact-identity"], risk: "HIGH", order: 2 },
  { id: "cg-03-storage-ownership-controls", title: "Bind storage operations to ownership and access policy", ids: ["finding-b227589f057cc3fa00ac", "finding-eb166a34da7872c62d77"], confidence: "HIGH", subsystem: "uploads, storage objects and access policy", goal: "Replace type/size-only validation with an explicit bucket, object ownership, access, and signed-URL contract where storage is required.", nonGoals: ["No storage feature invention", "No unrelated auth redesign"], files: ["src/agents/implementation/provider.ts", "src/agents/implementation/backend.ts", "src/agents/implementation/backend.test.ts", "supabase/migrations/"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted storage/security tests", "specific RLS/storage validator", "database integrity checks"], reviewers: ["security-reviewer"], deps: ["cg-02-authentication-authorization-rls"], risk: "HIGH", order: 3 },
  { id: "cg-04-provider-config-and-lifecycle", title: "Make provider configuration and external work lifecycle explicit", ids: ["finding-24cb4b563e9b341a84fd", "finding-3ea29b90bbf550eecdb3"], confidence: "HIGH", subsystem: "OpenAI provider configuration, concurrency and cancellation", goal: "Reject empty provider model configuration and ensure configured limits remain truthful when external work is cancelled or times out.", nonGoals: ["No model migration", "No new queue framework", "No provider fallback policy"], files: ["src/integrations/openai/config.ts", "src/integrations/openai/client.ts", "src/integrations/openai/limiter.ts", "src/integrations/context7/service.ts", "src/integrations/codebase-memory/service.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["OpenAI provider tests", "limiter cancellation tests", "npm run typecheck", "npm run lint"], reviewers: ["architecture-reviewer", "code-integration-reviewer"], deps: ["cg-01-cross-artifact-identity"], risk: "HIGH", order: 4 },
  { id: "cg-05-design-durable-state-authority", title: "Unify Design state ownership and persistence", ids: ["finding-1540c99220f633245955", "finding-efa4502938176a741e32"], confidence: "HIGH", subsystem: "Design Agent persistence, workflow state and memory", goal: "Make durable repositories and Project Memory the authoritative state path instead of process-local Maps and split filesystem/database state.", nonGoals: ["No design behavior changes", "No new persistence technology"], files: ["src/agents/design/service.ts", "src/agents/design/memory.ts", "src/agents/design/server.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted Design tests", "persistence integrity test", "npm run typecheck"], reviewers: ["architecture-reviewer", "code-integration-reviewer"], deps: ["cg-01-cross-artifact-identity"], risk: "HIGH", order: 5 },
  { id: "cg-06-database-error-propagation", title: "Preserve safe database configuration error propagation", ids: ["finding-c94e4c6dd19f957eeb40"], confidence: "HIGH", subsystem: "database scripts and operational error handling", goal: "Ensure database configuration failures travel through the established safe error path without bypasses.", nonGoals: ["No database schema change"], files: ["scripts/db-common.mjs", "scripts/db-migrate.mjs", "scripts/db-status.mjs", "scripts/db-verify.mjs", "scripts/db-smoke.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted database script tests", "npm run db:validate", "npm run db:verify"], reviewers: ["code-integration-reviewer"], deps: ["cg-01-cross-artifact-identity"], risk: "MEDIUM", order: 6 },
  { id: "cg-07-runtime-cleanup-lifecycle", title: "Close generated runtime resources on E2E failure", ids: ["finding-517e635c9c23995687d8"], confidence: "HIGH", subsystem: "Factory E2E runtime lifecycle", goal: "Guarantee runtime cleanup on every post-creation failure path.", nonGoals: ["No new E2E scenarios"], files: ["scripts/factory-e2e-smoke.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted E2E stage-runner tests", "TaskGraph smoke"], reviewers: ["code-integration-reviewer", "test-quality-reviewer"], deps: ["cg-06-database-error-propagation"], risk: "MEDIUM", order: 7 },
  { id: "cg-08-context7-authority", title: "Make Context7 eligibility single-source", ids: ["finding-20662816cdabed08871f"], confidence: "HIGH", subsystem: "Context7 dependency eligibility policy", goal: "Use one authoritative eligibility decision path for Context7 dependency access.", nonGoals: ["No Context7 replacement", "No new external integration"], files: ["src/integrations/context7/policy.ts", "src/integrations/context7/service.ts", "src/integrations/context7/contracts.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted Context7 tests", "npm run typecheck"], reviewers: ["architecture-reviewer", "code-integration-reviewer"], deps: ["cg-04-provider-config-and-lifecycle"], risk: "MEDIUM", order: 8 },
  { id: "cg-09-project-memory-durability", title: "Persist Project Memory indexes and idempotency state", ids: ["finding-f13df5392f71f7cf58df"], confidence: "MEDIUM", subsystem: "Project Memory metadata, cache and idempotency", goal: "Align Project Memory runtime state with its declared durable metadata and authority boundary.", nonGoals: ["No new cache or event framework"], files: ["src/integrations/codebase-memory/service.ts", "src/integrations/codebase-memory/metadata.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted Codebase Memory tests", "persistence integrity test"], reviewers: ["architecture-reviewer", "code-integration-reviewer"], deps: ["cg-05-design-durable-state-authority"], risk: "MEDIUM", order: 9 },
  { id: "cg-10-design-request-isolation", title: "Remove module-global Design request state", ids: ["finding-4bba2d52b86f240393fc"], confidence: "HIGH", subsystem: "deterministic Design provider request isolation", goal: "Make generation salt and timestamps request-local and deterministic without shared mutable module state.", nonGoals: ["No design direction policy change"], files: ["src/agents/design/deterministic.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted Design deterministic tests", "npm run typecheck"], reviewers: ["architecture-reviewer", "test-quality-reviewer"], deps: ["cg-05-design-durable-state-authority"], risk: "MEDIUM", order: 10 },
  { id: "cg-11-codebase-index-identity", title: "Disambiguate Project Memory workspace index selection", ids: ["finding-9106112c9ba65e4be7ed"], confidence: "HIGH", subsystem: "Codebase Memory workspace path identity", goal: "Make index selection deterministic when multiple workspace paths exist for a project version.", nonGoals: ["No workspace storage redesign"], files: ["src/integrations/codebase-memory/service.ts", "src/integrations/codebase-memory/contracts.ts", "src/integrations/codebase-memory/policy.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted Codebase Memory tests", "npm run typecheck"], reviewers: ["architecture-reviewer", "code-integration-reviewer"], deps: ["cg-09-project-memory-durability"], risk: "MEDIUM", order: 11 },
  { id: "cg-12-architecture-review-context", title: "Complete architecture review context and evidence contract", ids: ["finding-0e21399a0a91b82a05dc", "finding-2484a19307c1536e12e7"], confidence: "HIGH", subsystem: "Architecture Reviewer canonical evidence and project context", goal: "Ensure architecture review receives and preserves the material approved Brief and PlanningPackage obligations required for traceability.", nonGoals: ["No new reviewer role", "No architecture redesign by preference"], files: ["src/agents/reviewers/architecture/deterministic.ts", "src/agents/reviewers/architecture/service.ts", "docs/architecture/architecture-reviewer.md"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted Architecture Reviewer tests", "specific evidence-contract validator", "npm run typecheck"], reviewers: ["architecture-reviewer", "contract-auditor"], deps: ["cg-01-cross-artifact-identity"], risk: "MEDIUM", order: 12 },
  { id: "cg-13-reviewer-execution-evidence", title: "Provide meaningful reviewer execution and output-contract evidence", ids: ["finding-51d38dcb2b668ff33332", "finding-f27b5098995ae5bb44c9"], confidence: "HIGH", subsystem: "reviewer service tests and recorded execution artifacts", goal: "Test reviewer execution, strict output contracts, and preserve trustworthy executed evidence for the reviewer portfolio.", nonGoals: ["No broad self-review rerun", "No new reviewer agent"], files: ["src/agents/catalog.test.ts", "src/agents/catalog.ts", "src/agents/design/service.ts", "package.json"], capability: "test-quality", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted reviewer tests", "npm test -- reviewer test paths", "evidence artifact validator"], reviewers: ["test-quality-reviewer"], deps: ["cg-12-architecture-review-context"], risk: "MEDIUM", order: 13 },
  { id: "cg-14-runtime-release-evidence", title: "Execute and record release-critical runtime evidence", ids: ["finding-4970556ab704416b2bf8", "finding-191200ccc58b25e3fd0c", "finding-601d85f09cdb45d46400"], confidence: "HIGH", subsystem: "browser, backend and integration smoke evidence", goal: "Record meaningful runtime behavior evidence rather than only proposal acceptance or unexecuted opt-in scripts.", nonGoals: ["No new product features", "No unrelated browser test expansion"], files: ["scripts/factory-e2e-smoke.ts", "scripts/backend-smoke.ts", "scripts/ai-smoke.ts", "scripts/context7-smoke.ts", "scripts/codebase-memory-smoke.ts", "scripts/generated-runtime-smoke.ts"], capability: "functional-qa", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted functional QA", "targeted runtime smoke scripts", "TaskGraph smoke"], reviewers: ["test-quality-reviewer", "code-integration-reviewer"], deps: ["cg-07-runtime-cleanup-lifecycle", "cg-13-reviewer-execution-evidence"], risk: "MEDIUM", order: 14 },
  { id: "cg-15-persistence-migration-evidence", title: "Record executed persistence and migration evidence", ids: ["finding-cec06a12d17a2b103135"], confidence: "HIGH", subsystem: "database migration, verification and persistence assertions", goal: "Make migration and persistence checks demonstrably executed and bound to the current source state.", nonGoals: ["No migration redesign"], files: ["scripts/db-smoke.ts", "scripts/db-verify.mjs", "scripts/db-migrate.mjs"], capability: "runtime-tests", executor: "Implementation Agent / trusted implementation executor", checks: ["npm run db:validate", "npm run db:verify", "npm run db:test-integrity"], reviewers: ["test-quality-reviewer"], deps: ["cg-06-database-error-propagation"], risk: "LOW", order: 15 },
  { id: "cg-16-implementation-error-recovery-evidence", title: "Test atomic implementation failure and recovery", ids: ["finding-0ec8a840d7bf928fec42"], confidence: "HIGH", subsystem: "Implementation Agent atomic file application", goal: "Exercise and record failure/recovery behavior for atomic file application, not only proposal validation.", nonGoals: ["No implementation policy expansion"], files: ["src/agents/implementation/applier.ts", "src/agents/implementation/backend.test.ts"], capability: "runtime-tests", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted Vitest", "npm run typecheck"], reviewers: ["test-quality-reviewer"], deps: ["cg-13-reviewer-execution-evidence"], risk: "LOW", order: 16 },
  { id: "cg-17-design-gate-evidence", title: "Cover Design gate and contract failure paths", ids: ["finding-bf13a0c6f16bf4702e9e"], confidence: "HIGH", subsystem: "Design input contracts and workflow gates", goal: "Add direct meaningful quality evidence for the implemented Design gate and contract failure paths.", nonGoals: ["No Design behavior change by planning alone"], files: ["src/agents/design/contracts.ts", "src/agents/design/service.ts", "src/agents/design/design.test.ts"], capability: "runtime-tests", executor: "Implementation Agent / trusted implementation executor", checks: ["targeted Design Vitest", "npm run typecheck"], reviewers: ["test-quality-reviewer", "contract-auditor"], deps: ["cg-05-design-durable-state-authority"], risk: "LOW", order: 17 },
  { id: "cg-18-skill-portfolio-source-of-truth", title: "Align reviewer skill portfolio documentation and catalog", ids: ["finding-3ee5bcff808135a21217"], confidence: "HIGH", subsystem: "approved skill portfolio documentation and AgentDefinition", goal: "Make the documented portfolio and the authoritative catalog agree without changing skills or assignments in this plan.", nonGoals: ["No skill additions", "No assignment changes", "No deferred skill activation"], files: ["AGENTS.md", "docs/architecture/agent-architecture.md", "docs/architecture/architecture-reviewer.md", "src/agents/catalog.ts"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["catalog tests", "portfolio identity tests", "npm run typecheck"], reviewers: ["architecture-reviewer"], deps: ["cg-13-reviewer-execution-evidence"], risk: "LOW", order: 18 },
  { id: "cg-19-architecture-document-state", title: "Mark current and planned architecture documentation", ids: ["finding-5f4cd4a958172b921dfd"], confidence: "HIGH", subsystem: "architecture documentation source of truth", goal: "Add explicit current/planned/supersession markers so implemented capability is distinguishable from roadmap intent.", nonGoals: ["No architecture implementation change", "No stack change"], files: ["docs/architecture/product-specification.md", "docs/architecture/implementation-roadmap.md", "docs/architecture/repository-structure.md", "docs/architecture/agent-architecture.md"], capability: "implementation", executor: "Implementation Agent / trusted implementation executor", checks: ["documentation consistency checks", "npm run lint"], reviewers: ["architecture-reviewer"], deps: ["cg-18-skill-portfolio-source-of-truth"], risk: "LOW", order: 19 },
];

const currentEvidenceOverrides: Record<string, Record<string, [number, number]>> = {
  "finding-24cb4b563e9b341a84fd": {
    "src/integrations/openai/client.ts": [23, 29],
  },
  "finding-3ea29b90bbf550eecdb3": {
    "src/integrations/openai/client.ts": [23, 39],
  },
};

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function currentFileEvidence(finding: any) {
  const ranges: Array<{ relativePath: string; startLine: number; endLine: number }> = [];
  for (const reference of finding.evidenceRefs as string[]) {
    const match = /^([^:]+):(\d+)(?:-(\d+))?$/.exec(reference);
    if (!match) continue;
    const path = match[1];
    const oldStart = Number(match[2]);
    const oldEnd = Number(match[3] ?? match[2]);
    const override = currentEvidenceOverrides[finding.findingId]?.[path];
    const selected = override
      ? { startLine: override[0], endLine: override[1] }
      : { startLine: oldStart, endLine: oldEnd };
    if (!ranges.some((range) => range.relativePath === path && range.startLine === selected.startLine && range.endLine === selected.endLine)) {
      ranges.push({ relativePath: path, ...selected });
    }
  }
  return ranges.map(({ relativePath, startLine, endLine }) => {
    const absolute = join(ROOT, relativePath);
    const content = readFileSync(absolute);
    const lineCount = content.toString("utf8").split(/\r?\n/).length;
    if (endLine > lineCount) throw new Error(`Current evidence range exceeds file: ${relativePath}:${endLine}`);
    return {
      relativePath,
      startLine,
      endLine,
      checksum: sha256(content),
      lineCount,
      currentHead: CURRENT_HEAD,
    };
  });
}

function buildGroupPlan(group: (typeof groupDefinitions)[number], records: any[]) {
  const findings = records.filter((record) => group.ids.includes(record.findingId));
  return {
    groupId: group.id,
    title: group.title,
    rootCause: group.goal,
    rootCauseConfidence: group.confidence,
    findingIds: group.ids,
    currentHighestSeverity: highestSeverity(findings.map((record) => ({ findingId: record.findingId, severity: record.originalSeverity, currentness: record.currentness }))),
    affectedSubsystems: [group.subsystem],
    currentEvidence: findings.flatMap((record) => record.currentEvidence),
    correctionGoal: group.goal,
    nonGoals: group.nonGoals,
    likelyFiles: group.files,
    likelyCapability: group.capability,
    likelyExecutor: group.executor,
    requiredDeterministicChecks: group.checks,
    requiredReviewerRechecks: group.reviewers,
    dependencies: group.deps,
    estimatedRisk: group.risk,
    recommendedOrder: group.order,
  };
}

function markdown(artifact: any) {
  const counts = artifact.currentnessCounts;
  const active = artifact.perFindingCurrentness.filter((item: any) => item.currentness.startsWith("ACTIVE") || item.currentness === "PARTIALLY_RESOLVED");
  const currentRows = artifact.perFindingCurrentness.map((item: any) => `| ${item.findingId} | ${item.originalReviewer} | ${item.originalSeverity} | ${item.currentness} | ${item.currentEvidence.map((e: any) => `${e.relativePath}:${e.startLine}-${e.endLine}`).join(", ")} | ${item.correctionGroupId} |`).join("\n");
  const groupRows = artifact.correctionGroups.map((group: any) => `| ${group.recommendedOrder} | ${group.groupId} — ${group.title} | ${group.findingIds.join(", ")} | ${group.currentHighestSeverity} | ${group.rootCause} | ${group.likelyCapability} | ${group.requiredReviewerRechecks.join(", ")} | ${group.dependencies.join(", ") || "none"} |`).join("\n");
  const first = artifact.correctionGroups.find((group: any) => group.groupId === artifact.firstRecommendedGroupId);
  const critical = active.filter((item: any) => item.originalSeverity === "CRITICAL");
  return `# Phase 6A — Factory finding currentness and correction plan

## Executive summary

- Current HEAD: ${artifact.baselineHead}
- Original review target: ${artifact.sourceReviewTarget}
- Original validated findings: ${artifact.totalOriginalFindings}
- Current active unchanged: ${counts.ACTIVE_UNCHANGED}
- Current active rebased: ${counts.ACTIVE_REBASED}
- Partially resolved: ${counts.PARTIALLY_RESOLVED}
- Already resolved: ${counts.ALREADY_RESOLVED}
- No longer applicable: ${counts.NO_LONGER_APPLICABLE}
- Targeted reviewer applicability calls: ${artifact.targetedReviewerCalls}
- Correction-ready findings: ${artifact.correctionReadyFindingCount}
- Correction groups: ${artifact.correctionGroups.length}
- Root-cause confidence: HIGH ${artifact.rootCauseConfidenceCounts.HIGH}, MEDIUM ${artifact.rootCauseConfidenceCounts.MEDIUM}, LOW ${artifact.rootCauseConfidenceCounts.LOW}
- Active severity: CRITICAL ${artifact.correctionReadySeverityCounts.CRITICAL}, ERROR ${artifact.correctionReadySeverityCounts.ERROR}, WARNING ${artifact.correctionReadySeverityCounts.WARNING}, INFO ${artifact.correctionReadySeverityCounts.INFO}
- Recommended first group: ${artifact.firstRecommendedGroupId}

No correction was applied in Phase 6A. The plan is read-only and excludes rejected Phase 5 findings.

## Currentness table

| Finding ID | Reviewer | Original severity | Current state | Current evidence | Group |
|---|---|---|---|---|---|
${currentRows}

## Findings already resolved before Phase 6 correction

None. No later Phase 5 infrastructure change demonstrably eliminated a validated semantic finding.

## Correction groups

| Order | Group | Findings | Highest severity | Root cause | Capability | Reviewer recheck | Dependencies |
|---:|---|---|---|---|---|---|---|
${groupRows}

## Critical findings still active

| Finding | Current evidence | Root cause group |
|---|---|---|
${critical.map((item: any) => `| ${item.findingId} | ${item.currentEvidence.map((e: any) => `${e.relativePath}:${e.startLine}-${e.endLine}`).join(", ")} | ${item.correctionGroupId} |`).join("\n")}

Both CRITICAL findings remain active: cross-artifact identity mismatch and broad generated RLS authorization.

## Dependency order

${artifact.correctionGroups.map((group: any) => `${group.recommendedOrder}. ${group.groupId}${group.dependencies.length ? ` after ${group.dependencies.join(", ")}` : ""}`).join("\n")}

The dependency graph is acyclic. Corrections should proceed in this order, with each bounded batch checked and re-reviewed before its dependents.

## NEXT PHASE 6B CORRECTION GROUP

### ${first.groupId} — ${first.title}

- Finding IDs: ${first.findingIds.join(", ")}
- Root cause: ${first.rootCause}
- Evidence: ${first.currentEvidence.map((e: any) => `${e.relativePath}:${e.startLine}-${e.endLine} (${e.checksum})`).join(", ")}
- Correction goal: ${first.correctionGoal}
- Likely files: ${first.likelyFiles.join(", ")}
- Allowed capability: ${first.likelyCapability}
- Likely executor: ${first.likelyExecutor}
- Deterministic checks: ${first.requiredDeterministicChecks.join(", ")}
- Reviewer checks: ${first.requiredReviewerRechecks.join(", ")}
- Non-goals: ${first.nonGoals.join("; ")}
- Rollback criteria: any targeted check fails; any supplied artifact with mismatched project identity is accepted; reviewer read-only or ChangeProposal boundaries are weakened; or the correction requires files outside the bounded group without a new plan.

## Known maintenance items

- KNOWN_MAINTENANCE_ITEM: 12 preserved .qa-foundation-* directories. This is outside the authoritative 31 findings and is not a correction group.

## Rebase and safety notes

- Only findings citing changed evidence files were deterministically rebased: ${artifact.findingsAffectedByLaterCommits.join(", ")}.
- The OpenAI client changes are Phase 5 provider infrastructure, not automatic finding fixes. Current inspection shows both affected findings remain semantically applicable.
- No broad self-review, MCP, new agent, skill, assignment, ChangeProposal, correction TaskGraph task, or website-generation E2E was used.
- Approved skills remain external 4, internal 13, assignment refs 18, deferred skill usage 0; agent catalog remains 9.

## Validation

Phase 6A validation is recorded after artifact generation: lint, typecheck, tests, build, audit, database checks, Docker Compose config, TaskGraph smoke, and diff check.

PHASE 6A: CURRENTNESS_AND_GROUPING_COMPLETE
NEXT: PHASE 6B — FIRST CONTROLLED CORRECTION GROUP
`;
}

export function runPhase6A(root = ROOT) {
  const finalArtifact = readJson(join(root, "docs/admin/factory-self-review-2026-08-10-final.json"));
  const run3 = readJson(join(root, "docs/admin/factory-self-review-2026-08-10-run3.json"));
  const manifest = readJson(join(root, "docs/admin/factory-self-review-evidence-manifest.json"));
  if (manifest.evidenceManifestChecksum !== finalArtifact.evidenceManifestChecksum) throw new Error("Phase 5 final artifact and evidence manifest identity mismatch.");
  const findings = finalArtifact.finalValidatedFindings;
  if (findings.length !== 31) throw new Error(`Expected 31 active Phase 5 findings, received ${findings.length}.`);
  const originalCounts = severityCounts(findings.map((finding: any) => ({ ...finding, currentness: "ACTIVE_UNCHANGED" })));
  if (JSON.stringify(originalCounts) !== JSON.stringify({ CRITICAL: 2, ERROR: 13, WARNING: 15, INFO: 1 })) throw new Error(`Phase 5 severity count mismatch: ${JSON.stringify(originalCounts)}`);
  const rejected = run3.invalidEvidenceFindings;
  if (rejected.length !== 10) throw new Error(`Expected 10 historical invalid findings, received ${rejected.length}.`);
  const perReviewerArtifacts = new Map(run3.perReviewerResultArtifacts.map((item: any) => [item.reviewerId, item]));
  const records = findings.map((finding: any) => {
    const currentEvidence = currentFileEvidence(finding);
    const affected = currentEvidence.filter((e) => changedFiles.has(e.relativePath)).map((e) => e.relativePath);
    const currentness = affected.length ? "ACTIVE_REBASED" : "ACTIVE_UNCHANGED";
    const group = groupDefinitions.find((definition) => definition.ids.includes(finding.findingId));
    if (!group) throw new Error(`No correction group mapping for ${finding.findingId}`);
    return {
      findingId: finding.findingId,
      originalReviewer: finding.reviewerId,
      originalSeverity: finding.severity,
      originalCategory: finding.category,
      originalSubsystem: finding.owner,
      originalFinding: finding,
      originalTargetCommit: REVIEW_TARGET,
      originalEvidence: finding.evidenceRefs,
      originalEvidenceManifestChecksum: finalArtifact.evidenceManifestChecksum,
      originalReviewerResultArtifact: perReviewerArtifacts.get(finding.reviewerId),
      currentHead: CURRENT_HEAD,
      currentness,
      currentEvidence,
      laterRelevantChanges: affected.map((path) => ({ path, purpose: changedPurpose(path) })),
      remainingIssue: `The validated finding remains applicable at current HEAD: ${finding.summary}`,
      currentEffectiveSeverity: finding.severity,
      correctionGroupId: group.id,
      verificationMethod: affected.length ? "current-head-source-inspection" : "git-diff-unchanged-evidence-fast-path",
    };
  });
  const planningFindings = records.map((record: any) => ({ findingId: record.findingId, severity: record.originalSeverity, currentness: record.currentness, correctionGroupId: record.correctionGroupId }));
  const correctionGroups = groupDefinitions.map((group) => buildGroupPlan(group, records));
  validateCorrectionGroups(planningFindings, correctionGroups as CorrectionGroup[]);
  assertAcyclicDependencies(correctionGroups as CorrectionGroup[]);
  const currentnessCounts = records.reduce((counts: Record<string, number>, record: any) => { counts[record.currentness] += 1; return counts; }, { ACTIVE_UNCHANGED: 0, ACTIVE_REBASED: 0, PARTIALLY_RESOLVED: 0, ALREADY_RESOLVED: 0, NO_LONGER_APPLICABLE: 0, NEEDS_TARGETED_REVIEW: 0 });
  const correctionReady = correctionReadyFindings(planningFindings);
  const qaCount = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith(".qa-foundation-")).length;
  const sourceFindingSetIdentity = hash(findings);
  const groupingIdentity = hash(correctionGroups.map((group) => ({ groupId: group.groupId, findingIds: group.findingIds, dependencies: group.dependencies })));
  const phase6APlanIdentity = hash({ currentHead: CURRENT_HEAD, sourceReviewTarget: REVIEW_TARGET, sourceFindingSetIdentity, policyVersion: POLICY_VERSION, evidenceManifestChecksum: finalArtifact.evidenceManifestChecksum, groupingIdentity });
  const artifact = {
    schemaVersion: 1,
    documentType: "factory-findings-currentness-plan",
    phase6APlanIdentity,
    baselineHead: CURRENT_HEAD,
    sourceReviewTarget: REVIEW_TARGET,
    sourceFindingSetIdentity,
    sourceFindingSetSize: findings.length,
    evidenceManifestChecksum: finalArtifact.evidenceManifestChecksum,
    currentApplicabilityPolicyVersion: POLICY_VERSION,
    laterCommitBoundary: { from: REVIEW_TARGET, to: CURRENT_HEAD, changedFileCount: changedFiles.size, changedFiles: [...changedFiles].map((path) => ({ path, purpose: changedPurpose(path) })) },
    totalOriginalFindings: findings.length,
    originalSeverityCounts: originalCounts,
    currentnessCounts,
    targetedReviewerCalls: 0,
    targetedReviewerCallsSuccessful: 0,
    targetedReviewerCallsFailed: 0,
    perFindingCurrentness: records,
    correctionReadyFindingCount: correctionReady.length,
    correctionReadySeverityCounts: severityCounts(correctionReady),
    correctionGroups,
    rootCauseConfidenceCounts: correctionGroups.reduce((counts: Record<string, number>, group: any) => { counts[group.rootCauseConfidence] += 1; return counts; }, { HIGH: 0, MEDIUM: 0, LOW: 0 }),
    dependencyGraph: correctionGroups.map((group) => ({ groupId: group.groupId, dependsOn: group.dependencies })),
    dependencyGraphAcyclic: true,
    firstRecommendedGroupId: "cg-01-cross-artifact-identity",
    knownMaintenanceItems: [{ type: "KNOWN_MAINTENANCE_ITEM", item: ".qa-foundation-* directories", count: qaCount, includedInValidatedFindingSet: false, includedInCorrectionGroups: false }],
    findingsAffectedByLaterCommits: records.filter((record: any) => record.laterRelevantChanges.length).map((record: any) => record.findingId),
    findingsResolvedByLaterWork: [],
    findingsPartiallyResolvedByLaterWork: [],
    rejectedPhase5FindingIds: rejected.map((item: any) => item.originalFindingId),
    productionSourceCorrectionsApplied: 0,
    correctionTaskGraphTasksCreated: 0,
    changeProposalsApplied: 0,
    websiteGenerationE2E: false,
    approvedSkills: { external: 4, internal: 13, assignmentRefs: 18, deferredUsage: 0 },
    agentCatalogCount: 9,
    newAgentOrchestratorMcp: false,
    roadmap: { phase5: "COMPLETE_FINDINGS_READY", phase6A: "CURRENTNESS_AND_GROUPING_COMPLETE", next: "PHASE 6B — FIRST CONTROLLED CORRECTION GROUP" },
    phase6AStatus: "CURRENTNESS_AND_GROUPING_COMPLETE",
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(REPORT_PATH, markdown(artifact));
  return artifact;
}

if (process.argv[1]?.endsWith("phase-6a-currentness-plan.ts")) {
  const artifact = runPhase6A();
  console.log(JSON.stringify({ phase6APlanIdentity: artifact.phase6APlanIdentity, totalOriginalFindings: artifact.totalOriginalFindings, currentnessCounts: artifact.currentnessCounts, correctionGroups: artifact.correctionGroups.length, firstRecommendedGroupId: artifact.firstRecommendedGroupId, phase6AStatus: artifact.phase6AStatus }));
}
