import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { contractAuditorAgentDefinition, securityReviewerAgentDefinition } from "@/agents/catalog";
import { ContractAuditProviderOutputSchema, SecurityReviewProviderOutputSchema } from "@/domain/review/schema";
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
export const PHASE6A_PLAN_IDENTITY = "819b825a599793b3bcf3b82ec48df40e13fb1dfc7f1f632585f8ce83b36dfd00" as const;
export const PHASE6A_PLAN_PATH = "docs/admin/phase-6/factory-findings-currentness-plan-2026-08-10.json" as const;
export const VERIFICATION_MACHINE_PATH = "docs/admin/phase-6/cg-02-authentication-authorization-rls-verification-2026-08-10.json" as const;
export const VERIFICATION_REPORT_PATH = "docs/admin/phase-6/cg-02-authentication-authorization-rls-verification-2026-08-10.md" as const;

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const git = (root: string, args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const StateSchema = z.enum(["RESOLVED", "PARTIALLY_RESOLVED", "STILL_ACTIVE", "REGRESSION_FOUND", "VERIFICATION_FAILED"]);
type ReviewerId = "security-reviewer" | "contract-auditor";
type EvidenceSlice = { id: string; relativePath: string; startLine: number; endLine: number; checksum: string; currentHead: string; content: string };

async function currentSlice(root: string, id: string, relativePath: string, startLine: number, endLine: number): Promise<EvidenceSlice> {
  const bytes = await readFile(path.resolve(root, relativePath));
  const lines = bytes.toString("utf8").split(/\r?\n/);
  if (startLine < 1 || endLine < startLine || endLine > lines.length) throw new Error(`VERIFICATION_EVIDENCE_RANGE_INVALID:${relativePath}:${startLine}-${endLine}`);
  return { id, relativePath, startLine, endLine, checksum: sha256(bytes), currentHead: git(root, ["rev-parse", "--short", "HEAD"]), content: lines.slice(startLine - 1, endLine).join("\n") };
}

async function buildEvidence(root: string) {
  const slices = await Promise.all([
    currentSlice(root, "current:implementation-provider", "src/agents/implementation/provider.ts", 1, 40),
    currentSlice(root, "current:implementation-backend", "src/agents/implementation/backend.ts", 1, 85),
    currentSlice(root, "current:security-validator", "src/runtime/validation/security.ts", 1, 35),
    currentSlice(root, "test:backend-security", "src/agents/implementation/backend.test.ts", 1, 25),
  ]);
  const fixedRefs = ["original-findings", "cg02-contract", "authentication-vs-authorization", "rls-ownership-contract", "deterministic-regression-tests"];
  return { slices, fixedRefs, allowed: new Set([...fixedRefs, ...slices.flatMap((slice) => [slice.id, `${slice.relativePath}:${slice.startLine}-${slice.endLine}`])]) };
}

function correctionDiff(root: string) {
  return git(root, ["diff", "--no-ext-diff", "--unified=3", "--", "src/agents/implementation/provider.ts", "src/agents/implementation/backend.ts", "src/runtime/validation/security.ts", "src/agents/implementation/backend.test.ts", "scripts/backend-smoke.ts"]).slice(0, 24000);
}

async function resolveSkills(root: string, reviewerId: ReviewerId): Promise<AgentSkillSelection> {
  const registry = new SkillRegistry(path.resolve(root, "skills"));
  if (reviewerId === "security-reviewer") return prepareAgentSkillContext(registry, { agent: securityReviewerAgentDefinition, capability: "review.security", taskType: "review-security", projectSurfaces: ["supabase", "postgres", "rls", "database", "auth", "sessions", "ownership"], requiredCoverage: ["supabase-rls", "row-level-authorization", "auth-security"], requestedTools: [], contextBudgetBytes: securityReviewerAgentDefinition.contextPolicy.maxBytes });
  return prepareAgentSkillContext(registry, { agent: contractAuditorAgentDefinition, capability: "review.contracts", taskType: "review-contracts", projectSurfaces: ["requirements", "contracts", "traceability", "auth", "database", "ownership"], requiredCoverage: ["requirements-traceability", "cross-stage-consistency", "traceability-evidence"], requestedTools: [], contextBudgetBytes: contractAuditorAgentDefinition.contextPolicy.maxBytes });
}

function classifyReviewerOutput(reviewerId: ReviewerId, output: unknown, allowedEvidence: ReadonlySet<string>, realGptCalls: number) {
  const parsed = reviewerId === "security-reviewer" ? SecurityReviewProviderOutputSchema.parse(output) : ContractAuditProviderOutputSchema.parse(output);
  const evidence = [...parsed.reviewedArtifactRefs, ...parsed.findings.flatMap((finding) => [...finding.evidenceRefs, ...finding.affectedArtifacts])];
  const invalidEvidence = evidence.filter((reference) => !allowedEvidence.has(reference));
  if (invalidEvidence.length) throw new Error(`VERIFICATION_EVIDENCE_INVALID:${invalidEvidence.join(",")}`);
  const firstFinding = parsed.findings[0];
  const state = parsed.verdict === "APPROVED" && parsed.findings.length === 0 ? "RESOLVED" : parsed.verdict === "CHANGES_REQUIRED" ? "STILL_ACTIVE" : "VERIFICATION_FAILED";
  return { reviewerId, state, evidence, invalidEvidence, explanation: state === "RESOLVED" ? "The reviewer approved the bounded cg-02 correction with no remaining findings." : firstFinding?.summary ?? parsed.blockedReason ?? "Reviewer verification did not confirm closure.", remainingIssue: state === "RESOLVED" ? null : firstFinding?.summary ?? parsed.blockedReason ?? "Reviewer verification did not confirm closure.", providerVerdict: parsed.verdict, structuredOutputValid: true, evidenceValid: true, realGptCalls };
}

function verificationInput(reviewerId: ReviewerId, currentHead: string, evidence: Awaited<ReturnType<typeof buildEvidence>>, diff: string) {
  return {
    verificationType: "targeted-correction-verification",
    groupId: CG02_GROUP_ID,
    findingIds: CG02_FINDING_IDS,
    reviewerId,
    currentHead,
    correctionSnapshot: "working-tree-before-correction-commit",
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
    verificationQuestion: "Does the current bounded cg-02 correction resolve only the assigned authentication, authorization, ownership, and RLS findings? Return APPROVED with no findings only when all six assigned root causes are resolved. Do not report fresh repository findings or unrelated correction groups.",
    evidenceCatalog: [...evidence.fixedRefs, ...evidence.slices.map(({ id, relativePath, startLine, endLine, checksum, currentHead, content }) => ({ id, relativePath, startLine, endLine, checksum, currentHead, content }))],
    correctionDiff: diff,
    deterministicChecks: ["server-side Supabase Auth getUser with fail-closed null handling", "protected handlers re-check identity and compare database owner to user.id", "protected schema binds user_id to auth.users", "RLS ownership predicates cover SELECT/INSERT/UPDATE/DELETE and write WITH CHECK", "no service-role credential or public policy"],
    outputEvidenceRule: "Use only evidenceRefs, affectedArtifacts, and reviewedArtifactRefs present in evidenceCatalog. Return the existing strict reviewer result schema only.",
  };
}

export async function runCg02Verification(root = process.cwd()) {
  const resolvedRoot = path.resolve(root);
  const currentHead = git(resolvedRoot, ["rev-parse", "--short", "HEAD"]);
  loadFactoryCliEnv(resolvedRoot);
  const config = readAiProviderConfig(process.env, true);
  const plan = JSON.parse(await readFile(path.resolve(resolvedRoot, PHASE6A_PLAN_PATH), "utf8")) as { phase6APlanIdentity: string; correctionGroups: Array<{ groupId: string }>; dependencyGraph: Array<{ groupId: string; dependsOn: string[] }> };
  if (plan.phase6APlanIdentity !== PHASE6A_PLAN_IDENTITY || !plan.correctionGroups.some((group) => group.groupId === CG02_GROUP_ID)) throw new Error("VERIFICATION_PLAN_IDENTITY_INVALID");
  const evidence = await buildEvidence(resolvedRoot);
  const diff = correctionDiff(resolvedRoot);
  const events: Array<{ type: string; role?: string; requestId?: string; code?: string }> = [];
  const bundle = createProductionProviderBundle({ eventSink: (event) => events.push({ type: event.type, role: event.role, requestId: "requestId" in event ? event.requestId : undefined, code: "code" in event ? event.code : undefined }) });
  const selections: Record<ReviewerId, AgentSkillSelection> = {} as Record<ReviewerId, AgentSkillSelection>;
  const records: Array<Record<string, unknown>> = [];
  const outputs: Record<string, unknown> = {};
  for (const reviewerId of ["security-reviewer", "contract-auditor"] as const) {
    selections[reviewerId] = await resolveSkills(resolvedRoot, reviewerId);
    const beforeCalls = events.filter((event) => event.type === "request.started").length;
    const input = verificationInput(reviewerId, currentHead, evidence, diff);
    const output = reviewerId === "security-reviewer"
      ? await bundle.securityReviewer.review({ ...input, idempotencyKey: `phase6c1:${CG02_GROUP_ID}:${reviewerId}:${currentHead}` } as never, undefined, selections[reviewerId].contexts, selections[reviewerId].identityChecksum)
      : await bundle.contractAuditor.review({ ...input, idempotencyKey: `phase6c1:${CG02_GROUP_ID}:${reviewerId}:${currentHead}` } as never, undefined, selections[reviewerId].contexts, selections[reviewerId].identityChecksum);
    outputs[reviewerId] = output;
    const calls = events.filter((event) => event.type === "request.started").length - beforeCalls;
    records.push(classifyReviewerOutput(reviewerId, output, evidence.allowed, calls));
  }
  const state = StateSchema.parse(records.every((record) => record.state === "RESOLVED") ? "RESOLVED" : records.some((record) => record.state === "STILL_ACTIVE") ? "STILL_ACTIVE" : "VERIFICATION_FAILED");
  const artifact = {
    schemaVersion: 1,
    documentType: "phase-6c-correction-verification",
    groupId: CG02_GROUP_ID,
    findingIds: CG02_FINDING_IDS,
    baselineCommit: currentHead,
    sourcePlanIdentity: PHASE6A_PLAN_IDENTITY,
    correctionSnapshot: "working-tree-before-correction-commit",
    reviewerResults: records,
    selectedSkills: Object.fromEntries(Object.entries(selections).map(([id, selection]) => [id, { selectedSkillIds: selection.selectedSkillIds, selectedSkillChecksums: selection.selectedSkillChecksums, identityChecksum: selection.identityChecksum }])),
    provider: { model: config.model, modelLabel: config.modelLabel, realGptCalls: events.filter((event) => event.type === "request.started").length, requestEvents: events },
    evidenceValidation: { valid: records.every((record) => record.evidenceValid === true), evidenceRefs: [...evidence.allowed].sort(), slices: evidence.slices.map((slice) => ({ id: slice.id, relativePath: slice.relativePath, startLine: slice.startLine, endLine: slice.endLine, checksum: slice.checksum, currentHead: slice.currentHead })) },
    phaseStatus: state,
  };
  await writeFile(path.resolve(resolvedRoot, VERIFICATION_MACHINE_PATH), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(path.resolve(resolvedRoot, VERIFICATION_REPORT_PATH), `# cg-02 Authentication, Authorization, and RLS Verification\n\n- Status: **${state}**\n- Baseline commit: \`${currentHead}\`\n- Security Reviewer: **${String(records.find((record) => record.reviewerId === "security-reviewer")?.state)}**\n- Contract Auditor: **${String(records.find((record) => record.reviewerId === "contract-auditor")?.state)}**\n- Real GPT calls: **${artifact.provider.realGptCalls}**\n- Evidence validation: **${artifact.evidenceValidation.valid ? "PASS" : "FAIL"}**\n\nThe verifier loaded the repository environment before provider configuration, selected only the approved reviewer skills, supplied bounded current source slices, and asked only the assigned cg-02 closure question.\n\nMachine result: \`${VERIFICATION_MACHINE_PATH}\`\n`, "utf8");
  return { artifact, outputs, selections };
}

if (process.argv[1]?.endsWith("phase-6c-cg02-verification.ts")) runCg02Verification().then((result) => console.log(JSON.stringify({ status: result.artifact.phaseStatus, realGptCalls: result.artifact.provider.realGptCalls, reviewers: result.artifact.reviewerResults }, null, 2))).catch((error) => { console.error(error instanceof Error ? error.message : "VERIFICATION_FAILED"); process.exitCode = 1; });
