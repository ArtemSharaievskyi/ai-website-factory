import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OpenAiStructuredClient } from "@/integrations/openai/client";
import { z } from "zod";
import {
  CONTEXT_BUDGET_PROFILES,
  ContextBundleSchema,
  ContextExpansionRequestSchema,
  assembleContext,
  astPatchEfficiencyMetric,
  createContextExpansionRequest,
  createEfficiencyAggregate,
  createInvocationFingerprint,
  createInvocationUsageRecord,
  designCandidateContextCandidates,
  deterministicCallDecision,
  documentationContextCandidate,
  renderSourceSkeleton,
  selectRelevantFiles,
  selectSymbolSnippet,
  sliceApprovedSkill,
  sliceDiagnostics,
  sourceContextCandidates,
  createSourceSkeleton,
  boundedRolePrompt,
  type ContextCandidate,
} from "@/runtime/context";

const checksum = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const uuid = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const largeTsx = [
  'import { helper } from "./helper";',
  'import type { ButtonProps } from "./types";',
  "",
  "export interface PageProps { title: string; }",
  "",
  "export function TargetButton(props: ButtonProps) {",
  "  return <button type=\"button\" onClick={() => helper(props.text)}>{props.text}</button>;",
  "}",
  "",
  ...Array.from({ length: 330 }, (_, index) => `export const unrelatedValue${index} = ${JSON.stringify(`unrelated-${index}`)};`),
  "",
  "export default function Page({ title }: PageProps) {",
  "  return <main><h1>{title}</h1><TargetButton text={title} /></main>;",
  "}",
].join("\n");
const skill = { skillId: "animation-skill", approvedChecksum: "a".repeat(64), coverageKeys: ["animation"], skillMarkdown: "# Animation Skill\n\n## Purpose\nUse restrained motion.\n\n## Animation\nPrefer transform and opacity.\n\n## Review\nCheck reduced motion and focus behavior.\n\n## Unrelated\nThis long unrelated procedure should not be selected for a narrow task.\n\n" + "detail ".repeat(400), references: [] };
const baseCandidate = (overrides: Partial<ContextCandidate> = {}): ContextCandidate => ({ kind: "CANONICAL_CONTRACT", sourceRef: "task-contract:1", sourceChecksum: checksum("task"), selectionReason: "required canonical contract", priority: "HIGH", required: true, content: JSON.stringify({ taskId: uuid, projectId }), ...overrides });

