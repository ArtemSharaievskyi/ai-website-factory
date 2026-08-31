import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { canonicalRequirementEntries } from "@/domain/requirements/v3/identity";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { buildPlanningPackage } from "./deterministic";
import {
  bindPlanningRecoverySemanticAccounting,
  createCanonicalPlanningRouteManifest,
  createPlanningOwnedRequirementManifest,
  createPlanningRecoverySemanticAccountingSchema,
  createPlanningTargetCatalog,
  PLANNING_TARGET_KINDS_BY_DISPOSITION,
  PlanningRequirementDispositionSchema,
  PlanningRequirementHandleSchema,
  type PlanningTargetRef,
  validatePlanningRecoveryRequirementAccounting,
} from "./recovery-manifests";
import {
  normalizePlanningPackageForHost,
  validatePlanningRecoveryRequirementCoverage,
  validatePlanningRecoveryRouteManifest,
} from "./refresh-admission";

const timestamp = "2026-08-30T10:00:00.000Z";

function accountingFor(manifest: ReturnType<typeof createPlanningOwnedRequirementManifest>) {
  return manifest.requirements.map((entry) => ({
    requirementId: entry.requirementId,
    requirementDomain: entry.category,
    disposition: entry.category === "EXCLUSION" || entry.category === "PROHIBITED" ? "EXPLICIT_EXCLUSION" as const : "OTHER_PLANNING_RESPONSIBILITY" as const,
    planningTargetRefs: [{ kind: "section" as const, section: "traceability" as const }],
    semanticEvidence: `Synthetic semantic treatment for ${entry.requirementId}.`,
  }));
}

function semanticAccountingFor(manifest: ReturnType<typeof createPlanningOwnedRequirementManifest>, routeManifest?: ReturnType<typeof createCanonicalPlanningRouteManifest>) {
  const target = createPlanningTargetCatalog(routeManifest ?? { routes: [] }).targets.find((entry) => entry.kind === "section" && entry.section === "traceability")!;
  return Object.fromEntries(manifest.requirements.map((entry) => [entry.requirementHandle, {
    disposition: entry.category === "EXCLUSION" || entry.category === "PROHIBITED" ? "EXPLICIT_EXCLUSION" as const : "OTHER_PLANNING_RESPONSIBILITY" as const,
    planningTargetRefs: [{ targetHandle: target.targetHandle }],
    semanticEvidence: `The Planning package records the approved responsibility for ${entry.category.toLocaleLowerCase("en")} requirements.`,
  }]));
}

function syntheticBrief(): CanonicalBriefV3 {
  return CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    pages: [
      ...cleanBriefV3.pages,
      { id: "PAGE:synthetic-services", slug: "services", purpose: "Explain synthetic services.", sourceRefs: ["fixture:services"] },
      { id: "PAGE:synthetic-privacy", slug: "privacy", purpose: "Explain the synthetic privacy notice.", sourceRefs: ["fixture:privacy"] },
    ],
    decisions: { ...cleanBriefV3.decisions, routePolicy: { mode: "MULTI_PAGE" } },
  });
}

function candidateFor(brief: CanonicalBriefV3) {
  const projectId = randomUUID();
  const compatibility = RequirementSpecificationSchema.parse({
    ...representativeV1Brief,
    projectId,
    projectVersion: 1,
    projectSummary: "Synthetic recovery project.",
    approval: { approved: true, approvedRequirementsChecksum: canonicalBriefChecksum(brief) },
    briefStatus: "approved",
  });
  const input = {
    projectId,
    projectVersion: 1,
    approvedBrief: compatibility,
    canonicalBrief: brief,
    approvedBriefChecksum: canonicalBriefChecksum(brief),
    originalPromptReference: "synthetic-recovery-manifest-test",
    clarificationEvidenceReferences: [],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION" as const,
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: randomUUID(),
    expectedRowVersion: 1,
  };
  const packageValue = buildPlanningPackage(input);
  const candidate = normalizePlanningPackageForHost({
    candidate: packageValue,
    projectId,
    projectVersion: 1,
    approvedBriefChecksum: canonicalBriefChecksum(brief),
    canonicalBrief: brief,
    timestamp,
  });
  return {
    projectId,
    candidate: {
      ...candidate,
      traceability: [...candidate.traceability, {
        decisionId: randomUUID(),
        category: "synthetic-recovery-coverage",
        requirementReferences: canonicalRequirementEntries(brief).map((entry) => entry.id),
        systemConstraintReferences: ["synthetic-recovery-fixture"],
        rationale: "Synthetic fixture covers every current canonical requirement.",
        confidence: "high" as const,
        userConfirmationRequired: false,
      }],
    },
  };
}

