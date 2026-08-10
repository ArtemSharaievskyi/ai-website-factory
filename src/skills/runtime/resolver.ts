import { createHash } from "node:crypto";
import type { AgentDefinition } from "@/domain/agents/schema";
import { SkillError } from "@/skills/registry/errors";
import { SkillTaskTypeSchema, type SkillApplicability, type SkillDefinition } from "@/skills/registry/contracts";
import type { SkillLoadResult } from "@/skills/registry/registry";
import { SkillRegistry } from "@/skills/registry/registry";

export const SKILL_RESOLUTION_REASONS = [
  "SELECTED",
  "NOT_APPROVED",
  "NOT_ALLOWED",
  "NOT_RELEVANT",
  "CAPABILITY_MISMATCH",
  "TASK_MISMATCH",
  "OVERLAPPING",
  "CONFLICTING",
  "CONTEXT_LIMIT",
  "CHECKSUM_MISMATCH",
  "TOOL_MISMATCH",
] as const;
export type SkillResolutionReason = (typeof SKILL_RESOLUTION_REASONS)[number];

export type SkillResolutionCandidate = {
  skillId: string;
  definition: Pick<SkillDefinition, "id" | "status" | "sourceChecksum" | "applicability">;
  applicability?: SkillApplicability;
  approvedChecksum?: string;
};

export type SkillResolutionRequest = {
  agent: AgentDefinition;
  capability: string;
  taskType: string;
  projectSurfaces: readonly string[];
  requiredCoverage: readonly string[];
  requestedTools: readonly string[];
  contextBudgetBytes: number;
  reservedContextBytes?: number;
};

export type SkillResolutionDecision = {
  skillId: string;
  reason: SkillResolutionReason;
  matchedCoverage: string[];
};

export type ResolvedSkillContext = {
  skillId: string;
  approvedChecksum: string;
  sourceChecksum: string;
  coverageKeys: string[];
  skillMarkdown: string;
  references: SkillLoadResult["references"];
  citation: SkillLoadResult["citation"];
};
export type ApprovedProceduralSkillContext = Pick<ResolvedSkillContext, "skillId" | "approvedChecksum" | "coverageKeys" | "skillMarkdown" | "references">;
export type AgentSkillSelection = {
  contexts: readonly ApprovedProceduralSkillContext[];
  identityChecksum: string;
  selectedSkillIds: readonly string[];
  selectedSkillChecksums: readonly { skillId: string; checksum: string }[];
};
export type ReviewerSkillSelection = AgentSkillSelection;

export type ResolvedSkillContextSet = {
  selected: ResolvedSkillContext[];
  excluded: SkillResolutionDecision[];
  totalBytes: number;
  contextIdentity: {
    skillChecksums: Array<{ skillId: string; checksum: string }>;
    checksum: string;
  };
};

const stable = (values: readonly string[]) => [...new Set(values)].sort();
const intersects = (left: readonly string[], right: readonly string[]) =>
  left.some((value) => right.includes(value));
const contextChecksum = (skillChecksums: Array<{ skillId: string; checksum: string }>) =>
  createHash("sha256").update(JSON.stringify(skillChecksums), "utf8").digest("hex");

export function toReviewerSkillSelection(result: ResolvedSkillContextSet): ReviewerSkillSelection {
  return {
    contexts: result.selected,
    identityChecksum: result.contextIdentity.checksum,
    selectedSkillIds: result.contextIdentity.skillChecksums.map((item) => item.skillId),
    selectedSkillChecksums: result.contextIdentity.skillChecksums,
  };
}

export const toAgentSkillSelection = toReviewerSkillSelection;

export async function prepareAgentSkillContext(
  registry: SkillRegistry,
  request: SkillResolutionRequest,
): Promise<AgentSkillSelection> {
  return toAgentSkillSelection(await resolveApprovedSkillContext(registry, request));
}

export function selectSkillCandidates(
  candidates: readonly SkillResolutionCandidate[],
  request: Pick<SkillResolutionRequest, "capability" | "taskType" | "projectSurfaces" | "requiredCoverage">,
) {
  const ordered = [...candidates].sort((left, right) =>
    (right.applicability?.priority ?? 0) - (left.applicability?.priority ?? 0) ||
    left.skillId.localeCompare(right.skillId),
  );
  const selected: SkillResolutionCandidate[] = [];
  const decisions: SkillResolutionDecision[] = [];
  const covered = new Set<string>();
  for (const candidate of ordered) {
    const applicability = candidate.applicability;
    if (!applicability) {
      decisions.push({ skillId: candidate.skillId, reason: "NOT_RELEVANT", matchedCoverage: [] });
      continue;
    }
    if (applicability.capability !== request.capability && !applicability.capabilities?.includes(request.capability)) {
      decisions.push({ skillId: candidate.skillId, reason: "CAPABILITY_MISMATCH", matchedCoverage: [] });
      continue;
    }
    if (applicability.taskType !== request.taskType && !applicability.taskTypes?.includes(request.taskType as never)) {
      decisions.push({ skillId: candidate.skillId, reason: "TASK_MISMATCH", matchedCoverage: [] });
      continue;
    }
    const matchedCoverage = stable(applicability.coverageKeys.filter((key) => request.requiredCoverage.includes(key)));
    const matchedSurface = intersects(applicability.projectSurfaces, request.projectSurfaces);
    if ((applicability.projectSurfaces.length > 0 && !matchedSurface) || (!matchedCoverage.length && !matchedSurface)) {
      decisions.push({ skillId: candidate.skillId, reason: "NOT_RELEVANT", matchedCoverage: [] });
      continue;
    }
    const conflicts = selected.some((item) =>
      applicability.conflictsWithSkillIds.includes(item.skillId) ||
      item.applicability?.conflictsWithSkillIds.includes(candidate.skillId),
    );
    if (conflicts) {
      decisions.push({ skillId: candidate.skillId, reason: "CONFLICTING", matchedCoverage });
      continue;
    }
    const overlaps = selected.some((item) =>
      applicability.overlapsWithSkillIds.includes(item.skillId) ||
      item.applicability?.overlapsWithSkillIds.includes(candidate.skillId),
    );
    const addsCoverage = matchedCoverage.some((key) => !covered.has(key));
    if ((overlaps || (matchedCoverage.length > 0 && !addsCoverage)) && selected.length > 0) {
      decisions.push({ skillId: candidate.skillId, reason: "OVERLAPPING", matchedCoverage });
      continue;
    }
    selected.push(candidate);
    matchedCoverage.forEach((key) => covered.add(key));
    decisions.push({ skillId: candidate.skillId, reason: "SELECTED", matchedCoverage });
  }
  return { selected, decisions };
}

