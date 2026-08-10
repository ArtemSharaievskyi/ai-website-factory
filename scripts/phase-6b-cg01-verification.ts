import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  contractAuditorAgentDefinition,
  codeIntegrationReviewerAgentDefinition,
} from "@/agents/catalog";
import { ContractAuditProviderOutputSchema, CodeIntegrationReviewProviderOutputSchema } from "@/domain/review/schema";
import { prepareAgentSkillContext, type AgentSkillSelection } from "@/skills/runtime/resolver";
import { SkillRegistry } from "@/skills/registry/registry";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import { readAiProviderConfig, type AiProviderConfig } from "@/integrations/openai/config";
import { loadFactoryCliEnv } from "./cli-env";

export const CG01_GROUP_ID = "cg-01-cross-artifact-identity" as const;
export const CG01_FINDING_ID = "finding-b385146a5a20fb3e4f1b" as const;
export const CORRECTION_COMMIT = "ecae3a2" as const;
export const PHASE6A_PLAN_IDENTITY = "819b825a599793b3bcf3b82ec48df40e13fb1dfc7f1f632585f8ce83b36dfd00" as const;
export const VERIFICATION_MACHINE_PATH = "docs/admin/phase-6/cg-01-cross-artifact-identity-verification-2026-08-10.json" as const;
export const VERIFICATION_REPORT_PATH = "docs/admin/phase-6/cg-01-cross-artifact-identity-verification-2026-08-10.md" as const;
export const PHASE6A_PLAN_PATH = "docs/admin/phase-6/factory-findings-currentness-plan-2026-08-10.json" as const;

export const CorrectionVerificationStateSchema = z.enum(["RESOLVED", "PARTIALLY_RESOLVED", "STILL_ACTIVE", "REGRESSION_FOUND", "VERIFICATION_FAILED"]);
export type CorrectionVerificationState = z.infer<typeof CorrectionVerificationStateSchema>;
export const CorrectionVerificationRecordSchema = z.object({
  findingId: z.literal(CG01_FINDING_ID),
  reviewerId: z.enum(["contract-auditor", "code-integration-reviewer"]),
  state: CorrectionVerificationStateSchema,
  evidence: z.array(z.string().min(1)).min(1),
  explanation: z.string().min(1).max(2000),
  remainingIssue: z.string().nullable(),
  providerVerdict: z.enum(["APPROVED", "CHANGES_REQUIRED", "BLOCKED"]),
  structuredOutputValid: z.boolean(),
  evidenceValid: z.boolean(),
  realGptCalls: z.number().int().nonnegative(),
}).strict();
export type CorrectionVerificationRecord = z.infer<typeof CorrectionVerificationRecordSchema>;

