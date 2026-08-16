import { createHash } from "node:crypto";
import type { BriefChangeSet } from "./changeset";
import { validateReductionInvariants } from "./invariants";
import { canonicalBriefChecksum, changeSetChecksum, normalizeBriefChangeSet, normalizeCanonicalBrief, stableSerialize } from "./normalize";
import { type CanonicalBriefV3 } from "./schema";
import { readSemanticTarget } from "./state";
import type { SemanticTargetId } from "./targets";

export type BriefProvenanceEntry = {
  revisionReference: string;
  target: SemanticTargetId;
  operation: "SET" | "UPSERT" | "REMOVE";
  outcome: "CHANGED" | "NO_OP";
  beforeValueFingerprint: string;
  afterValueFingerprint: string;
};

export type BriefRevisionHistory = {
  previousCurrentChecksum: string;
  nextCurrentChecksum: string;
  changeSetChecksum: string;
  entries: readonly BriefProvenanceEntry[];
};

const fingerprint = (value: unknown) => createHash("sha256").update(stableSerialize(value)).digest("hex");

/** Derive append-only provenance after reduction; this function has no path back into current state. */
export function deriveBriefProvenance(
  before: CanonicalBriefV3,
  after: CanonicalBriefV3,
  input: BriefChangeSet,
  revisionReference: string,
): BriefRevisionHistory {
  const changes = normalizeBriefChangeSet(input);
  const previous = normalizeCanonicalBrief(before);
  const next = normalizeCanonicalBrief(after);
  validateReductionInvariants(previous, next, changes);
  const entries = changes.changes.map((change) => {
    const beforeValue = readSemanticTarget(previous, change.target);
    const afterValue = readSemanticTarget(next, change.target);
    return {
      revisionReference,
      target: change.target as SemanticTargetId,
      operation: change.operation,
      outcome: stableSerialize(beforeValue) === stableSerialize(afterValue) ? "NO_OP" as const : "CHANGED" as const,
      beforeValueFingerprint: fingerprint(beforeValue),
      afterValueFingerprint: fingerprint(afterValue),
    };
  });
  return {
    previousCurrentChecksum: canonicalBriefChecksum(previous),
    nextCurrentChecksum: canonicalBriefChecksum(next),
    changeSetChecksum: changeSetChecksum(changes),
    entries,
  };
}
