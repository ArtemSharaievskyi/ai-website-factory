import { afterAll, describe, expect, it } from "vitest";
import {
  assertKnownTarget,
  BriefChangeSetSchema,
  type BriefChange,
  type BriefChangeSet,
  BriefV3Error,
  SEMANTIC_TARGETS,
  TARGET_CATALOG,
  applyBriefChangeSet,
  reduceBriefChangeSet,
  canonicalBriefChecksum,
  canonicalBriefChecksumInput,
  changeSetChecksum,
  deriveBriefProvenance,
  readLegacyRequirementHistory,
  migrateV1ToCanonicalBriefV3,
  migrateV2ToCanonicalBriefV3,
  normalizeBriefChangeSet,
  normalizeCanonicalBrief,
  parseBriefChangeSet,
  stableSerialize,
  isReductionNoOp,
  validateCanonicalBriefV3,
} from ".";
import { ambiguousV2Brief, cleanBriefV3, cleanFormRevisionChangeSet, conflictingChangeSet, expectedNormalizedBrief, expectedV1Migration, expectedV2Migration, multiDomainChangeSet, pilotShapedV1Brief, representativeV1Brief, representativeV2Brief } from "./fixtures";
import { RequirementSpecificationSchema } from "../schema";

const passedGroups = new Set<string>();
let generatedPropertyCases = 0;
const mark = (group: string) => passedGroups.add(group);

