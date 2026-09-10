import { z } from "zod";
import { createHash } from "node:crypto";
import type { RequirementSpecification } from "@/domain/requirements/schema";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { buildPlanningPackage } from "./deterministic";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  PLANNER_ELEMENT_KINDS_BY_DOMAIN,
  isPlannerElementKindAllowedInDomain,
  plannerCoverageCompatibility,
  PlannerCoverageDiagnosticsSchema,
  PlannerCoverageTargetTableSchema,
  type PlannerCoverageElementKind,
  type PlannerCoverageDiagnostics,
  type PlannerCoverageTargetBinding,
  type PlannerCoverageTargetTable,
  type AdmissibleCoverageTargetsByRequirement,
  type PlannerDecompositionKindDomainDiagnostics,
} from "./coverage-contract";
import {
  PlannerReferenceTableSchema,
  type PlannerReferenceTable,
} from "./reference-table";
import {
  PlanningDecompositionProviderOutputSchema,
  PlanningDecompositionProviderOutputV2Schema,
  PlanningElementGraphSchema,
  PlanningElementSchema,
  STAGED_PLANNER_PIPELINE_VERSION,
  createPlanningCoverageProviderOutputSchema,
  type PlanningDecompositionProviderOutput,
  type PlanningElement,
  type PlanningElementGraph,
  type PlanningElementProposal,
  type PlanningCoverageProviderOutput,
  type PlanningGraphCycleDiagnostics,
} from "./staged-contracts";
import {
  createDecompositionMinimumContract,
  decompositionMinimumSatisfied,
  requiredDecompositionDomains,
  type DecompositionMinimumDiagnostics,
} from "./decomposition-minimum";
import { PlanningPackageSchema, type PlannerAgentInput, type PlanningPackage } from "./contracts";
import {
  PlannerReferenceBindingError,
  validatePlannerRequirementCoverage,
  type PlannerCoverageElementDescriptor,
} from "@/integrations/openai/adapters";

const GENERIC_ELEMENT_TEXT = /^(?:same as (?:the )?brief|see (?:the )?plan|covered|handled|implemented)$/i;

export type StagedPlannerFailureCode =
  | "PLANNING_DECOMPOSITION_INVALID"
  | "PLANNING_DECOMPOSITION_ROUTE_UNKNOWN"
  | "PLANNING_DECOMPOSITION_DUPLICATE"
  | "PLANNING_DECOMPOSITION_PATHOLOGY"
  | "PLANNING_DECOMPOSITION_DOMAIN_MISSING"
  | "PLANNING_GRAPH_INVALID"
  | "PLANNING_GRAPH_CYCLE"
  | "PLANNING_GRAPH_DOMAIN_INVERSION"
  | "PLANNING_COVERAGE_INVALID";

export class StagedPlanningAdmissionError extends Error {
  constructor(
    readonly code: StagedPlannerFailureCode,
    readonly fieldPath: string,
    readonly reasonCode?: string,
    safeToken?: string,
    readonly kindDomainDiagnostics?: PlannerDecompositionKindDomainDiagnostics,
    readonly graphCycleDiagnostics?: PlanningGraphCycleDiagnostics,
    readonly coverageDiagnostics?: PlannerCoverageDiagnostics,
    readonly minimumDiagnostics?: DecompositionMinimumDiagnostics,
  ) {
    super(`${code}:${fieldPath}`);
    this.name = "StagedPlanningAdmissionError";
    this.safeToken = typeof safeToken === "string" && /^(?:REQ|PE|PAGE|ROUTE)_\d{3,}$/.test(safeToken)
      ? safeToken
      : typeof reasonCode === "string" && /^(?:REQ|PE|PAGE|ROUTE)_\d{3,}$/.test(reasonCode)
        ? reasonCode
        : undefined;
  }
  readonly safeToken?: string;
}

export function stagedPlanningAdmissionDiagnostics(error: unknown, depth = 0): PlannerDecompositionKindDomainDiagnostics | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  if (error instanceof StagedPlanningAdmissionError) return error.kindDomainDiagnostics;
  return "cause" in error ? stagedPlanningAdmissionDiagnostics(error.cause, depth + 1) : undefined;
}

