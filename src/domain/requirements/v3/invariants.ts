import { BriefV3Error } from "./errors";
import { canonicalBriefChecksumInput, normalizeCanonicalBrief, stableSerialize } from "./normalize";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "./schema";
import { changeValueForState, readSemanticTarget, targetDomain, type CanonicalDomain } from "./state";
import { pageTargetForSlug } from "./targets";
import type { BriefChangeSet } from "./changeset";

const HOST_OWNED_KEYS = new Set(["projectId", "projectVersion", "rowVersion", "checksum", "approval", "approvedAt", "approvedBy", "history", "requirementHistory", "workflowState", "persistenceStatus", "createdAt", "updatedAt"]);

function findHostOwnedKey(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findHostOwnedKey(item);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    if (HOST_OWNED_KEYS.has(key)) return key;
    const found = findHostOwnedKey(child);
    if (found) return found;
  }
  return undefined;
}

const activeSemanticIds = (brief: CanonicalBriefV3) => [
  ...brief.requirements.map((entry) => entry.id),
  ...brief.decisions.form.interactionStates.map((entry) => entry.id),
  ...brief.seo.locationTargeting.map((entry) => entry.id),
  ...brief.assets.map((entry) => entry.id),
  ...brief.pages.map((entry) => entry.id),
];

/** Validate one canonical user-state authority. This function never consults history or persistence metadata. */
export function validateCanonicalBriefV3(input: unknown): CanonicalBriefV3 {
  const hostOwnedKey = findHostOwnedKey(input);
  if (hostOwnedKey) throw new BriefV3Error("BRIEF_V3_INVARIANT_VIOLATION", { invariant: "host-owned-metadata", key: hostOwnedKey });
  const parsed = CanonicalBriefV3Schema.safeParse(input);
  if (!parsed.success) throw new BriefV3Error("BRIEF_V3_SCHEMA_INVALID", { issue: parsed.error.issues[0]?.message ?? "invalid canonical brief" });
  const brief = parsed.data;
  const ids = activeSemanticIds(brief);
  if (new Set(ids).size !== ids.length) throw new BriefV3Error("BRIEF_V3_DUPLICATE_TARGET", { invariant: "duplicate-semantic-id" });
  if (new Set(brief.pages.map((page) => page.slug)).size !== brief.pages.length) throw new BriefV3Error("BRIEF_V3_INVARIANT_VIOLATION", { invariant: "duplicate-page-slug" });
  if (brief.pages.some((page) => page.id !== pageTargetForSlug(page.slug))) throw new BriefV3Error("BRIEF_V3_INVARIANT_VIOLATION", { invariant: "page-id-mismatch" });
  if (new Set(brief.seo.pageMetadata.map((page) => page.route)).size !== brief.seo.pageMetadata.length) throw new BriefV3Error("BRIEF_V3_INVARIANT_VIOLATION", { invariant: "duplicate-seo-route" });
  if (brief.decisions.form.mode === "NONE" && brief.decisions.form.formPresent) throw new BriefV3Error("BRIEF_V3_INVARIANT_VIOLATION", { invariant: "form-none-present" });
  if (brief.decisions.form.mode === "REAL" && (brief.decisions.form as { transmissionMode: string }).transmissionMode === "NONE") throw new BriefV3Error("BRIEF_V3_INVARIANT_VIOLATION", { invariant: "real-success-without-transmission" });
  const checksumInput = canonicalBriefChecksumInput(brief);
  if (checksumInput !== canonicalBriefChecksumInput(brief)) throw new BriefV3Error("BRIEF_V3_INVARIANT_VIOLATION", { invariant: "unstable-checksum-input" });
  return brief;
}

const topLevelForDomain: Record<CanonicalDomain, keyof CanonicalBriefV3 | "unresolved"> = {
  form: "decisions",
  database: "decisions",
  auth: "decisions",
  analytics: "decisions",
  route: "decisions",
  brand: "brand",
  scope: "scope",
  seo: "seo",
  legal: "legal",
  requirements: "requirements",
  assets: "assets",
  pages: "pages",
};

/** Validate the post-reduction relationship between an old and new current state. */
export function validateReductionInvariants(current: CanonicalBriefV3, next: CanonicalBriefV3, changeSet: BriefChangeSet): void {
  validateCanonicalBriefV3(next);
  const touchedDomains = new Set(changeSet.changes.map((change) => targetDomain(change.target)));
  const normalizedCurrent = normalizeCanonicalBrief(current);
  const normalizedNext = normalizeCanonicalBrief(next);
  for (const change of changeSet.changes) {
    const actual = readSemanticTarget(normalizedNext, change.target);
    if (change.operation === "REMOVE") {
      if (actual !== undefined) throw new BriefV3Error("BRIEF_V3_REDUCTION_INVALID", { invariant: "removed-target-absent", target: change.target });
      continue;
    }
    if (stableSerialize(actual) !== stableSerialize(changeValueForState(change))) {
      throw new BriefV3Error("BRIEF_V3_REDUCTION_INVALID", { invariant: "target-value-applied", target: change.target });
    }
  }
  const topLevelKeys = ["summary", "title", "scope", "pages", "requirements", "decisions", "assets", "brand", "seo", "legal", "localization", "unresolved"] as const;
  for (const key of topLevelKeys) {
    const domainTouched = key === "decisions"
      ? touchedDomains.has("form") || touchedDomains.has("database") || touchedDomains.has("auth") || touchedDomains.has("analytics") || touchedDomains.has("route")
      : key === "unresolved" ? changeSet.unresolved.length > 0 : [...touchedDomains].some((domain) => topLevelForDomain[domain] === key);
    if (!domainTouched && stableSerialize(normalizedCurrent[key]) !== stableSerialize(normalizedNext[key])) {
      throw new BriefV3Error("BRIEF_V3_REDUCTION_INVALID", { invariant: "untouched-state-changed", target: key });
    }
  }
}