function mapCandidate(value: unknown, transform: (key: string, value: unknown) => unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) return value.map((child) => mapCandidate(child, transform, parentKey));
  if (!value || typeof value !== "object") return transform(parentKey, value);
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) result[key] = transform(key, mapCandidate(child, transform, key));
  return result;
}

describe("host-issued Planning Recovery manifests", () => {
  it("derives exact synthetic multi-page and single-page route sets without a pilot-specific count", () => {
    const multi = createCanonicalPlanningRouteManifest(syntheticBrief());
    expect(multi.routePolicy).toBe("MULTI_PAGE");
    expect(multi.routes.map((route) => route.path)).toEqual(["/", "/services", "/privacy"]);
    expect(multi.routes.every((route) => route.routeHandle.startsWith("planning-route:"))).toBe(true);
    expect(multi.routes.every((route) => route.pageHandle.startsWith("planning-page:"))).toBe(true);
    expect(multi.manifestChecksum).toMatch(/^[a-f0-9]{64}$/);
    const single = createCanonicalPlanningRouteManifest(cleanBriefV3);
    expect(single.routePolicy).toBe("SINGLE_PAGE");
    expect(single.routes).toHaveLength(cleanBriefV3.pages.length);
  });

  it("derives the complete Planning-owned requirement manifest from current V3 identity entries", () => {
    const brief = syntheticBrief();
    const manifest = createPlanningOwnedRequirementManifest(brief);
    const expected = canonicalRequirementEntries(brief).filter((entry) => !["LEGAL_FACT", "LOGO_METADATA", "IMAGE_NOTE", "RECOMMENDATION"].includes(entry.category));
    expect(manifest.requirements).toHaveLength(expected.length);
    expect(manifest.requirements.map((entry) => entry.requirementId)).toEqual(expected.map((entry) => entry.id));
    expect(manifest.requirements.map((entry) => entry.requirementHandle)).toEqual(manifest.requirements.map((_, index) => `planning-requirement:R${String(index).padStart(3, "0")}`));
    expect(PlanningRequirementHandleSchema.safeParse(`planning-requirement:${manifest.requirements[0]!.requirementId}`).success).toBe(true);
    expect(manifest.manifestChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("passes R1 exact route admission and rejects R2-R9 adversarial route mutations", () => {
    const brief = syntheticBrief();
    const manifest = createCanonicalPlanningRouteManifest(brief);
    const base = candidateFor(brief);
    expect(validatePlanningRecoveryRouteManifest({ candidate: base.candidate, manifest })).toEqual([]); // R1

    const route = base.candidate.sitemap.routes[1]!;
    const cases: Array<[string, typeof base.candidate, string]> = [
      ["R2 missing route", { ...base.candidate, sitemap: { ...base.candidate.sitemap, routes: base.candidate.sitemap.routes.slice(0, 1) } }, "PLANNING_RECOVERY_ROUTE_MANIFEST_CARDINALITY"],
      ["R3 extra route", { ...base.candidate, sitemap: { ...base.candidate.sitemap, routes: [...base.candidate.sitemap.routes, { ...route, id: "route-extra", path: "/" }] } }, "PLANNING_RECOVERY_ROUTE_MANIFEST_CARDINALITY"],
      ["R4 anchor instead of route", { ...base.candidate, sitemap: { ...base.candidate.sitemap, routes: base.candidate.sitemap.routes.map((item) => item.id === route.id ? { ...item, path: "/#services" } : item) } }, "PLANNING_RECOVERY_ROUTE_MANIFEST_CARDINALITY"],
      ["R5 wrong route identity", { ...base.candidate, sitemap: { ...base.candidate.sitemap, routes: base.candidate.sitemap.routes.map((item) => item.id === route.id ? { ...item, id: "provider-route" } : item) } }, "PLANNING_RECOVERY_ROUTE_IDENTITY_MISMATCH:/services"],
      ["R6 missing legal page", { ...base.candidate, pages: { ...base.candidate.pages, pages: base.candidate.pages.pages.filter((item) => item.routeId !== "route-privacy") } }, "PLANNING_RECOVERY_PAGE_MANIFEST_MISSING:/privacy"],
      ["R7 wrong page identity", { ...base.candidate, pages: { ...base.candidate.pages, pages: base.candidate.pages.pages.map((item) => item.routeId === route.id ? { ...item, id: "provider-page" } : item) } }, "PLANNING_RECOVERY_PAGE_IDENTITY_MISMATCH:/services"],
      ["R9 architecture route mismatch", { ...base.candidate, architecture: { ...base.candidate.architecture, routes: base.candidate.architecture.routes.slice(0, 1) } }, "PLANNING_RECOVERY_ARCHITECTURE_ROUTE_MANIFEST_MISMATCH"],
    ];
    for (const [, candidate, blocker] of cases) expect(validatePlanningRecoveryRouteManifest({ candidate, manifest })).toContain(blocker);

    const requiredNavigationManifest = {
      ...manifest,
      routes: manifest.routes.map((item) => item.path === "/services" ? { ...item, navigation: { ...item.navigation, participation: "REQUIRED" as const } } : item),
    };
    const missingNavigation = { ...base.candidate, navigation: { ...base.candidate.navigation, routeReferences: base.candidate.navigation.routeReferences.filter((id) => id !== route.id) } };
    expect(validatePlanningRecoveryRouteManifest({ candidate: missingNavigation, manifest: requiredNavigationManifest })).toContain("PLANNING_RECOVERY_NAVIGATION_ROUTE_MISSING:/services"); // R8
  });

  it("admits an exact single-page representation without multi-page assumptions", () => {
    const manifest = createCanonicalPlanningRouteManifest(cleanBriefV3);
    const base = candidateFor(cleanBriefV3);
    expect(manifest.routePolicy).toBe("SINGLE_PAGE");
    expect(validatePlanningRecoveryRouteManifest({ candidate: base.candidate, manifest })).toEqual([]); // R8
  });

  it("passes C1/C8 complete coverage and classifies C2 missing reference, C3 missing semantics, and C4 missing traceability", () => {
    const brief = syntheticBrief();
    const manifest = createPlanningOwnedRequirementManifest(brief);
    const base = candidateFor(brief).candidate;
    expect(validatePlanningRecoveryRequirementCoverage({ candidate: base, manifest })).toEqual([]); // C1 and C8
    const entry = manifest.requirements.find((item) => item.statement.length > 30)!;

    const withoutReference = mapCandidate(base, (key, value) => key === "requirementReferences" && Array.isArray(value) ? value.filter((reference) => reference !== entry.requirementId) : value);
    expect(validatePlanningRecoveryRequirementCoverage({ candidate: withoutReference as typeof base, manifest })).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: entry.requirementId, reason: "MISSING_REFERENCE" })])); // C2

    const withoutSemantics = mapCandidate(base, (key, value) => key === "requirementReferences" ? value : typeof value === "string" ? "q" : value);
    expect(validatePlanningRecoveryRequirementCoverage({ candidate: withoutSemantics as typeof base, manifest })).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: entry.requirementId, reason: "MISSING_SEMANTIC_EVIDENCE" })])); // C3

    const withoutTraceability = mapCandidate(base, (key, value) => key === "traceability" && Array.isArray(value) ? value.map((item) => mapCandidate(item, (itemKey, itemValue) => itemKey === "requirementReferences" && Array.isArray(itemValue) ? itemValue.filter((reference) => reference !== entry.requirementId) : itemValue)) : value);
    expect(validatePlanningRecoveryRequirementCoverage({ candidate: withoutTraceability as typeof base, manifest })).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: entry.requirementId, reason: "MISSING_TRACEABILITY" })])); // C4
  });

  it("rejects a lost exclusion and preserves the C7 partial-output boundary", () => {
    const brief = CanonicalBriefV3Schema.parse({
      ...syntheticBrief(),
      requirements: [
        ...syntheticBrief().requirements,
        { id: "REQUIREMENT:synthetic-exclusion", category: "EXCLUSION", statement: "Do not add unapproved synthetic capabilities.", sourceRefs: ["fixture:exclusion"] },
      ],
    });
    const manifest = createPlanningOwnedRequirementManifest(brief);
    const base = candidateFor(brief).candidate;
    const exclusion = manifest.requirements.find((item) => item.category === "EXCLUSION")!;
    const withoutExclusion = mapCandidate(base, (key, value) => key === "requirementReferences" && Array.isArray(value)
      ? value.filter((reference) => reference !== exclusion.requirementId)
      : value);
    expect(validatePlanningRecoveryRequirementCoverage({ candidate: withoutExclusion as typeof base, manifest })).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: exclusion.requirementId, reason: "MISSING_REFERENCE" })])); // C6
    expect(validatePlanningRecoveryRequirementCoverage({ candidate: withoutExclusion as typeof base, manifest })).not.toEqual([]); // C7 partial output
  });

  it("retains a large realistic requirement manifest without filtering or truncation", () => {
    const extra = Array.from({ length: 96 }, (_, index) => ({
      id: `REQUIREMENT:large-synthetic-${String(index).padStart(3, "0")}`,
      category: index % 4 === 0 ? "EXCLUSION" as const : index % 4 === 1 ? "FEATURE" as const : index % 4 === 2 ? "ACCEPTANCE" as const : "CONTENT" as const,
      statement: `Preserve the complete synthetic planning requirement ${index + 1} with its approved semantic content.`,
      sourceRefs: [`fixture:large-requirement:${index + 1}`],
    }));
    const brief = CanonicalBriefV3Schema.parse({ ...syntheticBrief(), requirements: [...syntheticBrief().requirements, ...extra] });
    const manifest = createPlanningOwnedRequirementManifest(brief);
    expect(manifest.requirements).toHaveLength(canonicalRequirementEntries(brief).length);
    expect(manifest.requirements.some((entry) => entry.requirementId === extra.at(-1)!.id)).toBe(true); // C8
  });

  it("requires an explicit one-to-one semantic accounting entry for every Planning-owned identity", () => {
    const brief = CanonicalBriefV3Schema.parse({
      ...syntheticBrief(),
      requirements: [
        ...syntheticBrief().requirements,
        { id: "REQUIREMENT:synthetic-exclusion-accounting", category: "EXCLUSION", statement: "Do not add unrelated synthetic capabilities.", sourceRefs: ["fixture:exclusion-accounting"] },
        { id: "REQUIREMENT:synthetic-nonvisual-accounting", category: "DEFERRED_INTEGRATION", statement: "Retain this nonvisual integration constraint for later lifecycle handling.", sourceRefs: ["fixture:nonvisual-accounting"] },
      ],
    });
    const manifest = createPlanningOwnedRequirementManifest(brief);
    const valid = accountingFor(manifest);
    expect(validatePlanningRecoveryRequirementAccounting({ accounting: valid, manifest })).toMatchObject({ expectedRequirementCount: manifest.requirements.length, accountedRequirementCount: manifest.requirements.length, missingRequirementIds: [], issues: [] });

    const missing = valid.slice(0, -1);
    expect(validatePlanningRecoveryRequirementAccounting({ accounting: missing, manifest }).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_REQUIREMENT_ID_ACCOUNTING", requirementId: valid.at(-1)!.requirementId })]));

    const duplicateSubstitution = [...valid.slice(0, -1), valid[0]];
    expect(validatePlanningRecoveryRequirementAccounting({ accounting: duplicateSubstitution, manifest }).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_REQUIREMENT_ID", requirementId: valid[0]!.requirementId }),
      expect.objectContaining({ code: "MISSING_REQUIREMENT_ID_ACCOUNTING", requirementId: valid.at(-1)!.requirementId }),
    ]));

    const orphan = [...valid, { ...valid[0]!, requirementId: "REQUIREMENT:orphan-accounting" }];
    expect(validatePlanningRecoveryRequirementAccounting({ accounting: orphan, manifest }).issues).toContainEqual({ code: "ORPHAN_REQUIREMENT_ID", requirementId: "REQUIREMENT:orphan-accounting" });
    const legacy = [...valid, { ...valid[0]!, requirementId: "REQUIREMENT:legacy-v1-accounting" }];
    expect(validatePlanningRecoveryRequirementAccounting({ accounting: legacy, manifest }).issues).toContainEqual({ code: "LEGACY_REQUIREMENT_ID", requirementId: "REQUIREMENT:legacy-v1-accounting" });
    const invented = [...valid, { ...valid[0]!, requirementId: `REQUIREMENT:v3-${"f".repeat(64)}` }];
    expect(validatePlanningRecoveryRequirementAccounting({ accounting: invented, manifest }).issues).toContainEqual({ code: "INVENTED_REQUIREMENT_ID", requirementId: `REQUIREMENT:v3-${"f".repeat(64)}` });

    const wrongDomain = valid.map((entry) => entry.requirementId === valid[0]!.requirementId ? { ...entry, requirementDomain: "CONTENT" as const } : entry);
    expect(validatePlanningRecoveryRequirementAccounting({ accounting: wrongDomain, manifest }).issues).toContainEqual(expect.objectContaining({ code: "INVALID_REQUIREMENT_DOMAIN", requirementId: valid[0]!.requirementId }));
    const missingDisposition = valid.map((entry) => entry.requirementId === valid[0]!.requirementId ? { ...entry, disposition: undefined } : entry);
    expect(validatePlanningRecoveryRequirementAccounting({ accounting: missingDisposition, manifest }).issues).toContainEqual(expect.objectContaining({ code: "MISSING_DISPOSITION", requirementId: valid[0]!.requirementId }));
    const missingEvidence = valid.map((entry) => entry.requirementId === valid[0]!.requirementId ? { ...entry, semanticEvidence: "   " } : entry);
    expect(validatePlanningRecoveryRequirementAccounting({ accounting: missingEvidence, manifest }).issues).toContainEqual(expect.objectContaining({ code: "MISSING_SEMANTIC_EVIDENCE", requirementId: valid[0]!.requirementId }));
    const compound = [{ ...valid[0]!, requirementId: "REQUIREMENT:legacy-v1-compound", disposition: undefined, semanticEvidence: " ", planningTargetRefs: ["provider-invented-artifact"] }];
    const compoundIssues = validatePlanningRecoveryRequirementAccounting({ accounting: compound, manifest }).issues;
    expect(compoundIssues).toEqual(expect.arrayContaining([
      { code: "LEGACY_REQUIREMENT_ID", requirementId: "REQUIREMENT:legacy-v1-compound" },
      { code: "MISSING_DISPOSITION", requirementId: "REQUIREMENT:legacy-v1-compound" },
      { code: "MISSING_SEMANTIC_EVIDENCE", requirementId: "REQUIREMENT:legacy-v1-compound" },
      { code: "INVALID_PLANNING_TARGET_REF", requirementId: "REQUIREMENT:legacy-v1-compound" },
    ]));

    const exclusion = valid.find((entry) => entry.requirementId === "REQUIREMENT:synthetic-exclusion-accounting")!;
    expect(exclusion.disposition).toBe("EXPLICIT_EXCLUSION");
    expect(valid.some((entry) => entry.requirementId === "REQUIREMENT:synthetic-nonvisual-accounting")).toBe(true);
  });

  it("binds keyed semantic accounting to host identity and rejects provider identity fields", () => {
    const brief = syntheticBrief();
    const manifest = createPlanningOwnedRequirementManifest(brief);
    const semanticAccounting = semanticAccountingFor(manifest);
    const schema = createPlanningRecoverySemanticAccountingSchema(manifest);
    expect(schema.safeParse(semanticAccounting).success).toBe(true);
    const firstHandle = manifest.requirements[0]!.requirementHandle;
    expect(schema.safeParse({ ...semanticAccounting, [firstHandle]: { ...semanticAccounting[firstHandle]!, requirementId: manifest.requirements[0]!.requirementId } }).success).toBe(false);

    const binding = bindPlanningRecoverySemanticAccounting({ semanticAccounting, manifest });
    expect(binding.validation).toMatchObject({ expectedRequirementCount: manifest.requirements.length, accountedRequirementCount: manifest.requirements.length, missingRequirementIds: [], issues: [] });
    expect(binding.accounting.map((entry) => entry.requirementId)).toEqual(manifest.requirements.map((entry) => entry.requirementId));
    expect(binding.accounting.map((entry) => entry.requirementDomain)).toEqual(manifest.requirements.map((entry) => entry.category));
  });

  it("requires exact accounting cardinality for the production-shaped 118-entry manifest", () => {
    const base = createPlanningOwnedRequirementManifest(cleanBriefV3);
    const extraCount = 118 - base.requirements.length;
    expect(extraCount).toBeGreaterThan(0);
    const brief = CanonicalBriefV3Schema.parse({
      ...cleanBriefV3,
      requirements: [
        ...cleanBriefV3.requirements,
        ...Array.from({ length: extraCount }, (_, index) => ({
          id: `REQUIREMENT:production-accounting-${String(index).padStart(3, "0")}`,
          category: "FEATURE" as const,
          statement: `Preserve production-shaped Planning responsibility ${index + 1}.`,
          sourceRefs: [`fixture:production-accounting:${index}`],
        })),
      ],
    });
    const manifest = createPlanningOwnedRequirementManifest(brief);
    expect(manifest.requirements).toHaveLength(118);
    const valid = semanticAccountingFor(manifest);
    const complete = bindPlanningRecoverySemanticAccounting({ semanticAccounting: valid, manifest });
    expect(complete.validation.issues).toEqual([]);
    for (const [count, expectedMissing] of [[117, 1], [119, 0]] as const) {
      const entries = Object.entries(valid);
      const value = Object.fromEntries(count === 117 ? entries.slice(0, 117) : [...entries, [`planning-requirement:R118`, entries[0]![1]]]);
      const result = bindPlanningRecoverySemanticAccounting({ semanticAccounting: value, manifest });
      expect(result.validation.issues).toContainEqual({ code: "ACCOUNTING_CARDINALITY_MISMATCH" });
      expect(result.validation.missingRequirementIds).toHaveLength(expectedMissing);
    }
  });

  it("validates typed target ownership and evidence without keyword-overlap admission", () => {
    const brief = syntheticBrief();
    const manifest = createPlanningOwnedRequirementManifest(brief);
    const routeManifest = createCanonicalPlanningRouteManifest(brief);
    const base = candidateFor(brief);
    const valid = semanticAccountingFor(manifest, routeManifest);
    const firstHandle = manifest.requirements[0]!.requirementHandle;
    const paraphrase = { ...valid, [firstHandle]: { ...valid[firstHandle]!, semanticEvidence: "The approved responsibility is represented in the planning content." } };
    expect(bindPlanningRecoverySemanticAccounting({ semanticAccounting: paraphrase, manifest, candidate: base.candidate, routeManifest }).validation.issues).toEqual([]);

    const unrelatedTarget = { ...valid, [firstHandle]: { ...valid[firstHandle]!, planningTargetRefs: [{ targetHandle: createPlanningTargetCatalog(routeManifest).targets.find((entry) => entry.kind === "section" && entry.section === "traceability")!.targetHandle }] } };
    const candidateWithoutRelationship = {
      ...base.candidate,
      traceability: base.candidate.traceability.map((item) => ({ ...item, requirementReferences: item.requirementReferences.filter((reference) => reference !== manifest.requirements[0]!.requirementId) })).filter((item) => item.requirementReferences.length > 0),
    };
    expect(bindPlanningRecoverySemanticAccounting({ semanticAccounting: unrelatedTarget, manifest, candidate: candidateWithoutRelationship, routeManifest }).validation.issues).not.toContainEqual(expect.objectContaining({ code: "TARGET_RELATIONSHIP_INVALID", requirementId: manifest.requirements[0]!.requirementId }));

    const placeholder = { ...valid, [firstHandle]: { ...valid[firstHandle]!, semanticEvidence: "handled" } };
    expect(bindPlanningRecoverySemanticAccounting({ semanticAccounting: placeholder, manifest, candidate: base.candidate, routeManifest }).validation.issues).toContainEqual(expect.objectContaining({ code: "PLACEHOLDER_SEMANTIC_EVIDENCE", requirementId: manifest.requirements[0]!.requirementId }));

    const foreignTarget = { ...valid, [firstHandle]: { ...valid[firstHandle]!, planningTargetRefs: [{ targetHandle: "planning-target:T999" }] } };
    expect(bindPlanningRecoverySemanticAccounting({ semanticAccounting: foreignTarget, manifest, candidate: base.candidate, routeManifest }).validation.issues).toContainEqual(expect.objectContaining({ code: "TARGET_NOT_IN_CANDIDATE", requirementId: manifest.requirements[0]!.requirementId }));

    const incompatibleTarget = { ...valid, [firstHandle]: { ...valid[firstHandle]!, disposition: "ARCHITECTURE_CONSTRAINT" as const, planningTargetRefs: [{ targetHandle: createPlanningTargetCatalog(routeManifest).targets.find((entry) => entry.kind === "page")!.targetHandle }] } };
    expect(bindPlanningRecoverySemanticAccounting({ semanticAccounting: incompatibleTarget, manifest, candidate: base.candidate, routeManifest }).validation.issues).toContainEqual(expect.objectContaining({ code: "TARGET_TYPE_INCOMPATIBLE", requirementId: manifest.requirements[0]!.requirementId }));
  });

  it("keeps the complete disposition matrix structural and bounded", () => {
    const brief = syntheticBrief();
    const manifest = createPlanningOwnedRequirementManifest(brief);
    const routeManifest = createCanonicalPlanningRouteManifest(brief);
    const candidate = candidateFor(brief).candidate;
    const catalog = createPlanningTargetCatalog(routeManifest);
    const entriesByKind = Object.fromEntries((["route", "page", "section"] as const).map((kind) => [kind, catalog.targets.find((entry) => entry.kind === kind)!])) as Record<PlanningTargetRef["kind"], (typeof catalog.targets)[number]>;
    const targetRef = (kind: PlanningTargetRef["kind"]): PlanningTargetRef => {
      const entry = entriesByKind[kind];
      if (kind === "route") return { kind: "route", routeHandle: entry.routeHandle! };
      if (kind === "page") return { kind: "page", pageHandle: entry.pageHandle! };
      return { kind: "section", section: entry.section! };
    };
    const base = accountingFor(manifest);
    const firstRequirement = manifest.requirements[0]!;

    for (const disposition of PlanningRequirementDispositionSchema.options) {
      const allowed = PLANNING_TARGET_KINDS_BY_DISPOSITION[disposition];
      for (const kind of allowed) {
        const accounting = base.map((entry) => entry.requirementId === firstRequirement.requirementId ? { ...entry, disposition, planningTargetRefs: [targetRef(kind)] } : entry);
        expect(validatePlanningRecoveryRequirementAccounting({ accounting, manifest, candidate, routeManifest }).issues).not.toContainEqual(expect.objectContaining({ code: "TARGET_TYPE_INCOMPATIBLE", requirementId: firstRequirement.requirementId }));
      }
      const disallowed = (["route", "page", "section"] as const).find((kind) => !allowed.includes(kind));
      if (disallowed) {
        const accounting = base.map((entry) => entry.requirementId === firstRequirement.requirementId ? { ...entry, disposition, planningTargetRefs: [targetRef(disallowed)] } : entry);
        expect(validatePlanningRecoveryRequirementAccounting({ accounting, manifest, candidate, routeManifest }).issues).toContainEqual(expect.objectContaining({ code: "TARGET_TYPE_INCOMPATIBLE", requirementId: firstRequirement.requirementId }));
      }
    }
  });

  it("keeps explicit canonical route bindings hard while allowing supplementary sections", () => {
    const brief = syntheticBrief();
    const manifest = createPlanningOwnedRequirementManifest(brief);
    const baseRoutes = createCanonicalPlanningRouteManifest(brief);
    const firstRequirement = manifest.requirements[0]!;
    const routeManifest = {
      ...baseRoutes,
      routes: baseRoutes.routes.map((route, index) => index === 1 ? { ...route, requirementIds: [firstRequirement.requirementId] } : route),
    };
    const catalog = createPlanningTargetCatalog(routeManifest);
    const firstHandle = firstRequirement.requirementHandle;
    const base = semanticAccountingFor(manifest, routeManifest);
    const routeTargets = catalog.targets.filter((entry) => entry.kind === "route");
    const canonicalRoute = routeTargets[1]!;
    const otherRoute = routeTargets[0]!;
    const canonical = bindPlanningRecoverySemanticAccounting({
      semanticAccounting: { ...Object.fromEntries(manifest.requirements.map((entry) => [entry.requirementHandle, { ...base[entry.requirementHandle]!, planningTargetRefs: [{ targetHandle: canonicalRoute.targetHandle }] }])), [firstHandle]: { ...base[firstHandle]!, planningTargetRefs: [{ targetHandle: canonicalRoute.targetHandle }] } },
      manifest,
      candidate: candidateFor(brief).candidate,
      routeManifest,
      targetCatalog: catalog,
    });
    expect(canonical.validation.issues).not.toContainEqual(expect.objectContaining({ code: "TARGET_RELATIONSHIP_INVALID", requirementId: firstRequirement.requirementId }));

    const contradictory = bindPlanningRecoverySemanticAccounting({
      semanticAccounting: { ...Object.fromEntries(manifest.requirements.map((entry) => [entry.requirementHandle, { ...base[entry.requirementHandle]!, planningTargetRefs: [{ targetHandle: canonicalRoute.targetHandle }] }])), [firstHandle]: { ...base[firstHandle]!, planningTargetRefs: [{ targetHandle: otherRoute.targetHandle }] } },
      manifest,
      candidate: candidateFor(brief).candidate,
      routeManifest,
      targetCatalog: catalog,
    });
    expect(contradictory.validation.issues).toContainEqual(expect.objectContaining({ code: "TARGET_RELATIONSHIP_INVALID", requirementId: firstRequirement.requirementId }));
  });
});
