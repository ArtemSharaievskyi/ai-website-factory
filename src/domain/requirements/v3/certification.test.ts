import { describe, expect, it } from "vitest";
import {
  BriefChangeSetSchema,
  BriefV3Error,
  SEMANTIC_TARGETS,
  TARGET_CATALOG,
  applyBriefChangeSet,
  canonicalBriefChecksum,
  canonicalBriefChecksumInput,
  deriveBriefProvenance,
  readLegacyRequirementHistory,
  migrateV1ToCanonicalBriefV3,
  migrateV2ToCanonicalBriefV3,
  normalizeBriefChangeSet,
  normalizeCanonicalBrief,
  parseBriefChangeSet,
  stableSerialize,
  validateCanonicalBriefV3,
} from ".";
import { cleanBriefV3, cleanFormRevisionChangeSet, expectedV1Migration, expectedV2Migration, multiDomainChangeSet, representativeV1Brief, representativeV2Brief } from "./fixtures";

const expectCode = (callback: () => unknown, code: string) => {
  try {
    callback();
    throw new Error("Expected callback to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(BriefV3Error);
    expect((error as BriefV3Error).code).toBe(code);
  }
};

describe("Brief Revision V3 certification", () => {
  it("catalogs stable typed targets without language-dependent identity", () => {
    expect(TARGET_CATALOG.map((entry) => entry.id)).toContain(SEMANTIC_TARGETS.FORM_SUCCESS_MODE);
    expect(TARGET_CATALOG.map((entry) => entry.id)).toContain(SEMANTIC_TARGETS.ASSET_COMPANY_LOGO);
    expect(normalizeBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED" }], unresolved: [] }).changes[0]?.target).toBe("FORM_SUCCESS_MODE");
    expect(normalizeBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED" }, { operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED" }], unresolved: [] }).changes).toHaveLength(1);
  });

  it("parses only SET/UPSERT/REMOVE and rejects malformed or host-owned payloads", () => {
    expect(BriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [{ operation: "ADD", target: "FORM_SUCCESS_MODE", value: "SIMULATED" }], unresolved: [] }).success).toBe(false);
    expect(BriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED", checksum: "host" }], unresolved: [] }).success).toBe(false);
    expectCode(() => parseBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "UNKNOWN_TARGET", value: "x" }], unresolved: [] }), "BRIEF_V3_CHANGESET_INVALID");
    expectCode(() => parseBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "INVALID" }], unresolved: [] }), "BRIEF_V3_CHANGESET_INVALID");
  });

  it("normalizes changesets idempotently, merges equivalent provenance, and rejects authority conflicts", () => {
    const input = {
      contractVersion: 1 as const,
      changes: [
        { operation: "UPSERT" as const, target: "REQUIREMENT:service", value: { category: "FEATURE" as const, statement: "Keep the synthetic service.", sourceRefs: ["b", "a"] }, sourceRefs: ["b"] },
        { operation: "UPSERT" as const, target: "REQUIREMENT:service", value: { category: "FEATURE" as const, statement: "Keep the synthetic service.", sourceRefs: ["c"] }, sourceRefs: ["a"] },
      ],
      unresolved: [{ target: "future", reason: "Needs clarification.", sourceRefs: ["z", "z"] }],
    };
    const normalized = normalizeBriefChangeSet(input);
    expect(normalizeBriefChangeSet(normalized)).toEqual(normalized);
    expect(normalized.changes[0]).toMatchObject({ target: "REQUIREMENT:service", sourceRefs: ["a", "b", "c"] });
    expect((normalized.changes[0] as { value: { sourceRefs: string[] } }).value.sourceRefs).toEqual(["a", "b", "c"]);
    expectCode(() => normalizeBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "SEO_TITLE", value: "One" }, { operation: "SET", target: "SEO_TITLE", value: "Two" }], unresolved: [] }), "BRIEF_V3_CONFLICTING_OPERATIONS");
    expectCode(() => normalizeBriefChangeSet({ contractVersion: 1, changes: [{ operation: "REMOVE", target: "REQUIREMENT:service" }, { operation: "UPSERT", target: "REQUIREMENT:service", value: { category: "FEATURE", statement: "Re-add.", sourceRefs: ["fixture"] } }], unresolved: [] }), "BRIEF_V3_CONFLICTING_OPERATIONS");
  });

  it("normalizes canonical state by semantic ID without rewriting user-facing text", () => {
    const reordered = {
      ...cleanBriefV3,
      requirements: [cleanBriefV3.requirements[1]!, cleanBriefV3.requirements[0]!],
      seo: { ...cleanBriefV3.seo, primaryKeywords: ["zeta", "alpha", "zeta"] },
    };
    const normalized = normalizeCanonicalBrief(reordered);
    expect(normalizeCanonicalBrief(normalized)).toEqual(normalized);
    expect(normalized.requirements.map((entry) => entry.id)).toEqual(["REQUIREMENT:legal", "REQUIREMENT:service"]);
    expect(normalized.requirements.find((entry) => entry.id === "REQUIREMENT:service")?.statement).toBe("Show the synthetic service overview.");
    expect(canonicalBriefChecksumInput(normalized)).toBe(canonicalBriefChecksumInput(normalizeCanonicalBrief(normalized)));
    expect(canonicalBriefChecksum(normalized)).toHaveLength(64);
  });

  it("applies one deterministic host-owned reduction with implicit preservation and locality", () => {
    const next = applyBriefChangeSet(cleanBriefV3, cleanFormRevisionChangeSet);
    expect(next.decisions.form.mode).toBe("SIMULATED");
    expect(next.seo).toEqual(cleanBriefV3.seo);
    expect(next.assets).toEqual(cleanBriefV3.assets);
    expect(next.legal).toEqual(cleanBriefV3.legal);
    expect(next.brand).toEqual(cleanBriefV3.brand);
    expect(next.pages).toEqual(cleanBriefV3.pages);
    expect(next.requirements).toEqual(cleanBriefV3.requirements);
    expect(applyBriefChangeSet(cleanBriefV3, cleanFormRevisionChangeSet)).toEqual(next);
  });

  it("applies independent multi-domain changes in canonical target order", () => {
    const next = applyBriefChangeSet(cleanBriefV3, multiDomainChangeSet);
    expect(next.seo.exactTitle).toBe("Synthetic Atelier — Revised");
    expect(next.decisions.database.mode).toBe("NONE");
    expect(next.requirements.find((entry) => entry.id === "REQUIREMENT:service")?.statement).toContain("hours");
    const reversed = { ...multiDomainChangeSet, changes: [...multiDomainChangeSet.changes].reverse() };
    expect(applyBriefChangeSet(cleanBriefV3, reversed)).toEqual(next);
  });

  it("supports no-op SET and redundant REMOVE without resurrecting state", () => {
    const noOp = applyBriefChangeSet(cleanBriefV3, cleanFormRevisionChangeSet);
    expect(canonicalBriefChecksum(noOp)).toBe(canonicalBriefChecksum(cleanBriefV3));
    const removed = applyBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [{ operation: "REMOVE", target: "REQUIREMENT:service" }], unresolved: [] });
    const removedAgain = applyBriefChangeSet(removed, { contractVersion: 1, changes: [{ operation: "REMOVE", target: "REQUIREMENT:service" }], unresolved: [] });
    expect(removedAgain.requirements.some((entry) => entry.id === "REQUIREMENT:service")).toBe(false);
    expect(removedAgain).toEqual(removed);
  });

  it("makes invalid exclusive form states impossible at the schema and invariant boundary", () => {
    expect(() => validateCanonicalBriefV3({ ...cleanBriefV3, decisions: { ...cleanBriefV3.decisions, form: { ...cleanBriefV3.decisions.form, mode: "REAL", transmissionMode: "NONE" } } })).toThrow();
    expectCode(() => validateCanonicalBriefV3({ ...cleanBriefV3, projectId: "host-owned" }), "BRIEF_V3_INVARIANT_VIOLATION");
    expectCode(() => validateCanonicalBriefV3({ ...cleanBriefV3, history: [] }), "BRIEF_V3_INVARIANT_VIOLATION");
    expectCode(() => validateCanonicalBriefV3({ ...cleanBriefV3, requirements: [...cleanBriefV3.requirements, { ...cleanBriefV3.requirements[0]!, sourceRefs: ["other"] }] }), "BRIEF_V3_DUPLICATE_TARGET");
  });

  it("derives provenance after reduction and never treats it as current input", () => {
    const changeSet = { contractVersion: 1 as const, changes: [{ operation: "SET" as const, target: "SEO_TITLE" as const, value: "New synthetic title", sourceRefs: ["fixture:history"] }], unresolved: [] };
    const next = applyBriefChangeSet(cleanBriefV3, changeSet);
    const history = deriveBriefProvenance(cleanBriefV3, next, changeSet, "fixture-revision-1");
    expect(history.entries[0]).toMatchObject({ target: "SEO_TITLE", operation: "SET", outcome: "CHANGED" });
    expect(JSON.stringify(history)).not.toContain("New synthetic title");
    expect(applyBriefChangeSet(cleanBriefV3, { ...changeSet, unresolved: [{ target: "history", reason: "Removed content remains historical.", sourceRefs: ["fixture"] }] }).seo).toEqual(next.seo);
  });

  it("migrates representative V1 deterministically without importing history or host metadata", () => {
    const withHistory = { ...representativeV1Brief, requirementHistory: [{ id: "old", statement: "Historical removed statement.", sourceRefs: ["fixture:history"], status: "REMOVED" as const, operation: "REMOVE" as const, revisionReference: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] };
    const migrated = migrateV1ToCanonicalBriefV3(withHistory);
    expect(migrated.summary).toBe(expectedV1Migration.summary);
    expect(migrated.decisions.form.mode).toBe(expectedV1Migration.formMode);
    expect(migrated.decisions.database.mode).toBe(expectedV1Migration.databaseMode);
    expect(migrated.decisions.auth.mode).toBe(expectedV1Migration.authMode);
    expect(migrated.decisions.routePolicy.mode).toBe(expectedV1Migration.routePolicy);
    expect(migrated.legal.inventedFactsPolicy).toBe(expectedV1Migration.legalInventedFactsPolicy);
    expect(migrated.requirements.some((entry) => entry.statement === "Historical removed statement.")).toBe(false);
    expect(readLegacyRequirementHistory(withHistory)).toHaveLength(1);
    expect(JSON.stringify(migrated)).not.toMatch(/projectId|approval|requirementHistory/);
    expect(migrateV1ToCanonicalBriefV3(representativeV1Brief)).toEqual(migrated);
  });

  it("migrates representative V2 typed decisions, assets, SEO, legal, and form semantics", () => {
    const migrated = migrateV2ToCanonicalBriefV3(representativeV2Brief);
    expect(migrated.decisions.form.mode).toBe(expectedV2Migration.formMode);
    expect(migrated.decisions.form.transmissionMode).toBe(expectedV2Migration.formTransmissionMode);
    expect(migrated.seo.exactTitle).toBe(expectedV2Migration.seoTitle);
    expect(migrated.assets[0]?.id).toBe(expectedV2Migration.assetId);
    expect(migrated.legal.placeholderPolicy).toBe(expectedV2Migration.legalPlaceholderPolicy);
    expect(migrated.requirements.some((entry) => entry.statement === "Use concise synthetic service copy.")).toBe(true);
    expect(migrateV2ToCanonicalBriefV3(representativeV2Brief)).toEqual(migrated);
  });

  it("gives valid Unicode legacy page slugs stable encoded semantic IDs", () => {
    const migrated = migrateV1ToCanonicalBriefV3({ ...representativeV1Brief, pages: [{ slug: "über uns", purpose: "Synthetic route." }] });
    expect(migrated.pages[0]?.id).toBe("PAGE:%C3%BCber%20uns");
    expect(validateCanonicalBriefV3(migrated)).toEqual(migrated);
  });

  it("rejects contradictory legacy mappings instead of guessing", () => {
    expectCode(() => migrateV2ToCanonicalBriefV3({ ...representativeV2Brief, explicitExclusions: ["No successful submission may be faked."] }), "BRIEF_V3_MIGRATION_AMBIGUOUS");
    expectCode(() => migrateV2ToCanonicalBriefV3({ ...representativeV2Brief, formBehaviorRequirements: { ...representativeV2Brief.formBehaviorRequirements, successUx: "REAL", dataTransmission: "NONE" } }), "BRIEF_V3_MIGRATION_AMBIGUOUS");
  });

  it("covers repeated operation permutations and optional state combinations", () => {
    const formModes = ["NONE", "SIMULATED", "REAL", "UNRESOLVED"] as const;
    const databaseModes = ["NONE", "SUPABASE", "UNRESOLVED"] as const;
    for (const formMode of formModes) {
      const current = formMode === "NONE" ? cleanBriefV3 : applyBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: formMode }], unresolved: [] });
      for (const databaseMode of databaseModes) {
        const changes = { contractVersion: 1 as const, changes: [{ operation: "SET" as const, target: "DATABASE_MODE" as const, value: databaseMode }, { operation: "SET" as const, target: "SEO_META_DESCRIPTION" as const, value: null }], unresolved: [] };
        const a = applyBriefChangeSet(current, changes);
        const b = applyBriefChangeSet(current, { ...changes, changes: [...changes.changes].reverse() });
        expect(a).toEqual(b);
        expect(normalizeCanonicalBrief(a)).toEqual(a);
      }
    }
  });

  it("keeps semantic identity independent from wording and rejects unrelated mutation shapes", () => {
    const removed = applyBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [{ operation: "REMOVE", target: "REQUIREMENT:service" }], unresolved: [] });
    const changedWording = applyBriefChangeSet(removed, { contractVersion: 1, changes: [{ operation: "UPSERT", target: "REQUIREMENT:replacement", value: { category: "FEATURE", statement: "A differently worded service.", sourceRefs: ["fixture"] } }], unresolved: [] });
    expect(changedWording.requirements.some((entry) => entry.id === "REQUIREMENT:service")).toBe(false);
    expect(stableSerialize(changedWording)).toBe(stableSerialize(normalizeCanonicalBrief(changedWording)));
    expectCode(() => applyBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "REAL" }, { operation: "SET", target: "FORM_TRANSMISSION_MODE", value: "NONE" }], unresolved: [] }), "BRIEF_V3_SCHEMA_INVALID");
  });
});