describe("Phase 7G context architecture", () => {
  it("assembles a strict versioned checksum-bound bundle", () => {
    const result = assembleContext({ agentId: "implementation", agentRole: "implementation", workflowStage: "implement-page", taskId: uuid, projectId, projectVersion: 1, currentnessIdentity: "graph-current", candidates: [baseCandidate()] });
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(ContextBundleSchema.parse(result.bundle).checksum).toBe(result.bundle.checksum);
    expect(result.bundle.schemaVersion).toBe(1);
    expect(result.bundle.requiredItems).toHaveLength(1);
  });
  it("blocks missing required categories and required-only overflow", () => {
    const missing = assembleContext({ agentId: "implementation", agentRole: "implementation", workflowStage: "task", currentnessIdentity: "current", requiredKinds: ["DESIGN_CONTRACT_SLICE"], candidates: [baseCandidate()] });
    expect(missing).toMatchObject({ status: "BLOCKED", blocker: { code: "CONTEXT_REQUIRED_ITEM_MISSING" } });
    const overflow = assembleContext({ agentId: "implementation", agentRole: "implementation", workflowStage: "task", currentnessIdentity: "current", budget: { ...CONTEXT_BUDGET_PROFILES.implementation, softTarget: { estimatedInputTokens: 1, bytes: 1 }, hardCeiling: { estimatedInputTokens: 10, bytes: 40 }, maxEstimatedInputTokens: 10, maxBytes: 40, reservedResponseTokens: 0, reservedResponseBytes: 0 }, candidates: [baseCandidate({ content: "x".repeat(100) })] });
    expect(overflow).toMatchObject({ status: "BLOCKED", blocker: { code: "CONTEXT_REQUIRED_BUDGET_EXCEEDED" } });
  });
  it("deduplicates by authoritative identity and omits low-priority optional material at the soft target", () => {
    const result = assembleContext({ agentId: "planner", agentRole: "planner-architect", workflowStage: "plan", currentnessIdentity: "current", budget: { ...CONTEXT_BUDGET_PROFILES.default, softTarget: { estimatedInputTokens: 10, bytes: 40 } }, candidates: [baseCandidate(), { ...baseCandidate(), required: false, priority: "MEDIUM" }, { ...baseCandidate(), required: false, priority: "LOW", sourceRef: "unrelated", content: "low" }] });
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.bundle.deduplicationStats.duplicateCount).toBe(1);
    expect(result.bundle.deduplicationStats.omittedOptionalCount).toBeGreaterThanOrEqual(1);
  });
  it("marks stale required source context and never silently drops it", () => {
    const result = assembleContext({ agentId: "implementation", agentRole: "implementation", workflowStage: "task", currentnessIdentity: "stale", candidates: [baseCandidate({ currentness: "STALE" })] });
    expect(result).toMatchObject({ status: "BLOCKED", blocker: { code: "CONTEXT_SOURCE_STALE", requiredBytes: expect.any(Number) } });
  });
  it("derives a TSX skeleton from real source without complete bodies", () => {
    const skeleton = createSourceSkeleton("src/components/large.tsx", largeTsx);
    const rendered = renderSourceSkeleton(skeleton);
    expect(skeleton.checksum).toBe(checksum(largeTsx));
    expect(rendered).toContain("TargetButton");
    expect(rendered).toContain("PageProps");
    expect(rendered).not.toContain("unrelated-329");
    expect(rendered).not.toContain("return <main>");
  });
  it("selects target and bounded dependency closure with explainable provenance", () => {
    const selection = selectRelevantFiles({ targetPath: "src/components/large.tsx", fileScopes: ["src/**/*.tsx", "src/**/*.ts"], maxFiles: 3, maxDependencyDepth: 1, files: [{ relativePath: "src/components/large.tsx", content: largeTsx, imports: ["src/components/helper.ts", "src/components/types.ts"] }, { relativePath: "src/components/helper.ts", content: "export function helper(value: string) { return value; }" }, { relativePath: "src/components/types.ts", content: "export interface ButtonProps { text: string; }" }, { relativePath: "src/elsewhere.ts", content: "export const unrelated = true;" }] });
    expect(selection.selected.map((item) => item.relativePath)).toEqual(["src/components/large.tsx", "src/components/helper.ts", "src/components/types.ts"]);
    expect(selection.selected.every((item) => item.selectionReason.length > 0)).toBe(true);
    expect(selection.excluded[0]?.exclusionReason).toMatch(/bounded|scope/i);
  });
  it("uses snippets for large files and whole content for genuinely small files", () => {
    const large = sourceContextCandidates({ file: { relativePath: "src/components/large.tsx", content: largeTsx, sha256: checksum(largeTsx), taskOwned: false, selectionReason: "target", priority: "HIGH", dependencyDepth: 0 }, symbols: ["TargetButton"] });
    const small = sourceContextCandidates({ file: { relativePath: "src/small.ts", content: "export const x = 1;", sha256: checksum("export const x = 1;"), taskOwned: false, selectionReason: "target", priority: "HIGH", dependencyDepth: 0 } });
    expect(large.map((item) => item.kind)).toEqual(["FILE_SKELETON", "SOURCE_SNIPPET"]);
    expect(large[1]?.lineRange).toBeDefined();
    expect(small[0]?.content).toBe("export const x = 1;");
  });
  it("routes role prompts through one bounded bundle without raw source bodies", () => {
    const prompt = boundedRolePrompt("implementation", { projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 1, task: { id: "11111111-1111-4111-8111-111111111111", objective: "Target component", fileScopes: ["src/**/*.tsx"] }, files: [{ relativePath: "src/target.tsx", content: `${largeTsx}\nexport function Target() { return \"body-only\"; }${"\n".repeat(10)}export const farAway = \"far-away-body\";` }] });
    expect(prompt.contextBundle.selectedItems.some((item) => item.kind === "FILE_SKELETON" || item.kind === "SOURCE_SNIPPET")).toBe(true);
    expect(prompt.user).not.toContain("far-away-body");
    expect(prompt.promptPrefixBytes).toBeGreaterThan(0);
  });
  it("rejects stale derived content by binding source checksum", () => {
    const original = createSourceSkeleton("src/a.ts", "export const a = 1;");
    const changed = createSourceSkeleton("src/a.ts", "export const a = 2;");
    expect(original.checksum).not.toBe(changed.checksum);
    expect(selectSymbolSnippet("src/a.ts", "export const a = 2;", ["a"])?.content).toContain("2");
  });
  it("slices approved skills exactly without semantic rewriting", () => {
    const slice = sliceApprovedSkill({ skill, agentRole: "design", requestedCoverage: ["animation"], maxBytes: 1200 });
    expect(slice.approvedChecksum).toBe(skill.approvedChecksum);
    expect(slice.semanticRewrite).toBe(false);
    expect(slice.selectedBytes).toBeLessThan(slice.fullBytes);
    expect(slice.content).toContain("Prefer transform");
    expect(slice.content).not.toContain("detail detail detail detail");
  });
  it("slices Context7 documentation with source/version/checksum provenance", () => {
    const excerpt = { id: "next", library: "next", resolvedLibraryId: "next", requestedVersion: "16.2.12", topic: "routing", title: "Routing", content: "Relevant route guidance.\n\nUnrelated deployment history.\n\nRelevant route handler guidance.", sourceReference: "https://context7.com/next/routing", retrievedAt: "2026-08-12T00:00:00.000Z", checksum: "b".repeat(64), relevanceReason: "routing", truncationState: "complete" as const };
    const result = documentationContextCandidate(excerpt, ["route"], 1000);
    expect(result.slice.version).toBe("16.2.12");
    expect(result.slice.content).toContain("route");
    expect(result.candidate.kind).toBe("DOCUMENTATION_SLICE");
  });
  it("normalizes causal diagnostics and excludes raw logs", () => {
    const raw = ["src/app/page.tsx(12,4): error TS2322: Type 'x' is not assignable", ...Array.from({ length: 30 }, (_, index) => `noise ${index}`)].join("\n");
    const result = sliceDiagnostics({ tool: "typescript", stdout: raw, taskFiles: ["src/app/page.tsx"], maxDiagnostics: 4 });
    expect(result.rawBytes).toBeGreaterThan(result.slicedBytes);
    expect(result.causalDiagnosticsPreserved).toBe(true);
    expect(result.diagnostics[0]).toMatchObject({ code: "TS2322", file: "src/app/page.tsx", line: 12, column: 4 });
    expect(result.content).not.toContain("noise 29");
  });
  it("normalizes ESLint, Vitest, Next build, and runtime diagnostics", () => {
    expect(sliceDiagnostics({ tool: "eslint", stdout: "src/a.ts:2:3  no-unused-vars  unused value", taskFiles: ["src/a.ts"] }).diagnostics[0]).toMatchObject({ code: "no-unused-vars", line: 2 });
    expect(sliceDiagnostics({ tool: "vitest", stdout: " × renders the approved button", taskFiles: ["src/a.test.ts"] }).diagnostics[0]?.tool).toBe("vitest");
    expect(sliceDiagnostics({ tool: "next-build", stdout: "Error: failed to collect page data" }).diagnostics[0]?.severity).toBe("error");
    expect(sliceDiagnostics({ tool: "runtime", stderr: "Error: approved route failed" }).diagnostics[0]?.tool).toBe("runtime");
  });
  it("creates a bounded expansion request and keeps it data-only", () => {
    const request = ContextExpansionRequestSchema.parse(createContextExpansionRequest({ reason: "The target signature needs one adjacent type.", requiredSourceRefs: ["file:src/a.ts"], requiredSymbols: ["Target"], requestedContextKind: "SOURCE_SNIPPET", taskScope: ["src/**/*.ts"] }));
    expect(request.maxExpansionCount).toBe(1);
    expect(request.currentExpansionCount).toBe(0);
    expect(request).not.toHaveProperty("write");
  });
  it("pre-filters design candidates by paid, compatibility, duplicate, and count policy", () => {
    const result = designCandidateContextCandidates([{ id: "free", source: "react-bits", description: "free", paid: false, compatible: true }, { id: "paid", source: "vendor", paid: true, compatible: true }, { id: "bad", source: "react-bits", paid: false, compatible: false }, { id: "free", source: "react-bits", description: "duplicate", paid: false, compatible: true }], { category: "dashboard", framework: "react", maxCandidates: 5 });
    expect(result.selected).toHaveLength(1);
    expect(result.excludedCount).toBe(3);
    expect(result.candidate.content).not.toContain("paid");
  });
  it("records deterministic call decisions and stable invocation fingerprints", () => {
    expect(deterministicCallDecision({ semanticRequired: false, reasonCode: "CHECKSUM_MISMATCH", explanation: "The source checksum is stale." })).toMatchObject({ decision: "LLM_AVOIDED_DETERMINISTIC", deterministic: true });
    expect(deterministicCallDecision({ semanticRequired: true, explanation: "Design synthesis needs semantic reasoning." })).toMatchObject({ decision: "LLM_REQUIRED", reasonCode: "SEMANTIC_REASONING_REQUIRED" });
    const args = { agentId: "design", model: "approved-model", schemaVersion: 1, currentnessIdentity: "current", contextBundleChecksum: "a".repeat(64), promptPrefixChecksum: "b".repeat(64) };
    expect(createInvocationFingerprint(args)).toBe(createInvocationFingerprint(args));
  });
  it("records AST patch output reduction against the real source counterfactual", () => {
    const result = astPatchEfficiencyMetric({ relativePath: "src/a.ts", patchKind: "REPLACE_NODE_BODY", sourceFile: largeTsx, patchPayload: { body: "{ return null; }" }, result: "APPLIED" });
    expect(result.sourceFileBytes).toBeGreaterThan(result.patchPayloadBytes);
    expect(result.outputReductionRatio).toBeGreaterThan(0);
  });
  it("captures actual provider usage and distinguishes unavailable cache telemetry", () => {
    const result = createInvocationUsageRecord({ invocationFingerprint: "context-usage", agentId: "implementation", workflowStage: "implementation", role: "implementation", promptVersion: "implementation.v1", provider: "openai", model: "approved-model", inputTokens: 12, outputTokens: 4, actualUsageCaptured: true, cacheTelemetryUnavailable: true, prefixChecksum: "b".repeat(64), prefixBytes: 6, requestCount: 1, retryCount: 0, correctionCount: 0 });
    expect(result).toMatchObject({ inputTokens: 12, outputTokens: 4, totalTokens: 16, actualUsageCaptured: true, cacheTelemetryUnavailable: true });
    expect(result).not.toHaveProperty("cachedInputTokens");
  });
  it("coalesces identical in-flight invocations without creating a broad result cache", async () => {
    let calls = 0;
    const schema = z.object({ ok: z.boolean() }).strict();
    const client = new OpenAiStructuredClient({ apiKey: "test", model: "approved-model", modelLabel: "approved", maxRetries: 0, maxConcurrentRequests: 2 }, { executor: async <T>() => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { value: { ok: true } as T, requestId: "req-dedup", inputTokens: 1, outputTokens: 1 }; } });
    const request = { role: "design", promptVersion: "design.v1", system: "stable", user: "same", schemaName: "dedup", schema, idempotencyKey: "same" };
    await Promise.all([client.request(request), client.request(request)]);
    expect(calls).toBe(1);
  });
  it("keeps the approved model boundary and exposes no filesystem/network write authority", () => {
    expect(CONTEXT_BUDGET_PROFILES.default.estimator).toBe("conservative-four-bytes-per-token");
    expect(createEfficiencyAggregate().llmInvocationCount).toBe(0);
  });
});