export function stagedPlanningGraphCycleDiagnostics(error: unknown, depth = 0): PlanningGraphCycleDiagnostics | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  if (error instanceof StagedPlanningAdmissionError) return error.graphCycleDiagnostics;
  return "cause" in error ? stagedPlanningGraphCycleDiagnostics(error.cause, depth + 1) : undefined;
}

export function stagedPlanningCoverageDiagnostics(error: unknown, depth = 0): PlannerCoverageDiagnostics | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  if (error instanceof StagedPlanningAdmissionError) return error.coverageDiagnostics;
  if (error instanceof PlannerReferenceBindingError) return error.coverageDiagnostics;
  if ("coverageDiagnostics" in error) {
    const parsed = PlannerCoverageDiagnosticsSchema.safeParse(error.coverageDiagnostics);
    if (parsed.success) return parsed.data;
  }
  return "cause" in error ? stagedPlanningCoverageDiagnostics(error.cause, depth + 1) : undefined;
}

export function stagedPlanningMinimumDiagnostics(error: unknown, depth = 0): DecompositionMinimumDiagnostics | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  if (error instanceof StagedPlanningAdmissionError) return error.minimumDiagnostics;
  return "cause" in error ? stagedPlanningMinimumDiagnostics(error.cause, depth + 1) : undefined;
}

const normalized = (value: string) => value.normalize("NFKD").toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();

export function requiredPlannerDecompositionDomains(input: { brief: RequirementSpecification; canonicalBrief?: CanonicalBriefV3 }) {
  return requiredDecompositionDomains(input);
}

function validateProposalReferences(proposal: PlanningElementProposal, table: PlannerReferenceTable, index: number) {
  const pages = new Set(table.pages.map((entry) => entry.token));
  const routes = new Map(table.routes.map((entry) => [entry.token, entry]));
  for (const pageToken of proposal.pageTokens ?? []) {
    if (!pages.has(pageToken)) throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_ROUTE_UNKNOWN", `elements[${index}].pageTokens`, pageToken);
  }
  for (const routeToken of proposal.routeTokens ?? []) {
    const route = routes.get(routeToken);
    if (!route) throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_ROUTE_UNKNOWN", `elements[${index}].routeTokens`, routeToken);
    if ((proposal.pageTokens ?? []).length > 0 && !proposal.pageTokens!.includes(route.pageToken))
      throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_ROUTE_UNKNOWN", `elements[${index}].pageTokens`, route.pageToken);
  }
}

function hasRequiredPageOrRoute(proposal: PlanningElementProposal, table: PlannerReferenceTable) {
  const requiredPageTokens = new Set(table.pages.map((entry) => entry.token));
  const requiredRouteTokens = new Set(table.routes.map((entry) => entry.token));
  return (proposal.pageTokens ?? []).some((token) => requiredPageTokens.has(token))
    || (proposal.routeTokens ?? []).some((token) => requiredRouteTokens.has(token));
}

/** Deterministically admits semantic proposals and assigns all PE_* identity. */
export function admitPlanningDecomposition(input: {
  output: unknown;
  table: PlannerReferenceTable;
  brief: RequirementSpecification;
  canonicalBrief?: CanonicalBriefV3;
}): PlanningElement[] {
  let parsed: PlanningDecompositionProviderOutput;
  try {
    parsed = PlanningDecompositionProviderOutputSchema.parse(input.output);
  } catch {
    const historical = PlanningDecompositionProviderOutputV2Schema.safeParse(input.output);
    if (!historical.success) throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_INVALID", "decomposition");
    parsed = { ...historical.data, providerContractVersion: "planner.decomposition.v3" };
  }
  return admitPlanningDecompositionSemantics({ ...input, output: parsed });
}

/**
 * Host semantic admission after the provider wire boundary. This separate
 * entry point keeps the deterministic guard directly testable even when a
 * typed proposal is supplied by an internal caller.
 */
