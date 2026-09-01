import { createHash, randomUUID } from "node:crypto";
import { checksumPersistedDocument, stableValue } from "@/persistence/database/serialization";
import { getEffectiveBriefRequirements } from "@/domain/requirements/effective";
import type { RequirementSpecification } from "@/domain/requirements/schema";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";
import {
  CONTEXT_BUDGET_PROFILES,
  ContextBundleSchema,
  ContextItemSchema,
  type ContextBudgetPolicy,
  type ContextBundle,
  type ContextAuthority,
  type CanonicalDocumentType,
  type ContextCurrentness,
  type ContextItem,
  type ContextItemKind,
  type ContextPriority,
  contextChecksum,
  type ContextAssemblyBlocker,
  type ContextAssemblyBlockerCode,
} from "./contracts";

const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const estimatedTokens = (value: string) => Math.ceil(bytes(value) / 4);
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const secretLike = /(sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|-----BEGIN [^-]*PRIVATE KEY-----|(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL)\s*[:=]\s*[^\s}]+)/i;
const safeIdentity = (value: unknown) => typeof value === "string" && value.length <= 240 ? value : undefined;

const CANONICAL_KEYS = new Set([
  "originalPrompt",
  "requestText",
  "revisionInstruction",
  "briefRevision",
  "briefRevisionInstruction",
  "knownUserAnswers",
  "clarificationAnswer",
  "clarificationAnswers",
  "clarificationSession",
  "session",
  "analysis",
  "approvedBrief",
  "canonicalBrief",
  "projectBrief",
  "brief",
  "currentBrief",
  "requirements",
  "approvedRequirements",
  "approvedRequirementSet",
  "currentCanonicalRequirements",
  "canonicalRequirements",
  "canonicalContent",
  "canonicalDesignContent",
  "acceptedPlanningPackage",
  "acceptedDependencyDecision",
  "dependencyDecision",
  "databaseDecision",
  "databaseDecisions",
  "selectedDesign",
  "selectedDesignDirection",
  "selectedDirection",
  "approvedChangeProposal",
  "changeProposal",
  "project",
  "task",
  "taskContract",
  "phase7cContractPackage",
]);
const TECHNICAL_CONTENT_KEYS = new Set(["content", "markdown", "stdout", "stderr", "raw", "rawOutput", "fullSource", "sourceText"]);