type EvidenceSlice = { id: string; relativePath: string; startLine: number; endLine: number; checksum: string; content: string };
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const jsonChecksum = (value: unknown) => sha256(JSON.stringify(value));
const git = (root: string, args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

export function calculateUnblockedGroups(plan: { correctionGroups: readonly { groupId: string; currentHighestSeverity: string; recommendedOrder: number }[]; dependencyGraph: readonly { groupId: string; dependsOn: readonly string[] }[] }, completedGroups: readonly string[]) {
  const completed = new Set(completedGroups);
  const severityRank: Record<string, number> = { CRITICAL: 4, ERROR: 3, WARNING: 2, INFO: 1 };
  const eligible = plan.correctionGroups
    .filter((group) => !completed.has(group.groupId))
    .filter((group) => (plan.dependencyGraph.find((edge) => edge.groupId === group.groupId)?.dependsOn ?? []).every((dependency) => completed.has(dependency)))
    .sort((left, right) => (severityRank[right.currentHighestSeverity] ?? 0) - (severityRank[left.currentHighestSeverity] ?? 0) || left.recommendedOrder - right.recommendedOrder || left.groupId.localeCompare(right.groupId));
  return { unblockedGroups: eligible.map((group) => group.groupId), nextRecommendedGroup: eligible[0]?.groupId ?? null };
}

export function loadVerificationConfig(
  root: string,
  loader: (projectRoot: string) => void = loadFactoryCliEnv,
  reader: (env: Record<string, string | undefined>, requireKey?: boolean) => AiProviderConfig = readAiProviderConfig,
) {
  loader(root);
  return reader(process.env, true);
}

export function classifyReviewerOutput(
  reviewerId: CorrectionVerificationRecord["reviewerId"],
  output: unknown,
  allowedEvidence: ReadonlySet<string>,
  realGptCalls: number,
): CorrectionVerificationRecord {
  const parsed = reviewerId === "contract-auditor"
    ? ContractAuditProviderOutputSchema.parse(output)
    : CodeIntegrationReviewProviderOutputSchema.parse(output);
  const evidence = [
    ...parsed.reviewedArtifactRefs,
    ...parsed.findings.flatMap((finding) => [...finding.evidenceRefs, ...finding.affectedArtifacts]),
  ];
  const invalidEvidence = evidence.filter((reference) => !allowedEvidence.has(reference));
  if (invalidEvidence.length) throw new Error(`VERIFICATION_EVIDENCE_INVALID:${invalidEvidence.join(",")}`);
  const firstFinding = parsed.findings[0];
  const state: CorrectionVerificationState = parsed.verdict === "APPROVED" && parsed.findings.length === 0
    ? "RESOLVED"
    : parsed.verdict === "CHANGES_REQUIRED"
      ? "STILL_ACTIVE"
      : "VERIFICATION_FAILED";
  return CorrectionVerificationRecordSchema.parse({
    findingId: CG01_FINDING_ID,
    reviewerId,
    state,
    evidence,
    explanation: state === "RESOLVED"
      ? "The reviewer approved the bounded correction with no remaining findings."
      : firstFinding?.summary ?? parsed.blockedReason ?? "The reviewer did not provide a closure result.",
    remainingIssue: state === "RESOLVED" ? null : firstFinding?.summary ?? parsed.blockedReason ?? "Reviewer verification did not confirm closure.",
    providerVerdict: parsed.verdict,
    structuredOutputValid: true,
    evidenceValid: true,
    realGptCalls,
  });
}

async function currentSlice(root: string, id: string, relativePath: string, startLine: number, endLine: number): Promise<EvidenceSlice> {
  const absolute = path.resolve(root, relativePath);
  const bytes = await readFile(absolute);
  const lines = bytes.toString("utf8").split(/\r?\n/);
  if (startLine < 1 || endLine < startLine || endLine > lines.length) throw new Error(`VERIFICATION_EVIDENCE_RANGE_INVALID:${relativePath}:${startLine}-${endLine}`);
  return { id, relativePath, startLine, endLine, checksum: sha256(bytes), content: lines.slice(startLine - 1, endLine).join("\n") };
}

async function buildEvidence(root: string) {
  const slices = await Promise.all([
    currentSlice(root, "current:contracts-contract", "src/agents/reviewers/contracts/contracts.ts", 12, 50),
    currentSlice(root, "current:contracts-deterministic", "src/agents/reviewers/contracts/deterministic.ts", 31, 41),
    currentSlice(root, "current:contracts-service", "src/agents/reviewers/contracts/service.ts", 284, 294),
    currentSlice(root, "current:code-contract", "src/agents/reviewers/code-integration/contracts.ts", 19, 31),
    currentSlice(root, "test:contract-identity", "src/agents/reviewers/contracts/contracts.test.ts", 37, 37),
    currentSlice(root, "test:code-identity", "src/agents/reviewers/code-integration/code-integration.test.ts", 29, 37),
  ]);
  const fixedRefs = [
    "original-finding",
    "correction-goal",
    "project-identity-invariant",
    "checksum-vs-project-identity",
    "deterministic-regression-tests",
    "correction-diff:7670288..ecae3a2",
  ];
  return { slices, fixedRefs, allowed: new Set([...fixedRefs, ...slices.flatMap((slice) => [slice.id, `${slice.relativePath}:${slice.startLine}-${slice.endLine}`])]) };
}

function correctionDiff(root: string) {
  return git(root, ["diff", "--no-ext-diff", "--unified=3", "7670288", CORRECTION_COMMIT, "--", "src/agents/reviewers/contracts/contracts.ts", "src/agents/reviewers/contracts/deterministic.ts", "src/agents/reviewers/contracts/service.ts", "src/agents/reviewers/code-integration/contracts.ts"])
    .slice(0, 16000);
}

function verificationInput(reviewerId: CorrectionVerificationRecord["reviewerId"], currentHead: string, evidence: Awaited<ReturnType<typeof buildEvidence>>, diff: string) {
  return {
    verificationType: "targeted-correction-verification",
    groupId: CG01_GROUP_ID,
    findingId: CG01_FINDING_ID,
    reviewerId,
    currentHead,
    correctionCommit: CORRECTION_COMMIT,
    originalFinding: {
      severity: "CRITICAL",
      category: "IDENTITY_MISMATCH",
      summary: "The downstream input schemas accept multiple canonical artifacts with independently valid checksums but do not themselves bind those artifacts to the same project and version; checksum validation proves document integrity, not cross-artifact identity.",
      originalEvidence: ["src/agents/reviewers/contracts/contracts.ts:11-16", "src/agents/reviewers/contracts/deterministic.ts:24-28", "src/agents/reviewers/code-integration/contracts.ts:12-16", "src/agents/reviewers/code-integration/deterministic.ts:5-16", "src/agents/reviewers/code-integration/service.ts:65-83"],
    },
    correctionGoal: "Bind every downstream canonical artifact to the same projectId and projectVersion before review proceeds.",
    nonGoals: ["No new artifact type", "No reviewer write authority", "No stack or workflow redesign", "No unrelated Factory review"],
    verificationQuestion: "Does correction ecae3a2 resolve the original cg-01 finding at the current project identity boundary? Return APPROVED with no findings only when the correction fully resolves it. Use CHANGES_REQUIRED only if the original identity defect remains. Do not report unrelated findings.",
    evidenceCatalog: [
      ...evidence.fixedRefs,
      ...evidence.slices.map(({ id, relativePath, startLine, endLine, checksum, content }) => ({ id, relativePath, startLine, endLine, checksum, content })),
    ],
    correctionDiff: diff,
    deterministicChecks: ["mismatched project identity rejected", "matching project identity accepted", "checksum validity cannot bypass project identity", "unrelated content does not change logical project identity"],
    outputEvidenceRule: "Use only evidenceRefs, affectedArtifacts, and reviewedArtifactRefs present in evidenceCatalog. Return the existing strict reviewer result schema only.",
  };
}

async function resolveSkills(root: string, reviewerId: CorrectionVerificationRecord["reviewerId"]): Promise<AgentSkillSelection> {
  const registry = new SkillRegistry(path.resolve(root, "skills"));
  if (reviewerId === "contract-auditor") return prepareAgentSkillContext(registry, { agent: contractAuditorAgentDefinition, capability: "review.contracts", taskType: "review-contracts", projectSurfaces: ["requirements", "contracts", "traceability"], requiredCoverage: ["requirements-traceability", "cross-stage-consistency", "traceability-evidence"], requestedTools: [], contextBudgetBytes: contractAuditorAgentDefinition.contextPolicy.maxBytes });
  return prepareAgentSkillContext(registry, { agent: codeIntegrationReviewerAgentDefinition, capability: "review.integration", taskType: "review-code-integration", projectSurfaces: ["react", "nextjs", "components", "routes"], requiredCoverage: ["react-review", "nextjs-review"], requestedTools: [], contextBudgetBytes: codeIntegrationReviewerAgentDefinition.contextPolicy.maxBytes });
}

export async function runCg01Verification(root = process.cwd()) {
  const resolvedRoot = path.resolve(root);
  const currentHead = git(resolvedRoot, ["rev-parse", "--short", "HEAD"]);
  if (currentHead !== CORRECTION_COMMIT) throw new Error(`VERIFICATION_CURRENT_HEAD_INVALID:${currentHead}`);
  const config = loadVerificationConfig(resolvedRoot);
  const phase6APlan = JSON.parse(await readFile(path.resolve(resolvedRoot, PHASE6A_PLAN_PATH), "utf8")) as { phase6APlanIdentity: string; correctionGroups: { groupId: string; currentHighestSeverity: string; recommendedOrder: number }[]; dependencyGraph: { groupId: string; dependsOn: string[] }[] };
  if (phase6APlan.phase6APlanIdentity !== PHASE6A_PLAN_IDENTITY) throw new Error("VERIFICATION_PLAN_IDENTITY_INVALID");
  const evidence = await buildEvidence(resolvedRoot);
  const diff = correctionDiff(resolvedRoot);
  const events: Array<{ type: string; role?: string; requestId?: string; code?: string }> = [];
  const bundle = createProductionProviderBundle({ eventSink: (event) => events.push({ type: event.type, role: event.role, requestId: "requestId" in event ? event.requestId : undefined, code: "code" in event ? event.code : undefined }) });
  const selections: Record<string, AgentSkillSelection> = {};
  const records: CorrectionVerificationRecord[] = [];
  const outputs: Record<string, unknown> = {};
  for (const reviewerId of ["contract-auditor", "code-integration-reviewer"] as const) {
    selections[reviewerId] = await resolveSkills(resolvedRoot, reviewerId);
    const beforeCalls = events.filter((event) => event.type === "request.started").length;
    const input = verificationInput(reviewerId, currentHead, evidence, diff);
    const output = reviewerId === "contract-auditor"
      ? await bundle.contractAuditor.review({ ...input, idempotencyKey: `phase6b1:${CG01_GROUP_ID}:${reviewerId}:${currentHead}` } as never, undefined, selections[reviewerId].contexts, selections[reviewerId].identityChecksum)
      : await bundle.codeIntegrationReviewer.review({ ...input, idempotencyKey: `phase6b1:${CG01_GROUP_ID}:${reviewerId}:${currentHead}` } as never, undefined, selections[reviewerId].contexts, selections[reviewerId].identityChecksum);
    outputs[reviewerId] = output;
    const calls = events.filter((event) => event.type === "request.started").length - beforeCalls;
    records.push(classifyReviewerOutput(reviewerId, output, evidence.allowed, calls));
  }
  const closed = records.every((record) => record.state === "RESOLVED");
  const nextPlan = calculateUnblockedGroups(phase6APlan, closed ? [CG01_GROUP_ID] : []);
  const verificationRunId = jsonChecksum({ groupId: CG01_GROUP_ID, findingId: CG01_FINDING_ID, currentHead, plan: PHASE6A_PLAN_IDENTITY, skills: Object.fromEntries(Object.entries(selections).map(([id, selection]) => [id, selection.selectedSkillChecksums])) });
  const artifact = {
    schemaVersion: 1,
    documentType: "phase-6b-correction-verification",
    groupId: CG01_GROUP_ID,
    originalCorrectionCommit: CORRECTION_COMMIT,
    verificationRunId,
    sourcePlanIdentity: PHASE6A_PLAN_IDENTITY,
    blockerRootCause: "Attempt 1 had no correction-verification runner; its direct provider configuration probe also skipped the existing standalone environment bootstrap.",
    verificationInfrastructureFix: "Added an admin-only sequential verifier that loads scripts/cli-env.ts before configuration, resolves exact approved reviewer skills, builds bounded evidence, invokes the existing production provider adapters, and validates existing strict reviewer output plus bounded evidence references.",
    contractAuditorResult: records.find((record) => record.reviewerId === "contract-auditor"),
    codeIntegrationReviewerResult: records.find((record) => record.reviewerId === "code-integration-reviewer"),
    selectedSkills: Object.fromEntries(Object.entries(selections).map(([id, selection]) => [id, { selectedSkillIds: selection.selectedSkillIds, selectedSkillChecksums: selection.selectedSkillChecksums, identityChecksum: selection.identityChecksum }])),
    provider: { model: config.model, modelLabel: config.modelLabel, configured: true, realGptCalls: events.filter((event) => event.type === "request.started").length, requestEvents: events },
    evidenceValidation: { valid: records.every((record) => record.evidenceValid), evidenceRefs: [...evidence.allowed].sort() },
    perFindingResolution: records.map((record) => ({ findingId: record.findingId, reviewerId: record.reviewerId, state: record.state, evidence: record.evidence, explanation: record.explanation, remainingIssue: record.remainingIssue })),
    remainingFindingCount: records.every((record) => record.state === "RESOLVED") ? 30 : 31,
    dependencyUnblockedGroups: closed ? nextPlan.unblockedGroups : [],
    nextRecommendedGroup: closed ? nextPlan.nextRecommendedGroup : CG01_GROUP_ID,
    phase6BStatus: closed ? "COMPLETE" : "BLOCKED",
  };
  await writeFile(path.resolve(resolvedRoot, VERIFICATION_MACHINE_PATH), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const report = [
    "# cg-01 Cross-Artifact Identity Verification",
    "",
    `Status: **${artifact.phase6BStatus}**`,
    "",
    "Attempt 1 was blocked because no correction-verification runner existed, and the standalone configuration probe ran before the repository's environment bootstrap. This attempt reuses scripts/cli-env.ts before provider configuration and then invokes the existing production reviewer adapters sequentially.",
    "",
    `- Group: \`${CG01_GROUP_ID}\``,
    `- Finding: \`${CG01_FINDING_ID}\``,
    `- Correction commit: \`${CORRECTION_COMMIT}\``,
    `- Provider: ${config.modelLabel} / \`${config.model}\``,
    `- Real GPT calls: ${artifact.provider.realGptCalls}`,
    `- Contract Auditor: ${artifact.contractAuditorResult?.state}`,
    `- Code / Integration Reviewer: ${artifact.codeIntegrationReviewerResult?.state}`,
    `- Evidence validation: ${artifact.evidenceValidation.valid ? "PASS" : "FAIL"}`,
    `- Remaining correction-ready findings: ${artifact.remainingFindingCount}`,
    `- Next recommended group: \`${artifact.nextRecommendedGroup}\``,
    "",
    "No production identity correction was changed in this verification phase. No broad review, other correction group, skill change, agent change, or customer website E2E was performed.",
    "",
    `Machine result: \`${VERIFICATION_MACHINE_PATH}\``,
  ].join("\n");
  await writeFile(path.resolve(resolvedRoot, VERIFICATION_REPORT_PATH), `${report}\n`, "utf8");
  return { artifact, outputs, selections };
}

if (process.argv[1]?.endsWith("phase-6b-cg01-verification.ts")) runCg01Verification().then((result) => console.log(JSON.stringify({ status: result.artifact.phase6BStatus, verificationRunId: result.artifact.verificationRunId, realGptCalls: result.artifact.provider.realGptCalls, contractAuditor: result.artifact.contractAuditorResult?.state, codeIntegrationReviewer: result.artifact.codeIntegrationReviewerResult?.state, remainingFindingCount: result.artifact.remainingFindingCount }, null, 2))).catch((error) => { console.error(error instanceof Error ? error.message : "VERIFICATION_FAILED"); process.exitCode = 1; });