export function admitPlanningDecompositionSemantics(input: {
  output: PlanningDecompositionProviderOutput;
  table: PlannerReferenceTable;
  brief: RequirementSpecification;
  canonicalBrief?: CanonicalBriefV3;
}): PlanningElement[] {
  const table = PlannerReferenceTableSchema.parse(input.table);
  const parsed = input.output;
  const signatures = new Set<string>();
  const elements: PlanningElement[] = [];
  const seenKinds = new Set<PlannerCoverageElementKind>();
  for (const [index, proposal] of parsed.elements.entries()) {
    if (!isPlannerElementKindAllowedInDomain(proposal.kind, proposal.domain))
      throw new StagedPlanningAdmissionError(
        "PLANNING_DECOMPOSITION_INVALID",
        `elements[${index}].domain`,
        "PLANNING_DECOMPOSITION_KIND_DOMAIN_MISMATCH",
        undefined,
        { actualDomain: proposal.domain, actualKind: proposal.kind, allowedKindsForDomain: [...PLANNER_ELEMENT_KINDS_BY_DOMAIN[proposal.domain]], elementIndex: index },
      );
    if (GENERIC_ELEMENT_TEXT.test(proposal.title.trim()) || GENERIC_ELEMENT_TEXT.test(proposal.description.trim()))
      throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_PATHOLOGY", `elements[${index}].description`, "PLANNING_DECOMPOSITION_GENERIC_ELEMENT");
    validateProposalReferences(proposal, table, index);
    const signature = [proposal.kind, proposal.domain, normalized(proposal.title), normalized(proposal.description), ...(proposal.pageTokens ?? []), ...(proposal.routeTokens ?? [])].join("|");
    if (signatures.has(signature)) throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_DUPLICATE", `elements[${index}]`);
    signatures.add(signature);
    seenKinds.add(proposal.kind);
    const elementId = `PE_${String(index + 1).padStart(3, "0")}`;
    elements.push(PlanningElementSchema.parse({
      elementId,
      kind: proposal.kind,
      domain: proposal.domain,
      title: proposal.title,
      description: proposal.description,
      pageTokens: [...new Set(proposal.pageTokens ?? [])],
      routeTokens: [...new Set(proposal.routeTokens ?? [])],
      dependencies: [],
      negativeEvidence: proposal.negativeEvidence ?? false,
      negativeOnly: proposal.negativeOnly ?? false,
    }));
  }
  const minimumContract = createDecompositionMinimumContract({ brief: input.brief, canonicalBrief: input.canonicalBrief });
  const hasPageOrRoute = seenKinds.has("PAGE") || seenKinds.has("ROUTE");
  const hasRequiredPageOrRouteBinding = parsed.elements.some((proposal) => hasRequiredPageOrRoute(proposal, table));
  const minimumResult = decompositionMinimumSatisfied({ elements, contract: minimumContract, hasPageOrRoute, hasRequiredPageOrRouteBinding });
  const minimum = minimumResult.diagnostics;
  if (!minimumResult.satisfied) {
    const missingDomainOnly = minimum.missingRequiredDomains.some((domain) => minimum.actualCountByDomain[domain] === 0)
      && minimum.actualElementCount >= minimum.minimumElementCount
      && minimum.missingRequiredKinds.length === 0
      && hasPageOrRoute
      && hasRequiredPageOrRouteBinding;
    if (missingDomainOnly) {
      const missingDomain = minimum.missingRequiredDomains.find((domain) => minimum.actualCountByDomain[domain] === 0)!;
      throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_DOMAIN_MISSING", "elements", missingDomain, undefined, undefined, undefined, undefined, minimum);
    }
    throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_INVALID", "elements", "PLANNING_DECOMPOSITION_MINIMUM_ELEMENTS", undefined, undefined, undefined, undefined, minimum);
  }
  const pageTokens = new Set(elements.flatMap((element) => element.pageTokens));
  const routeTokens = new Set(elements.flatMap((element) => element.routeTokens));
  if (table.pages.some((page) => !pageTokens.has(page.token)))
    throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_ROUTE_UNKNOWN", "elements", "PLANNING_DECOMPOSITION_CANONICAL_PAGE_MISSING");
  if (table.routes.some((route) => !routeTokens.has(route.token)))
    throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_ROUTE_UNKNOWN", "elements", "PLANNING_DECOMPOSITION_CANONICAL_ROUTE_MISSING");
  const byIndex = new Map(parsed.elements.map((_, index) => [index, elements[index]!.elementId]));
  for (const [index, proposal] of parsed.elements.entries()) {
    const dependencies = [...new Set(proposal.dependencies ?? [])];
    if (dependencies.some((dependency) => dependency === index || !byIndex.has(dependency)))
      throw new StagedPlanningAdmissionError("PLANNING_DECOMPOSITION_INVALID", `elements[${index}].dependencies`, "PLANNING_DECOMPOSITION_DEPENDENCY_INDEX_INVALID");
    elements[index]!.dependencies = dependencies.map((dependency) => byIndex.get(dependency)!).sort();
  }
  const cycleDiagnostics = planningElementGraphCycleDiagnostics(elements);
  if (cycleDiagnostics)
    throw new StagedPlanningAdmissionError(
      "PLANNING_DECOMPOSITION_INVALID",
      "elements.dependencies",
      "PLANNING_GRAPH_CYCLE",
      undefined,
      undefined,
      cycleDiagnostics,
    );
  return elements.map((element) => PlanningElementSchema.parse(element));
}

