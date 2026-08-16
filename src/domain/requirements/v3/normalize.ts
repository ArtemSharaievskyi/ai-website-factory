import { createHash } from "node:crypto";
import { BriefChangeSetSchema, type BriefChange, type BriefChangeSet } from "./changeset";
import { BriefV3Error } from "./errors";
import { CanonicalBriefV3Schema, type CanonicalAsset, type CanonicalBriefV3, type CanonicalPage, type CanonicalRequirement } from "./schema";
import { getTargetCatalogEntry, targetSortKey } from "./targets";

export function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

const uniqueSorted = (values: readonly string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
const operationWithoutRefs = (change: BriefChange) => {
  const rest = { ...change } as BriefChange & { sourceRefs?: string[] };
  delete rest.sourceRefs;
  if ("value" in rest && rest.value && typeof rest.value === "object" && "sourceRefs" in rest.value) {
    const value = rest.value as Record<string, unknown>;
    const valueWithoutRefs = { ...value };
    delete valueWithoutRefs.sourceRefs;
    return { ...rest, value: valueWithoutRefs };
  }
  return rest;
};

const refsFor = (change: BriefChange) => (change.sourceRefs ? [...change.sourceRefs] : []);

function mergeEquivalentChanges(existing: BriefChange, incoming: BriefChange): BriefChange {
  const sourceRefs = uniqueSorted([...refsFor(existing), ...refsFor(incoming)]);
  if ("value" in existing && existing.value && typeof existing.value === "object" && "sourceRefs" in existing.value) {
    const existingValue = existing.value as Record<string, unknown>;
    const incomingValue = ("value" in incoming ? incoming.value : undefined) as Record<string, unknown> | undefined;
    return {
      ...existing,
      sourceRefs,
      value: {
        ...existingValue,
        sourceRefs: uniqueSorted([
          ...(Array.isArray(existingValue.sourceRefs) ? existingValue.sourceRefs.filter((ref): ref is string => typeof ref === "string") : []),
          ...(Array.isArray(incomingValue?.sourceRefs) ? incomingValue.sourceRefs.filter((ref): ref is string => typeof ref === "string") : []),
        ]),
      },
    } as BriefChange;
  }
  return { ...existing, sourceRefs } as BriefChange;
}

/** Normalize a provider-independent patch. Conflicting writes fail closed. */
export function normalizeBriefChangeSet(input: unknown): BriefChangeSet {
  const parsed = BriefChangeSetSchema.safeParse(input);
  if (!parsed.success) throw new BriefV3Error("BRIEF_V3_CHANGESET_INVALID", { issue: parsed.error.issues[0]?.message ?? "invalid changeset" });

  const byTarget = new Map<string, BriefChange>();
  for (const rawChange of parsed.data.changes) {
    const target = rawChange.target;
    if (!getTargetCatalogEntry(target)) throw new BriefV3Error("BRIEF_V3_UNKNOWN_TARGET", { target });
    const value = "value" in rawChange && rawChange.value && typeof rawChange.value === "object" && "sourceRefs" in rawChange.value
      ? { ...rawChange.value, sourceRefs: uniqueSorted((rawChange.value as { sourceRefs: string[] }).sourceRefs) }
      : undefined;
    const change: BriefChange = value
      ? { ...rawChange, value, sourceRefs: uniqueSorted([...(rawChange.sourceRefs ?? []), ...value.sourceRefs]) } as BriefChange
      : { ...rawChange, sourceRefs: uniqueSorted(rawChange.sourceRefs ?? []) } as BriefChange;
    const existing = byTarget.get(target);
    if (!existing) {
      byTarget.set(target, change);
      continue;
    }
    if (existing.operation !== change.operation) throw new BriefV3Error("BRIEF_V3_CONFLICTING_OPERATIONS", { target });
    if (stableSerialize(operationWithoutRefs(existing)) !== stableSerialize(operationWithoutRefs(change))) {
      throw new BriefV3Error("BRIEF_V3_CONFLICTING_OPERATIONS", { target });
    }
    byTarget.set(target, mergeEquivalentChanges(existing, change));
  }

  const changes = [...byTarget.values()].sort((a, b) => targetSortKey(a.target).localeCompare(targetSortKey(b.target)));
  const unresolved = parsed.data.unresolved
    .map((item) => ({ ...item, sourceRefs: uniqueSorted(item.sourceRefs) }))
    .filter((item, index, values) => values.findIndex((candidate) => stableSerialize(candidate) === stableSerialize(item)) === index)
    .sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b)));
  return { contractVersion: 1, changes, unresolved };
}

