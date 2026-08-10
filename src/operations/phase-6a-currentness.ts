export const CURRENTNESS_STATES = [
  "ACTIVE_UNCHANGED",
  "ACTIVE_REBASED",
  "PARTIALLY_RESOLVED",
  "ALREADY_RESOLVED",
  "NO_LONGER_APPLICABLE",
  "NEEDS_TARGETED_REVIEW",
] as const;

export type CurrentnessState = (typeof CURRENTNESS_STATES)[number];

export type PlanningFinding = {
  findingId: string;
  severity: "CRITICAL" | "ERROR" | "WARNING" | "INFO";
  currentness: CurrentnessState;
  correctionGroupId?: string;
};

export type CorrectionGroup = {
  groupId: string;
  findingIds: readonly string[];
  dependencies: readonly string[];
  rootCauseConfidence: "HIGH" | "MEDIUM" | "LOW";
};

const severityRank: Record<PlanningFinding["severity"], number> = {
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4,
};

export function assertExactlyOneCurrentnessState(
  state: string,
): asserts state is CurrentnessState {
  if (!CURRENTNESS_STATES.includes(state as CurrentnessState)) {
    throw new Error(`Unknown Phase 6A currentness state: ${state}`);
  }
}

export function correctionReadyFindings<T extends PlanningFinding>(
  findings: readonly T[],
) {
  return findings.filter(
    (finding) =>
      finding.currentness === "ACTIVE_UNCHANGED" ||
      finding.currentness === "ACTIVE_REBASED" ||
      finding.currentness === "PARTIALLY_RESOLVED",
  );
}

export function assertCurrentEvidenceRequirement(
  state: CurrentnessState,
  currentEvidenceCount: number,
) {
  if (state !== "NEEDS_TARGETED_REVIEW" && currentEvidenceCount < 1) {
    throw new Error(`Current evidence is required for ${state}.`);
  }
  return true;
}

export function severityCounts(findings: readonly PlanningFinding[]) {
  return findings.reduce(
    (counts, finding) => {
      counts[finding.severity] += 1;
      return counts;
    },
    { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0 },
  );
}

export function highestSeverity(findings: readonly PlanningFinding[]) {
  if (!findings.length) return "INFO" as const;
  return findings.reduce((highest, finding) =>
    severityRank[finding.severity] > severityRank[highest]
      ? finding.severity
      : highest,
  "INFO" as PlanningFinding["severity"]);
}

export function validateCorrectionGroups(
  findings: readonly PlanningFinding[],
  groups: readonly CorrectionGroup[],
) {
  const correctionReadyIds = new Set(
    correctionReadyFindings(findings).map((finding) => finding.findingId),
  );
  const assignments = new Map<string, string>();
  for (const group of groups) {
    for (const findingId of group.findingIds) {
      if (!correctionReadyIds.has(findingId)) {
        throw new Error(`Non-correction-ready finding entered group: ${findingId}`);
      }
      if (assignments.has(findingId)) {
        throw new Error(`Finding entered multiple primary groups: ${findingId}`);
      }
      assignments.set(findingId, group.groupId);
    }
  }
  for (const finding of correctionReadyFindings(findings)) {
    if (!assignments.has(finding.findingId)) {
      throw new Error(`Correction-ready finding has no group: ${finding.findingId}`);
    }
  }
  return assignments;
}

export function assertAcyclicDependencies(groups: readonly CorrectionGroup[]) {
  const known = new Set(groups.map((group) => group.groupId));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (groupId: string) => {
    if (visiting.has(groupId)) throw new Error("Correction group dependency cycle detected.");
    if (visited.has(groupId)) return;
    visiting.add(groupId);
    const group = groups.find((candidate) => candidate.groupId === groupId);
    for (const dependency of group?.dependencies ?? []) {
      if (!known.has(dependency)) throw new Error(`Unknown correction dependency: ${dependency}`);
      visit(dependency);
    }
    visiting.delete(groupId);
    visited.add(groupId);
  };
  for (const group of groups) visit(group.groupId);
  return true;
}