const forbiddenInversion: ReadonlySet<string> = new Set([
  "DATABASE>FRONTEND",
  "AUTHENTICATION>FRONTEND",
  "SECURITY>QA",
]);

export function planningElementGraphCycleDiagnostics(elements: readonly PlanningElement[]): PlanningGraphCycleDiagnostics | undefined {
  const graph = new Map(elements.map((element) => [element.elementId, element.dependencies]));
  const byId = new Map(elements.map((element) => [element.elementId, element]));
  const active = new Set<string>();
  const activeIndex = new Map<string, number>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string): string[] | undefined => {
    const cycleStart = activeIndex.get(id);
    if (cycleStart !== undefined) return stack.slice(cycleStart);
    if (visited.has(id)) return undefined;
    active.add(id);
    activeIndex.set(id, stack.length);
    stack.push(id);
    for (const dependency of [...(graph.get(id) ?? [])].sort()) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    activeIndex.delete(id);
    active.delete(id);
    visited.add(id);
    return undefined;
  };
  for (const id of [...graph.keys()].sort()) {
    const cycle = visit(id);
    if (!cycle) continue;
    const cycleEdges = cycle.map((fromPE, index) => {
      const toPE = cycle[(index + 1) % cycle.length]!;
      const from = byId.get(fromPE)!;
      const to = byId.get(toPE)!;
      return {
        fromPE,
        toPE,
        relationshipType: "DEPENDS_ON" as const,
        source: "PROVIDER_DECLARED" as const,
        fromDomain: from.domain,
        fromKind: from.kind,
        toDomain: to.domain,
        toKind: to.kind,
      };
    });
    return {
      cycleLength: cycle.length,
      cyclePeTokens: cycle,
      cycleEdges,
    };
  }
  return undefined;
}

/** Stage 2 is deterministic: PE identity and graph integrity need no model call. */
export function finalizePlanningElementGraph(elements: readonly PlanningElement[]): PlanningElementGraph {
  const parsed = z.array(PlanningElementSchema).min(1).max(256).safeParse(elements);
  if (!parsed.success) throw new StagedPlanningAdmissionError("PLANNING_GRAPH_INVALID", "elements");
  const ids = new Set(parsed.data.map((element) => element.elementId));
  if (ids.size !== parsed.data.length) throw new StagedPlanningAdmissionError("PLANNING_GRAPH_INVALID", "elements", "PLANNING_GRAPH_DUPLICATE_ELEMENT_ID");
  const edges = parsed.data.flatMap((element) => element.dependencies.map((dependency) => {
    if (!ids.has(dependency)) throw new StagedPlanningAdmissionError("PLANNING_GRAPH_INVALID", `elements.${element.elementId}.dependencies`, dependency);
    const target = parsed.data.find((candidate) => candidate.elementId === dependency)!;
    if (forbiddenInversion.has(`${element.domain}>${target.domain}`))
      throw new StagedPlanningAdmissionError("PLANNING_GRAPH_DOMAIN_INVERSION", `edges.${element.elementId}.${dependency}`);
    return { from: element.elementId, to: dependency, relation: "DEPENDS_ON" as const };
  }));
  if (new Set(edges.map((edge) => `${edge.from}>${edge.to}`)).size !== edges.length)
    throw new StagedPlanningAdmissionError("PLANNING_GRAPH_INVALID", "edges", "PLANNING_GRAPH_DUPLICATE_EDGE");
  const cycleDiagnostics = planningElementGraphCycleDiagnostics(parsed.data);
  if (cycleDiagnostics)
    throw new StagedPlanningAdmissionError("PLANNING_GRAPH_CYCLE", "edges", "PLANNING_GRAPH_CYCLE", undefined, undefined, cycleDiagnostics);
  return PlanningElementGraphSchema.parse({ schemaVersion: 1, elements: parsed.data, edges });
}