const normalizeRequirement = (entry: CanonicalRequirement): CanonicalRequirement => ({ ...entry, sourceRefs: uniqueSorted(entry.sourceRefs) });
const mergeRequirement = (entries: readonly CanonicalRequirement[], context: string): CanonicalRequirement[] => {
  const byId = new Map<string, CanonicalRequirement>();
  for (const rawEntry of entries) {
    const entry = normalizeRequirement(rawEntry);
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }
    if (existing.category !== entry.category || existing.statement !== entry.statement) {
      throw new BriefV3Error("BRIEF_V3_DUPLICATE_TARGET", { target: entry.id, context });
    }
    byId.set(entry.id, { ...existing, sourceRefs: uniqueSorted([...existing.sourceRefs, ...entry.sourceRefs]) });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
};

const normalizePage = (page: CanonicalPage): CanonicalPage => ({ ...page, sourceRefs: uniqueSorted(page.sourceRefs) });
const normalizeAsset = (asset: CanonicalAsset): CanonicalAsset => ({ ...asset, sourceRefs: uniqueSorted(asset.sourceRefs) });

/** Normalize current state without rewriting user-facing text. */
export function normalizeCanonicalBrief(input: unknown): CanonicalBriefV3 {
  const parsed = CanonicalBriefV3Schema.safeParse(input);
  if (!parsed.success) throw new BriefV3Error("BRIEF_V3_SCHEMA_INVALID", { issue: parsed.error.issues[0]?.message ?? "invalid canonical brief" });
  const brief = parsed.data;
  const pagesBySlug = new Map<string, CanonicalPage>();
  for (const rawPage of brief.pages) {
    const page = normalizePage(rawPage);
    const existing = pagesBySlug.get(page.slug);
    if (existing && stableSerialize({ ...existing, sourceRefs: undefined }) !== stableSerialize({ ...page, sourceRefs: undefined })) throw new BriefV3Error("BRIEF_V3_DUPLICATE_TARGET", { target: page.id, context: "page-slug" });
    pagesBySlug.set(page.slug, existing ? { ...existing, sourceRefs: uniqueSorted([...existing.sourceRefs, ...page.sourceRefs]) } : page);
  }
  const assetsById = new Map<string, CanonicalAsset>();
  for (const rawAsset of brief.assets) {
    const asset = normalizeAsset(rawAsset);
    const existing = assetsById.get(asset.id);
    if (!existing) assetsById.set(asset.id, asset);
    else if (stableSerialize({ ...existing, sourceRefs: undefined }) !== stableSerialize({ ...asset, sourceRefs: undefined })) throw new BriefV3Error("BRIEF_V3_DUPLICATE_TARGET", { target: asset.id, context: "asset" });
    else assetsById.set(asset.id, { ...existing, sourceRefs: uniqueSorted([...existing.sourceRefs, ...asset.sourceRefs]) });
  }
  const normalizeForm = (form: CanonicalBriefV3["decisions"]["form"]): CanonicalBriefV3["decisions"]["form"] => ({
    ...form,
    interactionStates: mergeRequirement(form.interactionStates, "form-interaction"),
  });
  const normalized = {
    ...brief,
    pages: [...pagesBySlug.values()].sort((a, b) => a.id.localeCompare(b.id)),
    requirements: mergeRequirement(brief.requirements, "requirements"),
    decisions: {
      ...brief.decisions,
      form: normalizeForm(brief.decisions.form),
    },
    assets: [...assetsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    seo: {
      ...brief.seo,
      primaryKeywords: uniqueSorted(brief.seo.primaryKeywords),
      locationTargeting: mergeRequirement(brief.seo.locationTargeting, "seo-location"),
      pageMetadata: [...brief.seo.pageMetadata]
        .map((item) => ({ ...item, keywords: uniqueSorted(item.keywords), sourceRefs: uniqueSorted(item.sourceRefs) }))
        .sort((a, b) => a.route.localeCompare(b.route)),
    },
    localization: {
      ...brief.localization,
      locales: uniqueSorted(brief.localization.locales),
    },
    unresolved: brief.unresolved
      .map((item) => ({ ...item, sourceRefs: uniqueSorted(item.sourceRefs) }))
      .filter((item, index, values) => values.findIndex((candidate) => stableSerialize(candidate) === stableSerialize(item)) === index)
      .sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b))),
  } satisfies CanonicalBriefV3;
  return CanonicalBriefV3Schema.parse(normalized);
}

export function canonicalBriefChecksumInput(brief: CanonicalBriefV3): string {
  return stableSerialize(normalizeCanonicalBrief(brief));
}

export function canonicalBriefChecksum(brief: CanonicalBriefV3): string {
  return createHash("sha256").update(canonicalBriefChecksumInput(brief)).digest("hex");
}

export function changeSetChecksum(changeSet: BriefChangeSet): string {
  return createHash("sha256").update(stableSerialize(normalizeBriefChangeSet(changeSet))).digest("hex");
}