afterAll(() => {
  const groups = [
    "Target catalog",
    "ChangeSet typing",
    "Reducer examples",
    "Reducer properties",
    "Normalization",
    "Invariants",
    "History separation",
    "V1 migration",
    "V2 migration",
    "Migration ambiguity",
    "Serialization/checksum",
    "Golden fixtures",
    "Adversarial cases",
    "Effective delta",
    "SET changed",
    "SET no-op",
    "REMOVE changed",
    "REMOVE no-op",
    "UPSERT new",
    "UPSERT changed",
    "UPSERT no-op",
    "Mixed effective/no-op",
    "Entire no-op",
    "Normalized duplicates",
    "SourceRefs-only difference",
    "History == effective delta",
    "NO_OP effective entries absent",
  ];
  console.log("\nBRIEF REVISION V3 CORE CERTIFICATION");
  for (const group of groups) console.log(`${group.padEnd(30, ".")} ${passedGroups.has(group) ? "PASS" : "FAIL"}`);
  console.log(`Generated property cases .... ${generatedPropertyCases}`);
  if (groups.every((group) => passedGroups.has(group))) console.log("\nBRIEF REVISION V3 CORE:\nCERTIFIED");
});

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
    for (const target of Object.values(SEMANTIC_TARGETS)) expect(TARGET_CATALOG.some((entry) => entry.id === target)).toBe(true);
    expect(normalizeBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED" }], unresolved: [] }).changes[0]?.target).toBe("FORM_SUCCESS_MODE");
    expect(normalizeBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED" }, { operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED" }], unresolved: [] }).changes).toHaveLength(1);
    mark("Target catalog");
    mark("ChangeSet typing");
  });

  it("parses only SET/UPSERT/REMOVE and rejects malformed or host-owned payloads", () => {
    expect(BriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [{ operation: "ADD", target: "FORM_SUCCESS_MODE", value: "SIMULATED" }], unresolved: [] }).success).toBe(false);
    expect(BriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED", checksum: "host" }], unresolved: [] }).success).toBe(false);
    expectCode(() => parseBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "UNKNOWN_TARGET", value: "x" }], unresolved: [] }), "BRIEF_V3_CHANGESET_INVALID");
    expectCode(() => parseBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "INVALID" }], unresolved: [] }), "BRIEF_V3_CHANGESET_INVALID");
    mark("ChangeSet typing");
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
    expectCode(() => normalizeBriefChangeSet(conflictingChangeSet), "BRIEF_V3_CONFLICTING_OPERATIONS");
    expectCode(() => normalizeBriefChangeSet({ contractVersion: 1, changes: [{ operation: "REMOVE", target: "REQUIREMENT:service" }, { operation: "UPSERT", target: "REQUIREMENT:service", value: { category: "FEATURE", statement: "Re-add.", sourceRefs: ["fixture"] } }], unresolved: [] }), "BRIEF_V3_CONFLICTING_OPERATIONS");
    mark("Normalization");
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
    mark("Serialization/checksum");
    mark("Golden fixtures");
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
    mark("Reducer examples");
    mark("Reducer properties");
  });

  it("applies independent multi-domain changes in canonical target order", () => {
    const next = applyBriefChangeSet(cleanBriefV3, multiDomainChangeSet);
    expect(next.seo.exactTitle).toBe("Synthetic Atelier — Revised");
    expect(next.decisions.database.mode).toBe("NONE");
    expect(next.requirements.find((entry) => entry.id === "REQUIREMENT:service")?.statement).toContain("hours");
    const reversed = { ...multiDomainChangeSet, changes: [...multiDomainChangeSet.changes].reverse() };
    expect(applyBriefChangeSet(cleanBriefV3, reversed)).toEqual(next);
    mark("Reducer properties");
  });

  it("supports no-op SET and redundant REMOVE without resurrecting state", () => {
    const noOp = applyBriefChangeSet(cleanBriefV3, cleanFormRevisionChangeSet);
    expect(canonicalBriefChecksum(noOp)).toBe(canonicalBriefChecksum(cleanBriefV3));
    const removed = applyBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [{ operation: "REMOVE", target: "REQUIREMENT:service" }], unresolved: [] });
    const removedAgain = applyBriefChangeSet(removed, { contractVersion: 1, changes: [{ operation: "REMOVE", target: "REQUIREMENT:service" }], unresolved: [] });
    expect(removedAgain.requirements.some((entry) => entry.id === "REQUIREMENT:service")).toBe(false);
    expect(removedAgain).toEqual(removed);
    mark("Reducer properties");
  });

  it("makes invalid exclusive form states impossible at the schema and invariant boundary", () => {
    expect(() => validateCanonicalBriefV3({ ...cleanBriefV3, decisions: { ...cleanBriefV3.decisions, form: { ...cleanBriefV3.decisions.form, mode: "REAL", transmissionMode: "NONE" } } })).toThrow();
    expectCode(() => validateCanonicalBriefV3({ ...cleanBriefV3, projectId: "host-owned" }), "BRIEF_V3_INVARIANT_VIOLATION");
    expectCode(() => validateCanonicalBriefV3({ ...cleanBriefV3, history: [] }), "BRIEF_V3_INVARIANT_VIOLATION");
    expectCode(() => validateCanonicalBriefV3({ ...cleanBriefV3, requirements: [...cleanBriefV3.requirements, { ...cleanBriefV3.requirements[0]!, sourceRefs: ["other"] }] }), "BRIEF_V3_DUPLICATE_TARGET");
    expect(() => validateCanonicalBriefV3({ ...cleanBriefV3, scope: { ...cleanBriefV3.scope, images: { required: false, sourceStrategy: "USER_SUPPLIED" } } })).toThrow();
    expect(() => validateCanonicalBriefV3({ ...cleanBriefV3, decisions: { ...cleanBriefV3.decisions, form: { ...cleanBriefV3.decisions.form, mode: "REAL", transmissionMode: "NONE" } } })).toThrow();
    expect(() => validateCanonicalBriefV3({ ...cleanBriefV3, decisions: { ...cleanBriefV3.decisions, routePolicy: { mode: "MULTI_PAGE" } } })).toThrow();
    expect(() => validateCanonicalBriefV3({ ...cleanBriefV3, localization: { locales: ["de"], defaultLocale: "en" } })).toThrow();
    mark("Invariants");
  });

  it("derives provenance after reduction and never treats it as current input", () => {
    const changeSet = { contractVersion: 1 as const, changes: [{ operation: "SET" as const, target: "SEO_TITLE" as const, value: "New synthetic title", sourceRefs: ["fixture:history"] }], unresolved: [] };
    const next = applyBriefChangeSet(cleanBriefV3, changeSet);
    const history = deriveBriefProvenance(reduceBriefChangeSet(cleanBriefV3, changeSet), "fixture-revision-1");
    expect(history.entries[0]).toMatchObject({ target: "SEO_TITLE", operation: "SET", outcome: "CHANGED" });
    expect(JSON.stringify(history)).not.toContain("New synthetic title");
    expect(applyBriefChangeSet(cleanBriefV3, { ...changeSet, unresolved: [{ target: "history", reason: "Removed content remains historical.", sourceRefs: ["fixture"] }] }).seo).toEqual(next.seo);
    mark("History separation");
  });

  it("centralizes the effective semantic delta across SET, REMOVE, UPSERT, mixed, duplicate, and source-ref cases", () => {
    const service = cleanBriefV3.requirements.find((entry) => entry.id === "REQUIREMENT:service")!;
    const cases: Array<[BriefChange, number, string[]]> = [
      [{ operation: "SET", target: "SEO_TITLE", value: "Synthetic revised title" }, 1, ["SEO_TITLE"]],
      [{ operation: "SET", target: "SEO_TITLE", value: cleanBriefV3.seo.exactTitle }, 0, []],
      [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "REAL" }, 1, ["FORM_SUCCESS_MODE"]],
      [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: cleanBriefV3.decisions.form.mode }, 0, []],
      [{ operation: "REMOVE", target: "REQUIREMENT:service" }, 1, ["REQUIREMENT:service"]],
      [{ operation: "REMOVE", target: "REQUIREMENT:absent" }, 0, []],
      [{ operation: "UPSERT", target: "REQUIREMENT:new", value: { category: "FEATURE", statement: "Synthetic new requirement.", sourceRefs: ["fixture:new"] } }, 1, ["REQUIREMENT:new"]],
      [{ operation: "UPSERT", target: "REQUIREMENT:service", value: { category: service.category, statement: "Synthetic changed service.", sourceRefs: service.sourceRefs } }, 1, ["REQUIREMENT:service"]],
      [{ operation: "UPSERT", target: "REQUIREMENT:service", value: { category: service.category, statement: service.statement, sourceRefs: ["different:provenance"] } }, 0, []],
    ];
    for (const [change, count, targets] of cases) {
      const reduction = reduceBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [change], unresolved: [] });
      expect(reduction.effectiveDelta).toHaveLength(count);
      expect(reduction.effectiveDelta.map((entry) => entry.target)).toEqual(targets);
      expect(reduction.changed).toBe(count > 0);
      expect(deriveBriefProvenance(reduction, "fixture-effective-delta").entries).toHaveLength(count);
    }
    const mixed = reduceBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [
      { operation: "SET", target: "DATABASE_MODE", value: "SUPABASE" },
      { operation: "SET", target: "SEO_TITLE", value: cleanBriefV3.seo.exactTitle },
    ], unresolved: [] });
    expect(mixed.effectiveDelta.map((entry) => entry.target)).toEqual(["DATABASE_MODE"]);
    expect(deriveBriefProvenance(mixed, "fixture-effective-delta").entries.every((entry) => entry.outcome === "CHANGED")).toBe(true);
    const duplicate = reduceBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [
      { operation: "SET", target: "SEO_TITLE", value: "Synthetic duplicate title", sourceRefs: ["a"] },
      { operation: "SET", target: "SEO_TITLE", value: "Synthetic duplicate title", sourceRefs: ["b"] },
    ], unresolved: [] });
    expect(duplicate.changeSet.changes).toHaveLength(1);
    expect(duplicate.effectiveDelta).toHaveLength(1);
    const provenanceOnly = { contractVersion: 1 as const, changes: [{ operation: "SET" as const, target: "SEO_TITLE" as const, value: cleanBriefV3.seo.exactTitle, sourceRefs: ["different:provenance"] }], unresolved: [] };
    expect(changeSetChecksum(provenanceOnly)).not.toBe(changeSetChecksum({ ...provenanceOnly, changes: [{ ...provenanceOnly.changes[0]!, sourceRefs: ["other:provenance"] }] }));
    expect(reduceBriefChangeSet(cleanBriefV3, provenanceOnly).effectiveDelta).toHaveLength(0);
    mark("Effective delta");
    mark("SET changed");
    mark("SET no-op");
    mark("REMOVE changed");
    mark("REMOVE no-op");
    mark("UPSERT new");
    mark("UPSERT changed");
    mark("UPSERT no-op");
    mark("Mixed effective/no-op");
    mark("Entire no-op");
    mark("Normalized duplicates");
    mark("SourceRefs-only difference");
    mark("History == effective delta");
    mark("NO_OP effective entries absent");
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

  it("migrates a pilot-shaped V1 Brief losslessly at the legacy adapter boundary", () => {
    const sourceBefore = stableSerialize(pilotShapedV1Brief);
    const migrated = migrateV1ToCanonicalBriefV3(pilotShapedV1Brief);
    const activeStatements = [
      pilotShapedV1Brief.businessGoals,
      pilotShapedV1Brief.targetAudiences,
      pilotShapedV1Brief.userRoles,
      pilotShapedV1Brief.features,
      pilotShapedV1Brief.forms,
      pilotShapedV1Brief.contentRequirements,
      pilotShapedV1Brief.backendRequirements,
      pilotShapedV1Brief.supabaseRequirements,
      pilotShapedV1Brief.seoRequirements,
      pilotShapedV1Brief.technicalConstraints,
      pilotShapedV1Brief.explicitExclusions,
      pilotShapedV1Brief.userAcceptanceCriteria,
      pilotShapedV1Brief.contactFacts,
      pilotShapedV1Brief.legalFacts,
      pilotShapedV1Brief.brandFacts,
      pilotShapedV1Brief.logoMetadata,
      pilotShapedV1Brief.imageSourcingNotes,
      pilotShapedV1Brief.recommendations,
    ].flat();
    for (const statement of activeStatements) expect(migrated.requirements.some((entry) => entry.statement === statement)).toBe(true);
    expect(migrated.requirements.some((entry) => entry.statement.startsWith("administration: not-needed"))).toBe(true);
    expect(migrated.requirements.some((entry) => entry.statement === "Historical removed requirement must stay absent.")).toBe(false);
    for (const instruction of pilotShapedV1Brief.briefRevisionInstructions ?? []) expect(migrated.requirements.some((entry) => entry.statement === instruction)).toBe(false);
    expect(migrated.requirements.some((entry) => entry.statement === "Unsupported synthetic assumption must stay diagnostic.")).toBe(false);
    expect(migrated.requirements.every((entry) => entry.statement.length <= 4000)).toBe(true);
    expect(migrated.pages.map((page) => page.slug)).toEqual(["contact", "home", "imprint", "privacy", "services"]);
    expect(new Set(migrated.pages.map((page) => page.id)).size).toBe(migrated.pages.length);
    expect(migrated.decisions.routePolicy.mode).toBe("MULTI_PAGE");
    expect(migrated.decisions.form).toMatchObject({
      mode: "UNRESOLVED",
      formPresent: true,
      transmissionMode: "NONE",
      persistenceMode: "NONE",
      serverProcessingMode: "NONE",
      externalProviderMode: "NONE",
      privacyConsentMode: "REQUIRED",
    });
    expect(migrated.decisions.database.mode).toBe("NONE");
    expect(migrated.decisions.auth.mode).toBe("NONE");
    expect(migrated.decisions.analytics.mode).toBe("NONE");
    expect(migrated.scope.images).toEqual({ required: true, sourceStrategy: "CUSTOM" });
    expect(migrated.seo).toMatchObject({
      exactTitle: "Synthetic Garden Service",
      exactMetaDescription: "Synthetic local garden service description.",
      primaryKeywords: ["local service", "synthetic garden", "synthetic region"],
    });
    expect(migrated.seo.primaryKeywords).not.toContain("Use natural synthetic search language for local visitors.");
    expect(migrated.legal).toEqual({ placeholderPolicy: "USE_EXPLICIT_PLACEHOLDERS", inventedFactsPolicy: "FORBIDDEN" });
    expect(migrated.unresolved).toHaveLength(1);
    expect(stableSerialize(pilotShapedV1Brief)).toBe(sourceBefore);
  });

  it("keeps explicit database requirements independent from legacy file-storage decisions", () => {
    const fullStackLegacy = RequirementSpecificationSchema.parse({
      ...representativeV1Brief,
      imagesRequired: false,
      imageSourceDecision: "placeholders",
      forms: ["Service request form."],
      backendRequirements: ["Use approved server boundaries for service requests."],
      supabaseRequirements: ["Persist service requests in Supabase PostgreSQL."],
      authenticationDecision: "authentication-required",
      storageDecision: "not-needed",
    });
    const migrated = migrateV1ToCanonicalBriefV3(fullStackLegacy);
    expect(migrated.decisions.database.mode).toBe("SUPABASE");
    expect(migrated.decisions.form).toMatchObject({ persistenceMode: "DATABASE", serverProcessingMode: "SERVER" });
    expect(migrated.decisions.auth.mode).toBe("REQUIRED");
    expect(migrated.scope.images).toEqual({ required: false, sourceStrategy: "NONE" });
  });

  it("keeps pilot-shaped V1 migration deterministic and fails closed on ambiguous structured markers", () => {
    const first = migrateV1ToCanonicalBriefV3(pilotShapedV1Brief);
    const second = migrateV1ToCanonicalBriefV3(JSON.parse(JSON.stringify(pilotShapedV1Brief)));
    const third = migrateV1ToCanonicalBriefV3(pilotShapedV1Brief);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(canonicalBriefChecksum(first)).toBe(canonicalBriefChecksum(second));
    expectCode(() => migrateV1ToCanonicalBriefV3({ ...pilotShapedV1Brief, seoRequirements: [...pilotShapedV1Brief.seoRequirements, "SEO-Titel exakt: \"Conflicting synthetic title\"."] }), "BRIEF_V3_MIGRATION_AMBIGUOUS");
    expectCode(() => migrateV1ToCanonicalBriefV3({ ...pilotShapedV1Brief, forms: [...pilotShapedV1Brief.forms, "Optional privacy checkbox."] }), "BRIEF_V3_MIGRATION_AMBIGUOUS");
    expectCode(() => migrateV1ToCanonicalBriefV3({ ...pilotShapedV1Brief, backendRequirements: ["Synthetic server requirement."], explicitExclusions: [...pilotShapedV1Brief.explicitExclusions, "No backend processing."] }), "BRIEF_V3_MIGRATION_AMBIGUOUS");
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
    expectCode(() => migrateV2ToCanonicalBriefV3(ambiguousV2Brief), "BRIEF_V3_MIGRATION_AMBIGUOUS");
    expectCode(() => migrateV2ToCanonicalBriefV3({ ...representativeV2Brief, formBehaviorRequirements: { ...representativeV2Brief.formBehaviorRequirements, successUx: "REAL", dataTransmission: "NONE" } }), "BRIEF_V3_MIGRATION_AMBIGUOUS");
    mark("V1 migration");
    mark("V2 migration");
    mark("Migration ambiguity");
  });

  it("covers repeated operation permutations and optional state combinations", () => {
    expect(normalizeCanonicalBrief(cleanBriefV3)).toEqual(expectedNormalizedBrief);
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
    expectCode(() => applyBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "REAL" }, { operation: "SET", target: "FORM_TRANSMISSION_MODE", value: "NONE" }], unresolved: [] }), "BRIEF_V3_CONFLICTING_OPERATIONS");
    mark("Adversarial cases");
  });

  it("rejects unknown catalog IDs and target/value mismatches before reduction", () => {
    expectCode(() => assertKnownTarget("FORM_NOT_REGISTERED"), "BRIEF_V3_UNKNOWN_TARGET");
    expect(BriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [{ operation: "SET", target: "DATABASE_MODE", value: "EMAIL" }], unresolved: [] }).success).toBe(false);
    const typedChangeSet = {
      contractVersion: 1,
      changes: [{ operation: "SET", target: "SEO_TITLE", value: "Typed synthetic title" }],
      unresolved: [],
    } satisfies BriefChangeSet;
    expect(parseBriefChangeSet(typedChangeSet).changes[0]).toMatchObject({ target: "SEO_TITLE", value: "Typed synthetic title" });
    mark("Target catalog");
    mark("ChangeSet typing");
    mark("Adversarial cases");
  });

  it("rejects semantic conflicts instead of allowing order-dependent form repair", () => {
    const noneWithEmail = { contractVersion: 1 as const, changes: [
      { operation: "SET" as const, target: "FORM_SUCCESS_MODE" as const, value: "NONE" as const },
      { operation: "SET" as const, target: "FORM_TRANSMISSION_MODE" as const, value: "EMAIL" as const },
    ], unresolved: [] } satisfies BriefChangeSet;
    expectCode(() => applyBriefChangeSet(cleanBriefV3, noneWithEmail), "BRIEF_V3_CONFLICTING_OPERATIONS");
    const forbiddenSimulation = { contractVersion: 1 as const, changes: [
      { operation: "SET" as const, target: "FORM_SUCCESS_MODE" as const, value: "SIMULATED" as const },
      { operation: "SET" as const, target: "FORM_SIMULATED_SUCCESS_POLICY" as const, value: "FORBIDDEN" as const },
    ], unresolved: [] } satisfies BriefChangeSet;
    expectCode(() => applyBriefChangeSet(cleanBriefV3, forbiddenSimulation), "BRIEF_V3_CONFLICTING_OPERATIONS");
    const imageOff = applyBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [{ operation: "SET", target: "IMAGE_SOURCE_STRATEGY", value: "NONE" }], unresolved: [] });
    expect(imageOff.scope.images).toEqual({ required: false, sourceStrategy: "NONE" });
    const imageOn = applyBriefChangeSet(imageOff, { contractVersion: 1, changes: [{ operation: "SET", target: "IMAGE_SOURCE_STRATEGY", value: "AI_GENERATED" }], unresolved: [] });
    expect(imageOn.scope.images).toEqual({ required: true, sourceStrategy: "AI_GENERATED" });
    mark("Reducer examples");
    mark("Invariants");
    mark("Adversarial cases");
  });

  it("proves input immutability, locality, no-resurrection, and canonical no-op behavior", () => {
    const current = JSON.parse(JSON.stringify(cleanBriefV3)) as typeof cleanBriefV3;
    const changes = JSON.parse(JSON.stringify(multiDomainChangeSet)) as typeof multiDomainChangeSet;
    const currentBefore = stableSerialize(current);
    const changesBefore = stableSerialize(changes);
    const next = applyBriefChangeSet(current, changes);
    expect(stableSerialize(current)).toBe(currentBefore);
    expect(stableSerialize(changes)).toBe(changesBefore);
    expect(next.pages).toEqual(cleanBriefV3.pages);
    const removed = applyBriefChangeSet(cleanBriefV3, { contractVersion: 1, changes: [{ operation: "REMOVE", target: "REQUIREMENT:service" }], unresolved: [] });
    const noOp = applyBriefChangeSet(removed, { contractVersion: 1, changes: [{ operation: "REMOVE", target: "REQUIREMENT:service" }], unresolved: [] });
    expect(isReductionNoOp(removed, noOp)).toBe(true);
    expect(noOp.requirements.some((entry) => entry.id === "REQUIREMENT:service")).toBe(false);
    mark("Reducer properties");
    mark("History separation");
  });

  it("keeps canonical serialization and ChangeSet checksums stable across construction order", () => {
    const reordered = {
      unresolved: cleanBriefV3.unresolved,
      evidence: cleanBriefV3.evidence,
      localization: cleanBriefV3.localization,
      legal: cleanBriefV3.legal,
      seo: cleanBriefV3.seo,
      brand: cleanBriefV3.brand,
      assets: cleanBriefV3.assets,
      decisions: cleanBriefV3.decisions,
      requirements: cleanBriefV3.requirements,
      pages: cleanBriefV3.pages,
      scope: cleanBriefV3.scope,
      title: cleanBriefV3.title,
      summary: cleanBriefV3.summary,
      schemaVersion: cleanBriefV3.schemaVersion,
    };
    expect(canonicalBriefChecksum(reordered)).toBe(canonicalBriefChecksum(cleanBriefV3));
    const reversed = { ...multiDomainChangeSet, changes: [...multiDomainChangeSet.changes].reverse() };
    expect(changeSetChecksum(reversed)).toBe(changeSetChecksum(multiDomainChangeSet));
    expect(canonicalBriefChecksumInput(reordered)).toBe(canonicalBriefChecksumInput(cleanBriefV3));
    mark("Serialization/checksum");
  });

  it("covers migration completeness and fail-closed ambiguity for both legacy versions", () => {
    const v1 = migrateV1ToCanonicalBriefV3(representativeV1Brief);
    expect(v1.requirements.some((entry) => entry.statement === representativeV1Brief.projectSummary)).toBe(false);
    expect(v1.requirements.some((entry) => entry.statement === "Explain the synthetic service.")).toBe(true);
    expect(v1.requirements.some((entry) => entry.statement === "Single-page only.")).toBe(true);
    expect(v1.evidence).toMatchObject([{ field: "projectSummary", source: "synthetic-fixture", excerpt: "Synthetic atelier landing page.", sourceRefs: [expect.stringMatching(/^legacy:v1:evidence:/)] }]);
    expect(v1.decisions.form.simulatedSuccessPolicy).toBe("UNRESOLVED");
    expectCode(() => migrateV1ToCanonicalBriefV3({ ...representativeV1Brief, imagesRequired: false, imageSourceDecision: "user-supplied" }), "BRIEF_V3_MIGRATION_AMBIGUOUS");
    const conflictingV2 = { ...representativeV2Brief, decisions: [
      { key: "database-mode", value: "NONE", status: "CONFIRMED" as const, sourceRefs: ["fixture:a"] },
      { key: "database-mode", value: "SUPABASE", status: "CONFIRMED" as const, sourceRefs: ["fixture:b"] },
    ] };
    expectCode(() => migrateV2ToCanonicalBriefV3(conflictingV2), "BRIEF_V3_MIGRATION_AMBIGUOUS");
    const orderedV1 = migrateV1ToCanonicalBriefV3({ ...representativeV1Brief, businessGoals: ["Synthetic goal A.", "Synthetic goal B."] });
    const reorderedV1 = migrateV1ToCanonicalBriefV3({ ...representativeV1Brief, businessGoals: ["Synthetic goal B.", "Synthetic goal A."] });
    expect(reorderedV1).toEqual(orderedV1);
    mark("V1 migration");
    mark("V2 migration");
    mark("Migration ambiguity");
    mark("Golden fixtures");
  });

  it("runs deterministic property-style cases across targets, repetitions, removal, and permutations", () => {
    let state = 0x5eed1234;
    const nextRandom = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    const shuffle = <T>(values: readonly T[]): T[] => {
      const result = [...values];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const swap = nextRandom() % (index + 1);
        [result[index], result[swap]] = [result[swap]!, result[index]!];
      }
      return result;
    };
    for (let caseIndex = 0; caseIndex < 512; caseIndex += 1) {
      const candidates: BriefChangeSet["changes"] = [
        { operation: "SET", target: "SEO_TITLE", value: `Synthetic title ${caseIndex}`, sourceRefs: [`property:${caseIndex}:title`] },
        { operation: "SET", target: "SEO_META_DESCRIPTION", value: caseIndex % 3 === 0 ? null : `Synthetic description ${caseIndex}`, sourceRefs: [`property:${caseIndex}:description`] },
        { operation: "SET", target: "DATABASE_MODE", value: (["NONE", "SUPABASE", "POSTGRES", "OTHER", "UNRESOLVED"] as const)[nextRandom() % 5]!, sourceRefs: [`property:${caseIndex}:database`] },
        { operation: "SET", target: "AUTH_MODE", value: (["NONE", "REQUIRED", "OPTIONAL", "UNRESOLVED"] as const)[nextRandom() % 4]!, sourceRefs: [`property:${caseIndex}:auth`] },
        { operation: "SET", target: "ANALYTICS_MODE", value: (["NONE", "APPROVED_PROVIDER", "OTHER", "UNRESOLVED"] as const)[nextRandom() % 4]!, sourceRefs: [`property:${caseIndex}:analytics`] },
        { operation: "SET", target: "ROUTE_POLICY", value: (["SINGLE_PAGE", "UNRESOLVED"] as const)[nextRandom() % 2]!, sourceRefs: [`property:${caseIndex}:route`] },
        { operation: "SET", target: "IMAGE_SOURCE_STRATEGY", value: (["NONE", "AI_GENERATED", "USER_SUPPLIED", "USER_AND_AI", "PLACEHOLDERS", "CUSTOM", "UNRESOLVED"] as const)[nextRandom() % 7]!, sourceRefs: [`property:${caseIndex}:image`] },
        { operation: "UPSERT", target: `REQUIREMENT:property-${caseIndex}`, value: { category: "FEATURE", statement: `Synthetic property requirement ${caseIndex}.`, sourceRefs: [`property:${caseIndex}:requirement`] }, sourceRefs: [`property:${caseIndex}:requirement`] },
      ];
      const selected = candidates.filter((_candidate, index) => index === 0 || (nextRandom() & 1) === 1);
      const duplicate = selected[0];
      const withRepeat = duplicate ? [...selected, { ...duplicate, sourceRefs: [...(duplicate.sourceRefs ?? []), `property:${caseIndex}:repeat`] }] : selected;
      const first = { contractVersion: 1 as const, changes: shuffle(withRepeat), unresolved: [] } satisfies BriefChangeSet;
      const second = { contractVersion: 1 as const, changes: shuffle(withRepeat), unresolved: [] } satisfies BriefChangeSet;
      const a = applyBriefChangeSet(cleanBriefV3, first);
      const b = applyBriefChangeSet(cleanBriefV3, second);
      expect(a).toEqual(b);
      expect(normalizeBriefChangeSet(first)).toEqual(normalizeBriefChangeSet(second));
      expect(changeSetChecksum(first)).toBe(changeSetChecksum(second));
      expect(normalizeCanonicalBrief(a)).toEqual(a);
      generatedPropertyCases += 1;
    }
    expect(generatedPropertyCases).toBe(512);
    mark("Reducer properties");
    mark("Normalization");
    mark("Serialization/checksum");
    mark("Adversarial cases");
  });
});