function descriptorFor(element: PlanningElement): PlannerCoverageElementDescriptor {
  return {
    kind: element.kind,
    domains: [element.domain],
    ...(element.pageTokens[0] ? { pageToken: element.pageTokens[0] } : {}),
    ...(element.routeTokens[0] ? { routeToken: element.routeTokens[0] } : {}),
    ...(element.pageTokens.length > 0 ? { pageTokens: element.pageTokens } : {}),
    ...(element.routeTokens.length > 0 ? { routeTokens: element.routeTokens } : {}),
    negativeEvidence: element.negativeEvidence,
    negativeOnly: element.negativeOnly,
  };
}

/** Derive the current host-owned PE whitelist without using text similarity. */
export function deriveAdmissibleCoverageTargets(
  input: Pick<PlannerReferenceTable, "requirements">,
  elements: readonly PlanningElement[],
): AdmissibleCoverageTargetsByRequirement {
  const index = new Map<string, PlannerCoverageElementDescriptor>();
  for (const element of elements) {
    if (index.has(element.elementId))
      throw new StagedPlanningAdmissionError("PLANNING_COVERAGE_INVALID", "elements", "PLANNING_COVERAGE_ELEMENT_ID_COLLISION", element.elementId);
    index.set(element.elementId, descriptorFor(element));
  }
  return Object.fromEntries(
    input.requirements.filter((entry) => entry.mandatory).map((entry) => [
      entry.token,
      [...index.entries()]
        .filter(([, descriptor]) => plannerCoverageCompatibility(entry.coverageConstraints, descriptor).compatible)
        .map(([elementId]) => elementId)
        .sort(),
    ]),
  );
}

export function createAdmissibleCoverageTargetTable(input: {
  table: PlannerReferenceTable;
  elements: readonly PlanningElement[];
  graph: PlanningElementGraph;
  binding: PlannerCoverageTargetBinding;
}): PlannerCoverageTargetTable {
  const table = PlannerReferenceTableSchema.parse(input.table);
  const graph = PlanningElementGraphSchema.parse(input.graph);
  const targetTable = PlannerCoverageTargetTableSchema.parse({
    binding: input.binding,
    admissibleCoverageTargetsByRequirement: deriveAdmissibleCoverageTargets(table, input.elements),
  });
  const expectedTokens = table.requirements.filter((entry) => entry.mandatory).map((entry) => entry.token);
  const actualTokens = Object.keys(targetTable.admissibleCoverageTargetsByRequirement).sort();
  if (actualTokens.length !== expectedTokens.length || actualTokens.some((token, index) => token !== [...expectedTokens].sort()[index]))
    throw new StagedPlanningAdmissionError("PLANNING_COVERAGE_INVALID", "admissibleCoverageTargetsByRequirement", "PLANNING_COVERAGE_TARGET_SET_INVALID");
  const expectedBinding = {
    ...targetTable.binding,
    projectId: table.projectId,
    projectVersion: table.projectVersion,
    approvedBriefChecksum: table.approvedBriefChecksum,
    referenceTableChecksum: table.referenceTableChecksum,
    planningElementsChecksum: checksumPersistedDocument(input.elements),
    graphChecksum: checksumPersistedDocument(graph),
    operationChecksum: table.operationChecksum,
  };
  if (checksumPersistedDocument(targetTable.binding) !== checksumPersistedDocument(expectedBinding))
    throw new StagedPlanningAdmissionError("PLANNING_COVERAGE_INVALID", "admissibleCoverageTargetsByRequirement", "PLANNING_COVERAGE_TARGETS_NOT_CURRENT");
  return targetTable;
}