function prepareContextValue(value: unknown, key: string | undefined, canonical: boolean, depth: number): unknown {
  if (typeof value === "string") {
    if (canonical) return value;
    if (key && TECHNICAL_CONTENT_KEYS.has(key)) return `[omitted: ${key} is represented by a bounded context slice]`;
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…[bounded]` : value;
  }
  if (Array.isArray(value)) {
    const entries = canonical ? value : value.slice(0, 80);
    return entries.map((entry) => prepareContextValue(entry, key, canonical, depth + 1));
  }
  if (depth > 5) return canonical ? value : "[bounded-depth]";
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (object.documentType === "requirements" && "requirementHistory" in object) {
    return prepareContextValue(getEffectiveBriefRequirements(object as RequirementSpecification), key, canonical, depth);
  }
  return Object.fromEntries(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entryKey, entryValue]) => [
        entryKey,
        prepareContextValue(entryValue, entryKey, canonical || CANONICAL_KEYS.has(entryKey), depth + 1),
      ]),
  );
}

/**
 * Preserve canonical requirement documents while bounding only supporting data.
 * This is intentionally shared by every role prompt builder so callers cannot
 * accidentally apply the old generic 2,000-character reducer to requirements.
 */
export function prepareRoleContext(input: unknown) {
  return prepareContextValue(input, undefined, false, 0);
}

export function inferCanonicalDocumentType(role: string, input: unknown): CanonicalDocumentType {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (role === "lead" && typeof value.originalPrompt === "string") return "InitialProjectRequest";
  if (value.revisionInstruction || value.briefRevision || value.briefRevisionInstruction) return "BriefRevisionInstruction";
  if (value.clarificationAnswer || value.clarificationAnswers || value.clarificationSession || value.session) return "ClarificationAnswer";
  if (value.approvedChangeProposal || value.changeProposal) return "ApprovedChangeProposal";
  if (value.selectedDesign || value.selectedDesignDirection || value.selectedDirection) return "SelectedDesignDirection";
  if (value.databaseDecision || value.databaseDecisions) return "DatabaseDecision";
  if (value.acceptedDependencyDecision || value.dependencyDecision) return "AcceptedDependencyDecision";
  if (value.approvedBrief || value.projectBrief || value.brief) return "ProjectBrief";
  if (value.approvedRequirements || value.approvedRequirementSet || value.requirements) return "ApprovedRequirementSet";
  return "CurrentCanonicalRequirements";
}

export type ContextCandidate = {
  kind: ContextItemKind;
  authority?: ContextAuthority;
  canonicalDocumentType?: CanonicalDocumentType;
  sourceRef: string;
  sourceChecksum?: string;
  selectionReason: string;
  priority: ContextPriority;
  required?: boolean;
  content: string;
  lineRange?: { start: number; end: number };
  symbolIdentity?: string;
  currentness?: ContextCurrentness;
};

export type ContextAssemblyInput = {
  agentId: string;
  agentRole: string;
  workflowStage: string;
  taskId?: string;
  projectId?: string;
  projectVersion?: number;
  currentnessIdentity: string;
  candidates: readonly ContextCandidate[];
  requiredKinds?: readonly ContextItemKind[];
  budget?: ContextBudgetPolicy;
};

export type ContextAssemblyResult =
  | { status: "READY"; bundle: ContextBundle }
  | { status: "BLOCKED"; blocker: ContextAssemblyBlocker };

export class ContextAssemblyError extends Error {
  constructor(readonly blocker: ContextAssemblyBlocker) {
    super(`${blocker.code}: ${blocker.message}`);
    this.name = "ContextAssemblyError";
  }
}

export class ContextAssembler {
  constructor(private readonly defaultBudget?: ContextBudgetPolicy) {}
  assemble(input: Omit<ContextAssemblyInput, "budget"> & { budget?: ContextBudgetPolicy }) {
    return assembleContext({ ...input, budget: input.budget ?? this.defaultBudget });
  }
  assembleOrThrow(input: Omit<ContextAssemblyInput, "budget"> & { budget?: ContextBudgetPolicy }) {
    const result = this.assemble(input);
    if (result.status === "BLOCKED") throw new ContextAssemblyError(result.blocker);
    return result.bundle;
  }
}

const profileFor = (agentRole: string, budget?: ContextBudgetPolicy) => budget ?? (agentRole.includes("reviewer") || agentRole === "review" ? CONTEXT_BUDGET_PROFILES.reviewer : agentRole === "implementation" ? CONTEXT_BUDGET_PROFILES.implementation : CONTEXT_BUDGET_PROFILES.default);
const effectiveInputTokens = (budget: ContextBudgetPolicy) => Math.min(budget.maxEstimatedInputTokens, budget.hardCeiling.estimatedInputTokens - budget.reservedResponseTokens);
const effectiveBytes = (budget: ContextBudgetPolicy) => Math.min(budget.maxBytes, budget.hardCeiling.bytes - budget.reservedResponseBytes);
const candidateKey = (candidate: ContextCandidate, contentChecksum: string) => `${candidate.kind}|${candidate.sourceRef}|${candidate.sourceChecksum ?? contentChecksum}|${contentChecksum}`;
const currentnessOf = (candidate: ContextCandidate) => candidate.currentness ?? "CURRENT" as const;
const makeItem = (candidate: ContextCandidate): ContextItem => {
  const contentChecksum = digest(candidate.content);
  const authority = candidate.kind === "CANONICAL_CONTRACT" ? "CANONICAL_REQUIREMENT" : candidate.authority ?? "SUPPORTING_TECHNICAL";
  return ContextItemSchema.parse({
    contextItemId: digest(`${candidate.kind}:${candidate.sourceRef}:${contentChecksum}`).slice(0, 32),
    kind: candidate.kind,
    authority,
    ...(candidate.canonicalDocumentType ? { canonicalDocumentType: candidate.canonicalDocumentType } : {}),
    sourceRef: candidate.sourceRef,
    sourceChecksum: candidate.sourceChecksum && /^[a-f0-9]{64}$/.test(candidate.sourceChecksum) ? candidate.sourceChecksum : contentChecksum,
    selectionReason: candidate.selectionReason,
    priority: candidate.priority,
    required: authority === "CANONICAL_REQUIREMENT" || Boolean(candidate.required),
    bytes: bytes(candidate.content),
    estimatedTokens: estimatedTokens(candidate.content),
    ...(candidate.lineRange ? { lineRange: candidate.lineRange } : {}),
    ...(candidate.symbolIdentity ? { symbolIdentity: candidate.symbolIdentity } : {}),
    contentChecksum,
    currentness: currentnessOf(candidate),
    content: candidate.content,
  });
};
const block = (code: ContextAssemblyBlockerCode, message: string, requiredItems: readonly ContextItem[], budget: ContextBudgetPolicy, missingKinds: ContextItemKind[] = []): ContextAssemblyResult => ({ status: "BLOCKED", blocker: { code, message, requiredBytes: requiredItems.reduce((sum, item) => sum + item.bytes, 0), requiredEstimatedTokens: requiredItems.reduce((sum, item) => sum + item.estimatedTokens, 0), budgetProfile: budget.profileId, missingKinds, ...(requiredItems.some((item) => item.authority === "CANONICAL_REQUIREMENT") ? { authority: "CANONICAL_REQUIREMENT" as const } : { authority: "SUPPORTING_TECHNICAL" as const }), recoverable: true } });

export function assembleContext(input: ContextAssemblyInput): ContextAssemblyResult {
  const budget = profileFor(input.agentRole, input.budget);
  const candidates = input.candidates.map((candidate) => makeItem(candidate));
  const missingKinds = (input.requiredKinds ?? []).filter((kind) => !candidates.some((item) => item.kind === kind && item.required));
  if (missingKinds.length) return block("CONTEXT_REQUIRED_ITEM_MISSING", "A required context category was not supplied.", candidates.filter((item) => item.required), budget, missingKinds);
  if (candidates.some((item) => secretLike.test(item.content))) return block("CONTEXT_SECRET_EXPOSURE_BLOCKED", "Secret-like content cannot enter an LLM context bundle.", candidates.filter((item) => secretLike.test(item.content)), budget);

  const unique = new Map<string, ContextItem>();
  let duplicateBytes = 0;
  for (const item of candidates) {
    const key = candidateKey(item, item.contentChecksum);
    const existing = unique.get(key);
    if (existing) {
      duplicateBytes += item.bytes;
      if (item.required && !existing.required) unique.set(key, { ...item, required: true });
      continue;
    }
    unique.set(key, item);
  }
  const uniqueItems = [...unique.values()];
  const required = uniqueItems.filter((item) => item.required || item.authority === "CANONICAL_REQUIREMENT");
  const staleRequired = required.filter((item) => item.currentness === "STALE");
  if (staleRequired.length) return block("CONTEXT_SOURCE_STALE", "Required context is stale and must be recomputed before provider invocation.", staleRequired, budget);
  const requiredBytes = required.reduce((sum, item) => sum + item.bytes, 0);
  const requiredTokens = required.reduce((sum, item) => sum + item.estimatedTokens, 0);
  if (requiredBytes > effectiveBytes(budget) || requiredTokens > effectiveInputTokens(budget)) return block("CONTEXT_REQUIRED_BUDGET_EXCEEDED", "Required context alone exceeds the safe input budget after response reservation; no required item was dropped.", required, budget);
  const uniqueCanonical = uniqueItems.filter((item) => item.authority === "CANONICAL_REQUIREMENT");
  const canonicalRequirementBytes = uniqueCanonical.reduce((sum, item) => sum + item.bytes, 0);
  const canonicalRequirementChecksum = uniqueCanonical.length
    ? digest(uniqueCanonical.map((item) => `${item.sourceRef}:${item.contentChecksum}`).join("\n"))
    : undefined;
  const ordered = [...unique.values()].sort((left, right) => Number(right.required) - Number(left.required) || ({ HIGH: 3, MEDIUM: 2, LOW: 1 }[right.priority] - { HIGH: 3, MEDIUM: 2, LOW: 1 }[left.priority]) || left.sourceRef.localeCompare(right.sourceRef));
  const selected: ContextItem[] = [];
  let selectedBytes = 0;
  let selectedTokens = 0;
  let fileCount = 0;
  let snippetCount = 0;
  let skillBytes = 0;
  let documentationBytes = 0;
  let diagnosticCount = 0;
  const excludedReasons: Array<{ sourceRef: string; reason: string }> = [];
  const canAdd = (item: ContextItem) => {
    const nextFiles = fileCount + (item.kind === "FILE_SKELETON" || item.kind === "SOURCE_SNIPPET" ? 1 : 0);
    const nextSnippets = snippetCount + (item.kind === "SOURCE_SNIPPET" ? 1 : 0);
    const nextSkills = skillBytes + (item.kind === "SKILL_SLICE" ? item.bytes : 0);
    const nextDocs = documentationBytes + (item.kind === "DOCUMENTATION_SLICE" ? item.bytes : 0);
    const nextDiagnostics = diagnosticCount + (item.kind === "DIAGNOSTIC" ? 1 : 0);
    const withinHard = selectedBytes + item.bytes <= effectiveBytes(budget) && selectedTokens + item.estimatedTokens <= effectiveInputTokens(budget);
    const crossesSoft = selectedBytes + item.bytes > budget.softTarget.bytes || selectedTokens + item.estimatedTokens > budget.softTarget.estimatedInputTokens;
    return withinHard && (!crossesSoft || item.priority === "HIGH") && nextFiles <= budget.maxFiles && nextSnippets <= budget.maxSnippets && nextSkills <= budget.maxSkillBytes && nextDocs <= budget.maxDocumentationBytes && nextDiagnostics <= budget.maxDiagnostics;
  };
  for (const item of ordered) {
    if (item.required) {
      selected.push(item);
      selectedBytes += item.bytes;
      selectedTokens += item.estimatedTokens;
      fileCount += item.kind === "FILE_SKELETON" || item.kind === "SOURCE_SNIPPET" ? 1 : 0;
      snippetCount += item.kind === "SOURCE_SNIPPET" ? 1 : 0;
      skillBytes += item.kind === "SKILL_SLICE" ? item.bytes : 0;
      documentationBytes += item.kind === "DOCUMENTATION_SLICE" ? item.bytes : 0;
      diagnosticCount += item.kind === "DIAGNOSTIC" ? 1 : 0;
      continue;
    }
    if (!canAdd(item)) {
      excludedReasons.push({ sourceRef: item.sourceRef, reason: "OPTIONAL_CONTEXT_OMITTED_BY_BUDGET_OR_CARDINALITY" });
      continue;
    }
    selected.push(item);
    selectedBytes += item.bytes;
    selectedTokens += item.estimatedTokens;
    fileCount += item.kind === "FILE_SKELETON" || item.kind === "SOURCE_SNIPPET" ? 1 : 0;
    snippetCount += item.kind === "SOURCE_SNIPPET" ? 1 : 0;
    skillBytes += item.kind === "SKILL_SLICE" ? item.bytes : 0;
    documentationBytes += item.kind === "DOCUMENTATION_SLICE" ? item.bytes : 0;
    diagnosticCount += item.kind === "DIAGNOSTIC" ? 1 : 0;
  }
  const selectedRequired = selected.filter((item) => item.required);
  if (selectedRequired.length !== required.length) return block("CONTEXT_REQUIRED_ITEM_MISSING", "A required context item could not be selected without loss; provider invocation is blocked.", required, budget);
  const manifest = selected.map((item) => {
    const { content, ...metadata } = item;
    void content;
    return metadata;
  });
  const metrics = {
    rawCandidateBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
    selectedBytes,
    canonicalRequirementBytes,
    canonicalRequirementIncludedBytes: selected.filter((item) => item.authority === "CANONICAL_REQUIREMENT").reduce((sum, item) => sum + item.bytes, 0),
    ...(canonicalRequirementChecksum ? { canonicalRequirementChecksum } : {}),
    canonicalRequirementTruncated: false as const,
    supportingContextOriginalBytes: uniqueItems.filter((item) => item.authority === "SUPPORTING_TECHNICAL").reduce((sum, item) => sum + item.bytes, 0),
    supportingContextIncludedBytes: selected.filter((item) => item.authority === "SUPPORTING_TECHNICAL").reduce((sum, item) => sum + item.bytes, 0),
    supportingContextReductionRatio: Math.max(0, 1 - selected.filter((item) => item.authority === "SUPPORTING_TECHNICAL").reduce((sum, item) => sum + item.bytes, 0) / Math.max(1, uniqueItems.filter((item) => item.authority === "SUPPORTING_TECHNICAL").reduce((sum, item) => sum + item.bytes, 0))),
    estimatedInputTokens: selectedTokens,
    fileCandidateCount: candidates.filter((item) => item.kind === "FILE_SKELETON" || item.kind === "SOURCE_SNIPPET").length,
    fileSelectedCount: fileCount,
    fullFileCount: selected.filter((item) => (item.kind === "SOURCE_SNIPPET" && !item.lineRange) || item.kind === "PROJECT_MANIFEST").length,
    skeletonCount: selected.filter((item) => item.kind === "FILE_SKELETON").length,
    snippetCount,
    skillCandidateBytes: candidates.filter((item) => item.kind === "SKILL_SLICE").reduce((sum, item) => sum + item.bytes, 0),
    skillSelectedBytes: skillBytes,
    documentationCandidateBytes: candidates.filter((item) => item.kind === "DOCUMENTATION_SLICE").reduce((sum, item) => sum + item.bytes, 0),
    documentationSelectedBytes: documentationBytes,
    rawDiagnosticBytes: candidates.filter((item) => item.kind === "DIAGNOSTIC").reduce((sum, item) => sum + item.bytes, 0),
    diagnosticSelectedBytes: selected.filter((item) => item.kind === "DIAGNOSTIC").reduce((sum, item) => sum + item.bytes, 0),
    deduplicatedBytes: duplicateBytes,
    budgetProfile: budget.profileId,
    budgetUtilization: Math.max(selectedTokens / Math.max(1, effectiveInputTokens(budget)), selectedBytes / Math.max(1, effectiveBytes(budget))),
    contextReductionRatio: Math.max(0, 1 - selectedBytes / Math.max(1, candidates.reduce((sum, item) => sum + item.bytes, 0))),
  };
  const withoutChecksum = {
    contextBundleId: randomUUID(), schemaVersion: 1 as const, agentId: input.agentId, agentRole: input.agentRole, workflowStage: input.workflowStage,
    ...(input.taskId ? { taskId: input.taskId } : {}), ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.projectVersion ? { projectVersion: input.projectVersion } : {}), currentnessIdentity: input.currentnessIdentity,
    requiredItems: selectedRequired, selectedItems: selected, manifest, estimatedInputTokens: selectedTokens, totalBytes: selectedBytes,
    sourceCount: selected.filter((item) => item.kind === "FILE_SKELETON" || item.kind === "SOURCE_SNIPPET").length,
    snippetCount, skillSliceCount: selected.filter((item) => item.kind === "SKILL_SLICE").length, docSliceCount: selected.filter((item) => item.kind === "DOCUMENTATION_SLICE").length, diagnosticCount,
    budget,
    deduplicationStats: { candidateCount: candidates.length, selectedCount: selected.length, duplicateCount: candidates.length - unique.size, duplicateBytes, omittedOptionalCount: excludedReasons.length, omittedOptionalBytes: candidates.filter((item) => excludedReasons.some((excluded) => excluded.sourceRef === item.sourceRef)).reduce((sum, item) => sum + item.bytes, 0) },
    selectionEvidence: { selectedReasons: selected.map((item) => ({ sourceRef: item.sourceRef, reason: item.selectionReason, required: item.required })), excludedReasons }, metrics,
  } satisfies Omit<ContextBundle, "checksum">;
  const bundle = ContextBundleSchema.parse({ ...withoutChecksum, checksum: contextChecksum(withoutChecksum) });
  return { status: "READY", bundle };
}

export function assemblePromptContext(input: { agentId: string; agentRole: string; workflowStage: string; projectId?: string; projectVersion?: number; taskId?: string; canonicalInput: unknown; skills?: readonly ApprovedProceduralSkillContext[]; budget?: ContextBudgetPolicy }): ContextBundle {
  const canonicalContent = JSON.stringify(stableValue(input.canonicalInput));
  const candidates: ContextCandidate[] = [{ kind: "CANONICAL_CONTRACT", authority: "CANONICAL_REQUIREMENT", canonicalDocumentType: inferCanonicalDocumentType(input.agentRole, input.canonicalInput), sourceRef: `canonical:${input.agentId}:${input.workflowStage}`, selectionReason: "Full canonical role requirements; never reduced by technical context policy.", priority: "HIGH", required: true, content: canonicalContent }];
  for (const skill of input.skills ?? []) candidates.push({ kind: "SKILL_SLICE", sourceRef: `skill:${skill.skillId}`, sourceChecksum: skill.approvedChecksum, selectionReason: `Approved procedural guidance selected for coverage: ${skill.coverageKeys.join(", ") || "role procedure"}.`, priority: "MEDIUM", content: skill.skillMarkdown });
  const result = assembleContext({ ...input, currentnessIdentity: checksumPersistedDocument(input.canonicalInput), candidates });
  if (result.status === "BLOCKED") throw new ContextAssemblyError(result.blocker);
  return result.bundle;
}

export function renderContextItems(items: readonly ContextItem[]) {
  return items.map((item) => {
    const section = item.authority === "CANONICAL_REQUIREMENT" ? "CANONICAL_PROJECT_REQUIREMENTS_LOSSLESS" : "BOUNDED_SUPPORTING_CONTEXT";
    const documentType = item.canonicalDocumentType ? ` documentType=${item.canonicalDocumentType}` : "";
    return `[${section} authority=${item.authority}${documentType} kind=${item.kind} ${item.sourceRef} checksum=${item.contentChecksum} currentness=${item.currentness}]\n${item.content}`;
  }).join("\n\n");
}

export function renderContextBundle(bundle: ContextBundle) {
  return `CONTEXT_BUNDLE schema=${bundle.schemaVersion} checksum=${bundle.checksum}\n${renderContextItems(bundle.selectedItems)}`;
}

export function contextBundleMetadata(bundle: ContextBundle) {
  return { contextBundleId: bundle.contextBundleId, checksum: bundle.checksum, estimatedInputTokens: bundle.estimatedInputTokens, totalBytes: bundle.totalBytes, sourceCount: bundle.sourceCount, snippetCount: bundle.snippetCount, skillSliceCount: bundle.skillSliceCount, docSliceCount: bundle.docSliceCount, diagnosticCount: bundle.diagnosticCount, canonicalRequirementBytes: bundle.metrics.canonicalRequirementBytes, canonicalRequirementIncludedBytes: bundle.metrics.canonicalRequirementIncludedBytes, canonicalRequirementTruncated: bundle.metrics.canonicalRequirementTruncated, supportingContextOriginalBytes: bundle.metrics.supportingContextOriginalBytes, supportingContextIncludedBytes: bundle.metrics.supportingContextIncludedBytes };
}

export function extractContextIdentity(input: unknown) {
  if (!input || typeof input !== "object") return {};
  const value = input as Record<string, unknown>;
  const task = value.task && typeof value.task === "object" ? value.task as Record<string, unknown> : undefined;
  const projectId = safeIdentity(value.projectId) ?? safeIdentity(task?.projectId);
  const taskId = safeIdentity(value.taskId) ?? safeIdentity(task?.id);
  const projectVersionValue = value.projectVersion ?? task?.projectVersion;
  const projectVersion = typeof projectVersionValue === "number" && Number.isInteger(projectVersionValue) && projectVersionValue > 0 ? projectVersionValue : undefined;
  return { ...(projectId ? { projectId } : {}), ...(taskId ? { taskId } : {}), ...(projectVersion ? { projectVersion } : {}) };
}

export function validateContextSufficiency(bundle: ContextBundle, requiredKinds: readonly ContextItemKind[]) {
  const missingKinds = requiredKinds.filter((kind) => !bundle.requiredItems.some((item) => item.kind === kind) && !bundle.selectedItems.some((item) => item.kind === kind));
  return { valid: missingKinds.length === 0, missingKinds, reason: missingKinds.length ? "CONTEXT_REQUIRED_ITEM_MISSING" as const : undefined };
}
