import { canonicalBriefChecksum, changeSetChecksum, normalizeCanonicalBrief } from "./normalize";
import { type BriefReductionResult } from "./reducer";
import { validateCanonicalBriefV3 } from "./invariants";
import type { SemanticTargetId } from "./targets";

export type BriefProvenanceEntry = {
  revisionReference: string;
  target: SemanticTargetId;
  operation: "SET" | "UPSERT" | "REMOVE";
  outcome: "CHANGED";
  beforeValueFingerprint: string;
  afterValueFingerprint: string;
};

export type BriefRevisionHistory = {
  previousCurrentChecksum: string;
  nextCurrentChecksum: string;
  changeSetChecksum: string;
  entries: readonly BriefProvenanceEntry[];
};

/** Derive append-only provenance from the reducer-owned effective delta. */
export function deriveBriefProvenance(reduction: BriefReductionResult, revisionReference: string): BriefRevisionHistory {
  const previous = normalizeCanonicalBrief(validateCanonicalBriefV3(reduction.before));
  const next = normalizeCanonicalBrief(validateCanonicalBriefV3(reduction.after));
  const entries = reduction.effectiveDelta.map((change) => ({
      revisionReference,
      target: change.target,
      operation: change.operation,
      outcome: "CHANGED" as const,
      beforeValueFingerprint: change.beforeValueFingerprint,
      afterValueFingerprint: change.afterValueFingerprint,
    }));
  return {
    previousCurrentChecksum: canonicalBriefChecksum(previous),
    nextCurrentChecksum: canonicalBriefChecksum(next),
    changeSetChecksum: changeSetChecksum(reduction.changeSet),
    entries,
  };
}