export function assertAdmissibleCoverageTargetTableCurrent(input: {
  targetTable: PlannerCoverageTargetTable;
  table: PlannerReferenceTable;
  elements: readonly PlanningElement[];
  graph: PlanningElementGraph;
  binding: PlannerCoverageTargetBinding;
}) {
  const expected = createAdmissibleCoverageTargetTable({
    table: input.table,
    elements: input.elements,
    graph: input.graph,
    binding: input.binding,
  });
  if (checksumPersistedDocument(input.targetTable) !== checksumPersistedDocument(expected))
    throw new StagedPlanningAdmissionError("PLANNING_COVERAGE_INVALID", "admissibleCoverageTargetsByRequirement", "PLANNING_COVERAGE_TARGETS_NOT_CURRENT");
  return expected;
}

export function assertAdmissibleCoverageTargetCounts(input: {
  table: PlannerReferenceTable;
  targetTable: PlannerCoverageTargetTable;
}) {
  const table = PlannerReferenceTableSchema.parse(input.table);
  for (const requirement of table.requirements.filter((entry) => entry.mandatory)) {
    const targetCount = input.targetTable.admissibleCoverageTargetsByRequirement[requirement.token]?.length ?? 0;
    if (targetCount < requirement.coverageConstraints.minimumCoverageTargets) {
      const diagnostics = PlannerCoverageDiagnosticsSchema.parse({
        requirementToken: requirement.token,
        requirementCategory: requirement.category,
        allowedDomains: requirement.coverageConstraints.allowedDomains,
        allowedKinds: requirement.coverageConstraints.allowedElementKinds,
        requiredPageTokens: requirement.coverageConstraints.requiredPageTokens,
        allowedPageTokens: requirement.coverageConstraints.allowedPageTokens,
        requiredRouteTokens: requirement.coverageConstraints.requiredRouteTokens,
        allowedRouteTokens: requirement.coverageConstraints.allowedRouteTokens,
        admissibleTargetCount: targetCount,
        minimumCoverageTargets: requirement.coverageConstraints.minimumCoverageTargets,
        reasonCode: "PLANNING_COVERAGE_NO_ADMISSIBLE_TARGETS",
      });
      throw new StagedPlanningAdmissionError(
        "PLANNING_COVERAGE_INVALID",
        `admissibleCoverageTargetsByRequirement.${requirement.token}`,
        "PLANNING_COVERAGE_NO_ADMISSIBLE_TARGETS",
        requirement.token,
        undefined,
        undefined,
        diagnostics,
      );
    }
  }
  return input.targetTable;
}