export async function resolveApprovedSkillContext(
  registry: SkillRegistry,
  request: SkillResolutionRequest,
): Promise<ResolvedSkillContextSet> {
  const candidates: SkillResolutionCandidate[] = [];
  const excluded: SkillResolutionDecision[] = [];
  for (const skillId of stable(request.agent.allowedSkillIds)) {
    const runtime = await registry.getRuntimeMetadata(skillId);
    if (runtime.definition.status !== "approved" || !runtime.approval || !runtime.definition.applicability) {
      excluded.push({ skillId, reason: "NOT_APPROVED", matchedCoverage: [] });
      continue;
    }
    candidates.push({ skillId, definition: runtime.definition, applicability: runtime.definition.applicability, approvedChecksum: runtime.normalizedContentChecksum });
  }
  const selectedResult = selectSkillCandidates(candidates, request);
  excluded.push(...selectedResult.decisions.filter((item) => item.reason !== "SELECTED"));
  const selected: ResolvedSkillContext[] = [];
  let totalBytes = request.reservedContextBytes ?? 0;
  for (const candidate of selectedResult.selected) {
    const remaining = request.contextBudgetBytes - totalBytes;
    if (remaining <= 0) {
      excluded.push({ skillId: candidate.skillId, reason: "CONTEXT_LIMIT", matchedCoverage: candidate.applicability?.coverageKeys ?? [] });
      continue;
    }
    try {
      const loadRole = request.agent.role === "review"
        ? "review"
        : request.agent.agentId === "lead"
          ? "lead"
          : request.agent.agentId === "planner"
            ? "planner-architect"
            : request.agent.agentId === "design"
              ? "design"
              : "implementation";
      const loaded = await registry.load({
        skillId: candidate.skillId,
        role: loadRole,
        taskType: SkillTaskTypeSchema.parse(request.taskType),
        allowedSkillIds: request.agent.allowedSkillIds,
        requestedFiles: ["SKILL.md"],
        requestedTools: [...request.requestedTools],
        contextBudgetBytes: remaining,
      });
      const bytes = Buffer.byteLength(loaded.skillMarkdown, "utf8") + loaded.references.reduce((sum, item) => sum + Buffer.byteLength(item.content, "utf8"), 0);
      totalBytes += bytes;
      selected.push({
        skillId: candidate.skillId,
        approvedChecksum: candidate.approvedChecksum ?? candidate.definition.sourceChecksum,
        sourceChecksum: candidate.definition.sourceChecksum,
        coverageKeys: stable(candidate.applicability?.coverageKeys ?? []),
        skillMarkdown: loaded.skillMarkdown,
        references: loaded.references,
        citation: loaded.citation,
      });
    } catch (error) {
      const reason: SkillResolutionReason = error instanceof SkillError && error.code === "SKILL_CONTEXT_LIMIT_EXCEEDED"
        ? "CONTEXT_LIMIT"
        : error instanceof SkillError && error.code === "SKILL_CHECKSUM_MISMATCH"
          ? "CHECKSUM_MISMATCH"
          : error instanceof SkillError && error.code === "SKILL_TOOL_NOT_ALLOWED"
            ? "TOOL_MISMATCH"
            : error instanceof SkillError && error.code === "SKILL_NOT_ALLOWED_FOR_AGENT"
              ? "NOT_ALLOWED"
          : "NOT_APPROVED";
      excluded.push({ skillId: candidate.skillId, reason, matchedCoverage: candidate.applicability?.coverageKeys ?? [] });
    }
  }
  const skillChecksums = selected
    .map((item) => ({ skillId: item.skillId, checksum: item.approvedChecksum }))
    .sort((left, right) => left.skillId.localeCompare(right.skillId));
  return {
    selected,
    excluded: excluded.sort((left, right) => left.skillId.localeCompare(right.skillId) || left.reason.localeCompare(right.reason)),
    totalBytes,
    contextIdentity: { skillChecksums, checksum: contextChecksum(skillChecksums) },
  };
}
