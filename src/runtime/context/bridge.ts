import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { rolePrompt, type ApprovedProceduralSkillPromptContext } from "@/integrations/openai/prompts";
import { assembleContext, contextBundleMetadata, extractContextIdentity, inferCanonicalDocumentType, prepareRoleContext, renderContextItems, type ContextCandidate } from "./assembler";
import { CONTEXT_BUDGET_PROFILES } from "./contracts";
import { designCandidateContextCandidates, diagnosticContextCandidate, sliceApprovedSkill, sliceDiagnostics, documentationContextCandidate } from "./slicing";
import { selectRelevantFiles, sourceContextCandidates, type SourceFileCandidate } from "./source";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function taskRecord(input: UnknownRecord) {
  return record(input.task);
}

function sourceFiles(input: UnknownRecord): SourceFileCandidate[] {
  const files = Array.isArray(input.files) ? input.files : [];
  return files.flatMap((file) => {
    const item = record(file);
    if (!item || typeof item.relativePath !== "string" || typeof item.content !== "string") return [];
    return [{ relativePath: item.relativePath, content: item.content, ...(typeof item.sha256 === "string" ? { sha256: item.sha256 } : {}), taskOwned: item.representation === "FULL_FILE" }];
  });
}

function objectiveSymbols(input: UnknownRecord) {
  const task = taskRecord(input);
  const objective = typeof task?.objective === "string" ? task.objective : typeof input.objective === "string" ? input.objective : "";
  return objective.match(/[A-Za-z_$][A-Za-z0-9_$]{3,}/g) ?? [];
}

function buildCandidates(input: unknown, skills: readonly ApprovedProceduralSkillPromptContext[], role: string): ContextCandidate[] {
  const source = record(input);
  if (!source) return [];
  const task = taskRecord(source);
  const files = sourceFiles(source);
  const scopes = Array.isArray(task?.fileScopes) ? task.fileScopes.filter((item): item is string => typeof item === "string") : Array.isArray(source.fileScopes) ? source.fileScopes.filter((item): item is string => typeof item === "string") : [];
  const exactScope = scopes.find((scope) => !scope.includes("*"));
  const targetPath = typeof source.targetPath === "string" ? source.targetPath : typeof task?.targetPath === "string" ? task.targetPath : exactScope ?? (scopes.length ? files[0]?.relativePath : undefined);
  const selected = selectRelevantFiles({ files, targetPath, fileScopes: scopes, requiredSourceRefs: [], maxFiles: role.includes("reviewer") ? 20 : 24, maxDependencyDepth: 2 });
  const candidates = selected.selected.flatMap((file) => sourceContextCandidates({ file, symbols: objectiveSymbols(source) }));
  for (const skill of skills) {
    const sliced = sliceApprovedSkill({ skill, agentRole: role, requestedCoverage: skill.coverageKeys, maxBytes: role.includes("reviewer") ? 24_000 : role === "implementation" ? 36_000 : 48_000 });
    candidates.push({ kind: "SKILL_SLICE", authority: "SUPPORTING_TECHNICAL", sourceRef: `skill:${skill.skillId}:${sliced.sliceId}`, sourceChecksum: sliced.approvedChecksum, selectionReason: `Approved procedural guidance narrowed to coverage: ${skill.coverageKeys.join(", ") || "role procedure"}.`, priority: "MEDIUM", content: sliced.content });
  }
  const excerpts = Array.isArray(source.context7Excerpts) ? source.context7Excerpts : [];
  for (const excerpt of excerpts) {
    const value = record(excerpt);
    if (!value || typeof value.id !== "string" || typeof value.library !== "string" || typeof value.resolvedLibraryId !== "string" || typeof value.title !== "string" || typeof value.content !== "string" || typeof value.sourceReference !== "string" || typeof value.retrievedAt !== "string" || typeof value.checksum !== "string" || typeof value.relevanceReason !== "string" || (value.truncationState !== "complete" && value.truncationState !== "excerpt-truncated" && value.truncationState !== "result-truncated")) continue;
    const slice = documentationContextCandidate(value as never, objectiveSymbols(source)).candidate;
    candidates.push({ ...slice, authority: "SUPPORTING_TECHNICAL" });
  }
  const directions = Array.isArray(source.designCandidates) ? source.designCandidates : Array.isArray(source.directions) ? source.directions : [];
  if (directions.length) candidates.push({ ...designCandidateContextCandidates(directions.filter((item): item is { id: string; paid?: boolean; compatible?: boolean } => Boolean(record(item))).map((item) => ({ ...item, id: item.id })), { maxCandidates: 8, framework: "approved" }).candidate, authority: "SUPPORTING_TECHNICAL" });
  const diagnostics = record(source.validationDiagnostics);
  if (diagnostics && typeof diagnostics.tool === "string" && ["typescript", "eslint", "vitest", "next-build", "runtime"].includes(diagnostics.tool)) {
    const slice = sliceDiagnostics({ tool: diagnostics.tool as never, stdout: typeof diagnostics.stdout === "string" ? diagnostics.stdout : undefined, stderr: typeof diagnostics.stderr === "string" ? diagnostics.stderr : undefined, taskFiles: selected.selected.map((file) => file.relativePath) });
    if (slice.diagnostics.length) candidates.push({ ...diagnosticContextCandidate(slice), authority: "SUPPORTING_TECHNICAL" });
  }
  return candidates;
}

/** Builds one prompt bundle with lossless canonical input and bounded supporting input. */
export function boundedRolePrompt(role: Parameters<typeof rolePrompt>[0], input: unknown, correction = false, approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = []) {
  const slicedSkills = approvedSkills.map((skill) => ({ ...skill, skillMarkdown: sliceApprovedSkill({ skill, agentRole: role, requestedCoverage: skill.coverageKeys, maxBytes: role.includes("reviewer") ? 24_000 : role === "implementation" ? 36_000 : 48_000 }).content }));
  const preparedInput = prepareRoleContext(input);
  const prompt = rolePrompt(role, preparedInput, correction, slicedSkills);
  const identity = extractContextIdentity(preparedInput);
  const canonicalContent = JSON.stringify(preparedInput);
  const candidates: ContextCandidate[] = [{ kind: "CANONICAL_CONTRACT", authority: "CANONICAL_REQUIREMENT", canonicalDocumentType: inferCanonicalDocumentType(role, input), sourceRef: `canonical:${role}:${correction ? "correction" : "request"}`, selectionReason: "Full canonical role requirements are passed without token/context reduction.", priority: "HIGH", required: true, content: canonicalContent }, ...buildCandidates(input, approvedSkills, role)];
  const result = assembleContext({ agentId: role, agentRole: role, workflowStage: correction ? `${role}:correction` : role, ...identity, currentnessIdentity: checksumPersistedDocument(preparedInput), budget: role.includes("reviewer") ? CONTEXT_BUDGET_PROFILES.reviewer : role === "implementation" ? CONTEXT_BUDGET_PROFILES.implementation : CONTEXT_BUDGET_PROFILES.default, candidates });
  if (result.status === "BLOCKED") throw new Error(`CONTEXT_ASSEMBLY_BLOCKED:${result.blocker.code}`);
  const variableItems = result.bundle.selectedItems.filter((item) => item.kind !== "SKILL_SLICE");
  return { ...prompt, user: `${JSON.stringify(contextBundleMetadata(result.bundle))}\n${renderContextItems(variableItems)}`, contextBundle: result.bundle, promptPrefixChecksum: checksumPersistedDocument({ promptVersion: prompt.promptVersion, system: prompt.system }), promptPrefixBytes: Buffer.byteLength(prompt.system, "utf8") };
}