function stagedDecisionId(requirementId: string, token: string) {
  const digest = createHash("sha256").update(`staged-coverage:${token}:${requirementId}`).digest("hex");
  const bytes = Buffer.from(digest.slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  return `${bytes.toString("hex").slice(0, 8)}-${bytes.toString("hex").slice(8, 12)}-${bytes.toString("hex").slice(12, 16)}-${bytes.toString("hex").slice(16, 20)}-${bytes.toString("hex").slice(20)}`;
}

function materializeStagedCoverage(candidate: PlanningPackage, coverage: PlanningCoverageProviderOutput, table: PlannerReferenceTable): PlanningPackage {
  const requirements = new Map(table.requirements.map((entry) => [entry.token, entry]));
  const positiveEvidence: string[] = [];
  const negativeEvidence: string[] = [];
  const stagedTraceability = (Object.entries(coverage.coverageByRequirement) as Array<[string, { semanticEvidence: string; planningElementIds: readonly string[] }]>).map(([token, entry]) => {
    const requirement = requirements.get(token)!;
    const target = requirement.coverageConstraints.positiveRequirement ? positiveEvidence : negativeEvidence;
    target.push(entry.semanticEvidence);
    return {
      decisionId: stagedDecisionId(requirement.canonicalRequirementId, token),
      category: "staged-coverage",
      requirementReferences: [requirement.canonicalRequirementId],
      systemConstraintReferences: [`PLANNER_STAGED_COVERAGE:${token}`],
      rationale: entry.semanticEvidence,
      confidence: "high" as const,
      userConfirmationRequired: false,
    };
  });
  return {
    ...candidate,
    productScope: {
      ...candidate.productScope,
      inScopeCapabilities: [...candidate.productScope.inScopeCapabilities, ...positiveEvidence],
      outOfScopeCapabilities: [...candidate.productScope.outOfScopeCapabilities, ...negativeEvidence],
    },
    traceability: [...candidate.traceability, ...stagedTraceability],
  };
}

/**
 * Stage 3 admits only exact mandatory REQ keys and host-issued PE tokens. The
 * v5 semantic validator remains the sole typed coverage authority.
 */
export function admitPlanningCoverage(input: {
  output: unknown;
  table: PlannerReferenceTable;
  elements: readonly PlanningElement[];
  admissibleCoverageTargetsByRequirement?: AdmissibleCoverageTargetsByRequirement;
}): PlanningCoverageProviderOutput {
  const table = PlannerReferenceTableSchema.parse(input.table);
  const admissibleCoverageTargetsByRequirement = input.admissibleCoverageTargetsByRequirement ?? deriveAdmissibleCoverageTargets(table, input.elements);
  const rawCoverage = input.output && typeof input.output === "object" && !Array.isArray(input.output)
    ? (input.output as Record<string, unknown>).coverageByRequirement
    : undefined;
  if (rawCoverage && typeof rawCoverage === "object" && !Array.isArray(rawCoverage)) {
    const required = table.requirements.filter((entry) => entry.mandatory).map((entry) => entry.token);
    const requiredSet = new Set(required);
    for (const token of Object.keys(rawCoverage))
      if (!requiredSet.has(token)) throw new PlannerReferenceBindingError("PLANNING_TRACEABILITY_UNKNOWN_REFERENCE", `coverageByRequirement.${token}`, undefined, token);
    for (const token of required)
      if (!Object.prototype.hasOwnProperty.call(rawCoverage, token)) throw new PlannerReferenceBindingError("PLANNING_REQUIREMENT_COVERAGE_MISSING", token, "PLANNING_COVERAGE_REQUIREMENT_MISSING");
  }
  const schema = createPlanningCoverageProviderOutputSchema(table);
  let parsed: PlanningCoverageProviderOutput;
  try {
    parsed = schema.parse(input.output);
  } catch {
    throw new StagedPlanningAdmissionError("PLANNING_COVERAGE_INVALID", "coverageByRequirement", "PLANNING_COVERAGE_SCHEMA_INVALID");
  }
  const index = new Map(input.elements.map((element) => [element.elementId, descriptorFor(element)]));
  try {
    validatePlannerRequirementCoverage(parsed.coverageByRequirement, table, {}, index);
  } catch (error) {
    if (error instanceof PlannerReferenceBindingError) throw error;
    throw error;
  }
  for (const [token, entry] of Object.entries(parsed.coverageByRequirement)) {
    const requirement = table.requirements.find((candidate) => candidate.token === token)!;
    const admissibleTargets = new Set(admissibleCoverageTargetsByRequirement[token] ?? []);
    const nonAdmissibleTarget = entry.planningElementIds.find((elementId) => !admissibleTargets.has(elementId));
    if (nonAdmissibleTarget) {
      const descriptor = index.get(nonAdmissibleTarget);
      const diagnostics = PlannerCoverageDiagnosticsSchema.parse({
        requirementToken: requirement.token,
        requirementCategory: requirement.category,
        planningElementToken: nonAdmissibleTarget,
        ...(descriptor?.domains[0] ? { actualDomain: descriptor.domains[0] } : {}),
        ...(descriptor?.kind ? { actualKind: descriptor.kind } : {}),
        allowedDomains: requirement.coverageConstraints.allowedDomains,
        allowedKinds: requirement.coverageConstraints.allowedElementKinds,
        requiredPageTokens: requirement.coverageConstraints.requiredPageTokens,
        allowedPageTokens: requirement.coverageConstraints.allowedPageTokens,
        requiredRouteTokens: requirement.coverageConstraints.requiredRouteTokens,
        allowedRouteTokens: requirement.coverageConstraints.allowedRouteTokens,
        admissibleTargetCount: admissibleTargets.size,
        minimumCoverageTargets: requirement.coverageConstraints.minimumCoverageTargets,
        reasonCode: "PLANNING_COVERAGE_TARGET_NOT_ADMISSIBLE",
      });
      throw new PlannerReferenceBindingError(
        "PLANNING_REQUIREMENT_COVERAGE_INVALID",
        `coverageByRequirement.${token}.planningElementIds`,
        "PLANNING_COVERAGE_TARGET_NOT_ADMISSIBLE",
        nonAdmissibleTarget,
        diagnostics,
      );
    }
  }
  return parsed;
}

/**
 * Host assembly deliberately happens after both stage admissions. The
 * deterministic package builder supplies the complete existing canonical
 * Planning shape; staged PE/REQ relationships remain operation-local and are
 * never persisted as provider-owned identity.
 */
export function assembleStagedPlanningCandidate(input: {
  plannerInput: PlannerAgentInput;
  brief: RequirementSpecification;
  canonicalBrief?: CanonicalBriefV3;
  plannerReferenceTable: PlannerReferenceTable;
  elements: readonly PlanningElement[];
  graph: PlanningElementGraph;
  coverage: PlanningCoverageProviderOutput;
  admissibleCoverageTargetsByRequirement?: AdmissibleCoverageTargetsByRequirement;
}): PlanningPackage {
  const positiveElementEvidence = input.elements.filter((element) => !element.negativeOnly).map((element) => `${element.elementId}: ${element.title} — ${element.description}`);
  const negativeElementEvidence = input.elements.filter((element) => element.negativeOnly).map((element) => `${element.elementId}: ${element.title} — ${element.description}`);
  const graphEvidence = input.graph.edges.map((edge) => `${edge.from} depends on ${edge.to}`);
  const base = buildPlanningPackage({ ...input.plannerInput, approvedBrief: input.brief, ...(input.canonicalBrief ? { canonicalBrief: input.canonicalBrief } : {}) });
  const candidate = {
    ...base,
    planningPipelineVersion: STAGED_PLANNER_PIPELINE_VERSION,
    productScope: {
      ...base.productScope,
      inScopeCapabilities: [
        ...base.productScope.inScopeCapabilities,
        ...positiveElementEvidence,
      ],
      outOfScopeCapabilities: [...base.productScope.outOfScopeCapabilities, ...negativeElementEvidence],
    },
  };
  candidate.architecture = {
    ...candidate.architecture,
    componentBoundaries: [...candidate.architecture.componentBoundaries, ...graphEvidence],
  };
  const admittedGraph = finalizePlanningElementGraph(input.elements);
  if (checksumPersistedDocument(admittedGraph) !== checksumPersistedDocument(input.graph))
    throw new StagedPlanningAdmissionError("PLANNING_GRAPH_INVALID", "graph", "PLANNING_GRAPH_NOT_CURRENT");
  const admittedCoverage = admitPlanningCoverage({ output: input.coverage, table: input.plannerReferenceTable, elements: input.elements, admissibleCoverageTargetsByRequirement: input.admissibleCoverageTargetsByRequirement });
  return PlanningPackageSchema.parse(materializeStagedCoverage(candidate, admittedCoverage, input.plannerReferenceTable));
}

export function stagedCoverageReferenceCount(output: PlanningCoverageProviderOutput) {
  return (Object.values(output.coverageByRequirement) as Array<{ planningElementIds: readonly string[] }>).reduce((count, entry) => count + entry.planningElementIds.length, 0);
}

export function stagedElementDescriptorIndex(elements: readonly PlanningElement[]) {
  return new Map(elements.map((element) => [element.elementId, descriptorFor(element)]));
}

export function stagedProviderContractMetrics(input: {
  monolithicInput: unknown;
  decompositionInput: unknown;
  coverageInput: unknown;
  table: PlannerReferenceTable;
}) {
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
  const monolithicBytes = bytes(input.monolithicInput);
  const decompositionBytes = bytes(input.decompositionInput);
  const coverageBytes = bytes(input.coverageInput);
  return {
    monolithic: { bytes: monolithicBytes, estimatedTokens: Math.ceil(monolithicBytes / 4) },
    decomposition: { bytes: decompositionBytes, estimatedTokens: Math.ceil(decompositionBytes / 4), referenceBytes: bytes({ pages: input.table.pages, routes: input.table.routes }) },
    coverage: { bytes: coverageBytes, estimatedTokens: Math.ceil(coverageBytes / 4), referenceBytes: bytes({ requirements: input.table.requirements.filter((entry) => entry.mandatory) }) },
    largestStage: Math.max(decompositionBytes, coverageBytes) === decompositionBytes ? "decomposition" as const : "coverage" as const,
  };
}
