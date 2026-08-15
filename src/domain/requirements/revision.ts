import { createHash } from "node:crypto";
import { z } from "zod";
import type { RequirementSpecification } from "./schema";
import {
  getEffectiveBriefRequirements,
  isSimulationProhibitionRequirement,
  normalizeRequirementText,
  requirementDimensionForText,
  type RequirementDimension,
} from "./effective";

export const BriefRevisionOperationKindSchema = z.enum(["ADD", "UPDATE", "REPLACE", "REMOVE", "PRESERVE"]);
export type BriefRevisionOperationKind = z.infer<typeof BriefRevisionOperationKindSchema>;
export const BriefRevisionOperationSchema = z.object({
  kind: BriefRevisionOperationKindSchema,
  field: z.string().min(1).max(160),
  target: z.string().min(1).max(400).optional(),
  value: z.string().min(1).max(400).optional(),
}).strict();
export type BriefRevisionOperation = z.infer<typeof BriefRevisionOperationSchema>;

export type BriefRevisionIntent = { operations: BriefRevisionOperation[]; preserveUnmentioned: boolean };
export type BriefRevisionDiagnostics = {
  revisionOperationTypes: BriefRevisionOperationKind[];
  removeTargetResolved: boolean;
  candidateHasOldProhibition: boolean;
  candidateHasSimulatedSuccess: boolean;
  historicalHasOldProhibition: boolean;
  effectiveHasOldProhibition: boolean;
  contradictionAuthority: "CURRENT_EFFECTIVE";
};

export const BRIEF_REVISION_TRACE_STAGES = ["LEGACY_INPUT", "PROVIDER_CANDIDATE", "REVISION_OPERATIONS", "POST_REVISION_APPLICATION", "POST_PRESERVATION", "EFFECTIVE_SELECTION", "CONTRADICTION_INPUT"] as const;
export type BriefRevisionTraceStage = typeof BRIEF_REVISION_TRACE_STAGES[number];
export type BriefRevisionTraceSnapshot = {
  stage: BriefRevisionTraceStage;
  briefSchemaVersion: 1 | 2 | null;
  briefVersion: number;
  requirementCount: number;
  explicitExclusionCount: number;
  prohibitedRequirementCount: number;
  historyCount: number;
  hasSuccessSimulationRequired: boolean;
  hasSuccessSimulationProhibited: boolean;
  hasNoTransmission: boolean;
  hasEmailTransmissionRequired: boolean;
  hasDatabasePersistenceRequired: boolean;
  hasExternalProviderRequired: boolean;
  historyHasSuccessSimulationProhibited: boolean;
  effectiveHasSuccessSimulationProhibited: boolean;
  providerCandidateHasSuccessSimulationProhibited: boolean;
  postRevisionHasSuccessSimulationProhibited: boolean;
  postPreservationHasSuccessSimulationProhibited: boolean;
  removeOperationPresent: boolean;
  removeTargetResolved: boolean;
  removeVerificationPassed: boolean;
  replaceOperationPresent: boolean;
  preserveOperationPresent: boolean;
  contradictionCount: number;
  operationTypes: BriefRevisionOperationKind[];
};
export type BriefRevisionTraceSink = (snapshot: BriefRevisionTraceSnapshot) => void;
export type ResolvedBriefRevisionOperation = { operation: BriefRevisionOperation; targets: string[]; dimension: RequirementDimension };
export type BriefRevisionDelta = {
  operations: ResolvedBriefRevisionOperation[];
  removedTargets: Set<string>;
  removedDimensions: Set<RequirementDimension>;
  replacedDimensions: Set<RequirementDimension>;
  updatedDimensions: Set<RequirementDimension>;
  addedDimensions: Set<RequirementDimension>;
  preservedDimensions: Set<RequirementDimension>;
};

export class BriefRevisionSemanticsError extends Error {
  name = "BriefRevisionSemanticsError";
  constructor(readonly issueCode: "BRIEF_REVISION_REMOVE_NOT_APPLIED" | "BRIEF_REVISION_REPLACE_NOT_APPLIED" | "BRIEF_REVISION_TARGET_NOT_FOUND") { super(issueCode); }
}

const normalize = normalizeRequirementText;
const quoted = /[\u201e\u201c\u201d"]([^\u201e\u201c\u201d"]{1,400})[\u201e\u201c\u201d"]/g;
const quoteValues = (text: string) => [...text.matchAll(quoted)].map((match) => match[1]!.trim()).filter(Boolean);
const unique = <T>(values: T[]) => values.filter((value, index) => values.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(value)) === index);
const instructionChecksum = (instruction: string) => createHash("sha256").update(instruction).digest("hex");

export function extractBriefRevisionIntent(instruction: string): BriefRevisionIntent {
  const preserveUnmentioned = /(?:all|alle|\u00fcbrig|uebrig|rest|remain|beibehalten|unver\u00e4ndert|unveraendert|preserve|unchanged|confirmed requirements)/i.test(instruction);
  const operations: BriefRevisionOperation[] = [];
  const quotedValues = quoteValues(instruction);
  const removePattern = /(?:remove|delete|drop|entfern(?:e|en|t)?|l\u00f6schen|loeschen|streichen|nicht mehr enthalten|aus .* entfernen)/i;
  if (removePattern.test(instruction)) {
    const target = quotedValues[0] ?? (requirementDimensionForText(instruction) === "FORM_SUCCESS_SIMULATION" ? "FORM_SUCCESS_SIMULATION" : undefined);
    if (target) operations.push({ kind: "REMOVE", field: "effective-requirements", target });
  }
  const replacePattern = /(?:replace|ersetze|ersetzen|ersetzen durch|replace .* with)/i;
  if (replacePattern.test(instruction) && quotedValues.length >= 2) operations.push({ kind: "REPLACE", field: "effective-requirements", target: quotedValues[0], value: quotedValues[1] });
  if (/(?:add|include|erg\u00e4nz|ergaenz|hinzuf\u00fcgen|hinzufuegen|aufnehmen|festhalten|keep|beibehalten)/i.test(instruction)) operations.push({ kind: "ADD", field: "structured-brief" });
  if (/(?:update|\u00e4ndern|aendern|korrig|correct|change|aktual)/i.test(instruction)) operations.push({ kind: "UPDATE", field: "structured-brief" });
  const explicitPreserve = instruction.match(/(?:preserve|keep|beibehalten|behalten|erhalten|bewahren)\s*[\u201e\u201c\u201d"]([^\u201e\u201c\u201d"]{1,400})[\u201e\u201c\u201d"]/i);
  if (explicitPreserve?.[1]) operations.push({ kind: "PRESERVE", field: "effective-requirements", target: explicitPreserve[1].trim() });
  if (preserveUnmentioned) operations.push({ kind: "PRESERVE", field: "unmentioned-requirements" });
  return { operations, preserveUnmentioned };
}

type LocatedRequirement = { path: string; value: string; id?: string; sourceRefs?: string[] };
const located = (value: unknown, path = ""): LocatedRequirement[] => {
  if (typeof value === "string") return value.trim() ? [{ path, value }] : [];
  if (Array.isArray(value)) return value.flatMap((entry, index) => located(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (typeof record.statement === "string") return [{ path: `${path}.statement`, value: record.statement, id: typeof record.id === "string" ? record.id : undefined, sourceRefs: Array.isArray(record.sourceRefs) ? record.sourceRefs.filter((ref): ref is string => typeof ref === "string") : undefined }];
  return Object.entries(record).flatMap(([key, entry]) => located(entry, path ? `${path}.${key}` : key));
};
const requirementFields = (brief: RequirementSpecification) => ({
  businessGoals: brief.businessGoals, targetAudiences: brief.targetAudiences, pages: brief.pages, features: brief.features, forms: brief.forms,
  contentRequirements: brief.contentRequirements, backendRequirements: brief.backendRequirements, supabaseRequirements: brief.supabaseRequirements,
  seoRequirements: brief.seoRequirements, technicalConstraints: brief.technicalConstraints, explicitExclusions: brief.explicitExclusions,
  userAcceptanceCriteria: brief.userAcceptanceCriteria, contactFacts: brief.contactFacts, legalFacts: brief.legalFacts, brandFacts: brief.brandFacts,
  logoMetadata: brief.logoMetadata, imageSourcingNotes: brief.imageSourcingNotes, content: brief.content, technical: brief.technical,
  brandVisualRequirements: brief.brandVisualRequirements, assetRequirements: brief.assetRequirements, formBehaviorRequirements: brief.formBehaviorRequirements,
  uxResponsiveRequirements: brief.uxResponsiveRequirements, seoMetadata: brief.seoMetadata, legalComplianceConstraints: brief.legalComplianceConstraints,
  prohibitedRequirements: brief.prohibitedRequirements, deferredIntegrations: brief.deferredIntegrations, decisions: brief.decisions,
});
const locatedRequirements = (brief: RequirementSpecification) => located(requirementFields(brief));
const prohibitionStatements = (brief: RequirementSpecification) => [...brief.explicitExclusions, ...(brief.prohibitedRequirements ?? []).map((entry) => entry.statement)];

export function flattenBriefRequirements(brief: RequirementSpecification) { return locatedRequirements(getEffectiveBriefRequirements(brief)); }

const removeTarget = (value: unknown, target: string): unknown => {
  if (typeof value === "string") return normalize(value) === normalize(target) ? undefined : value;
  if (Array.isArray(value)) return value.flatMap((entry) => { const next = removeTarget(entry, target); return next === undefined ? [] : [next]; });
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.statement === "string" && normalize(record.statement) === normalize(target)) return undefined;
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, removeTarget(entry, target)]).filter(([, entry]) => entry !== undefined));
};

const addMissingPreserved = (candidate: Record<string, unknown>, existing: RequirementSpecification, removed: Set<string>, delta: BriefRevisionDelta) => {
  const shouldPreserve = (value: string) => {
    const dimension = requirementDimensionForText(value);
    return !removed.has(normalize(value)) && !delta.removedDimensions.has(dimension) && !delta.replacedDimensions.has(dimension);
  };
  const fields = ["businessGoals", "targetAudiences", "userRoles", "features", "forms", "contentRequirements", "backendRequirements", "supabaseRequirements", "seoRequirements", "technicalConstraints", "explicitExclusions", "userAcceptanceCriteria", "contactFacts", "legalFacts", "brandFacts", "logoMetadata", "imageSourcingNotes"] as const;
  for (const field of fields) {
    const source = existing[field];
    const current = Array.isArray(candidate[field]) ? candidate[field] as unknown[] : [];
    const currentStrings = new Set(current.filter((item): item is string => typeof item === "string").map(normalize));
    candidate[field] = [...current, ...source.filter((item) => shouldPreserve(item) && !currentStrings.has(normalize(item)))];
  }
  const structuredFields = ["content", "technical", "prohibitedRequirements", "deferredIntegrations", "decisions"] as const;
  for (const field of structuredFields) {
    const source = existing[field] ?? [];
    const current = Array.isArray(candidate[field]) ? candidate[field] as unknown[] : [];
    const currentKeys = new Set(current.map((item) => typeof item === "object" && item !== null && "statement" in item ? normalize(String((item as { statement: unknown }).statement)) : JSON.stringify(item)));
    const preserved = source.filter((item) => {
      const statement = typeof item === "object" && item !== null && "statement" in item ? String((item as { statement: unknown }).statement) : JSON.stringify(item);
      return shouldPreserve(statement) && !currentKeys.has(normalize(statement));
    });
    candidate[field] = [...current, ...preserved];
  }
};

const dimensionForOperation = (operation: BriefRevisionOperation): RequirementDimension => operation.target ? requirementDimensionForText(operation.target) : "GENERIC";
const resolveTargetValues = (existing: RequirementSpecification, candidate: RequirementSpecification, operation: BriefRevisionOperation) => {
  if (!operation.target) return [];
  const target = normalize(operation.target);
  const sources = [...locatedRequirements(getEffectiveBriefRequirements(existing)), ...locatedRequirements(getEffectiveBriefRequirements(candidate))];
  const exact = sources.filter((item) => normalize(item.value) === target).map((item) => item.value);
  if (exact.length) return unique(exact);
  const dimension = dimensionForOperation(operation);
  if (dimension === "GENERIC") return [];
  return unique(prohibitionStatements(existing).concat(prohibitionStatements(candidate)).filter((value) => requirementDimensionForText(value) === dimension));
};
const mergeOperations = (intent: BriefRevisionIntent, providerOperations: BriefRevisionOperation[]) => unique([...intent.operations, ...providerOperations]);
export const resolveBriefRevisionOperations = (existing: RequirementSpecification, candidate: RequirementSpecification, intent: BriefRevisionIntent, providerOperations: BriefRevisionOperation[] = []): ResolvedBriefRevisionOperation[] => mergeOperations(intent, providerOperations).map((operation) => ({ operation, targets: resolveTargetValues(existing, candidate, operation), dimension: dimensionForOperation(operation) }));
const briefRevisionDelta = (operations: ResolvedBriefRevisionOperation[]): BriefRevisionDelta => ({
  operations,
  removedTargets: new Set(operations.filter(({ operation }) => operation.kind === "REMOVE" || operation.kind === "REPLACE").flatMap(({ operation, targets }) => targets.length ? targets : operation.target ? [operation.target] : []).map(normalize)),
  removedDimensions: new Set(operations.filter(({ operation }) => operation.kind === "REMOVE").map(({ dimension }) => dimension)),
  replacedDimensions: new Set(operations.filter(({ operation }) => operation.kind === "REPLACE").map(({ dimension }) => dimension)),
  updatedDimensions: new Set(operations.filter(({ operation }) => operation.kind === "UPDATE").map(({ dimension }) => dimension)),
  addedDimensions: new Set(operations.filter(({ operation }) => operation.kind === "ADD").map(({ dimension }) => dimension)),
  preservedDimensions: new Set(operations.filter(({ operation }) => operation.kind === "PRESERVE").map(({ dimension }) => dimension)),
});
const candidateContainsTarget = (candidate: RequirementSpecification, targets: string[]) => {
  const values = locatedRequirements(getEffectiveBriefRequirements(candidate)).map((item) => normalize(item.value));
  return targets.some((target) => values.includes(normalize(target)));
};
export function validateProviderRevisionOperations(existing: RequirementSpecification, candidate: RequirementSpecification, operations: BriefRevisionOperation[]) {
  const resolved = resolveBriefRevisionOperations(existing, candidate, { operations, preserveUnmentioned: false });
  for (const { operation, targets } of resolved) {
    if (!operation.target) continue;
    if ((operation.kind === "REMOVE" || operation.kind === "REPLACE") && !targets.length) throw new BriefRevisionSemanticsError("BRIEF_REVISION_TARGET_NOT_FOUND");
    if (operation.kind === "REMOVE" && candidateContainsTarget(candidate, targets)) throw new BriefRevisionSemanticsError("BRIEF_REVISION_REMOVE_NOT_APPLIED");
    if (operation.kind === "REPLACE" && candidateContainsTarget(candidate, targets)) throw new BriefRevisionSemanticsError("BRIEF_REVISION_REPLACE_NOT_APPLIED");
  }
}

export function createBriefRevisionTraceSnapshot(stage: BriefRevisionTraceStage, brief: RequirementSpecification, metadata: Partial<BriefRevisionTraceSnapshot> = {}): BriefRevisionTraceSnapshot {
  const effective = getEffectiveBriefRequirements(brief);
  const prohibited = prohibitionStatements(brief);
  const effectiveProhibited = prohibitionStatements(effective);
  const form = brief.formBehaviorRequirements;
  const operationTypes = metadata.operationTypes ?? [];
  return {
    stage, briefSchemaVersion: brief.briefSchemaVersion ?? null, briefVersion: brief.briefVersion,
    requirementCount: locatedRequirements(effective).length, explicitExclusionCount: brief.explicitExclusions.length,
    prohibitedRequirementCount: brief.prohibitedRequirements?.length ?? 0, historyCount: brief.requirementHistory?.length ?? 0,
    hasSuccessSimulationRequired: form?.successUx === "SIMULATED", hasSuccessSimulationProhibited: prohibited.some(isSimulationProhibitionRequirement),
    hasNoTransmission: form?.dataTransmission === "NONE", hasEmailTransmissionRequired: form?.dataTransmission === "EMAIL" || brief.emailDecision === "needed",
    hasDatabasePersistenceRequired: form?.persistence === "DATABASE" || brief.storageDecision === "needed", hasExternalProviderRequired: form?.thirdParty === "APPROVED_PROVIDER",
    historyHasSuccessSimulationProhibited: (brief.requirementHistory ?? []).some((entry) => isSimulationProhibitionRequirement(entry.statement)),
    effectiveHasSuccessSimulationProhibited: effectiveProhibited.some(isSimulationProhibitionRequirement),
    providerCandidateHasSuccessSimulationProhibited: stage === "PROVIDER_CANDIDATE" && prohibited.some(isSimulationProhibitionRequirement),
    postRevisionHasSuccessSimulationProhibited: stage === "POST_REVISION_APPLICATION" && prohibited.some(isSimulationProhibitionRequirement),
    postPreservationHasSuccessSimulationProhibited: stage === "POST_PRESERVATION" && prohibited.some(isSimulationProhibitionRequirement),
    removeOperationPresent: metadata.removeOperationPresent ?? operationTypes.includes("REMOVE"), removeTargetResolved: metadata.removeTargetResolved ?? true,
    removeVerificationPassed: metadata.removeVerificationPassed ?? true, replaceOperationPresent: metadata.replaceOperationPresent ?? operationTypes.includes("REPLACE"),
    preserveOperationPresent: metadata.preserveOperationPresent ?? operationTypes.includes("PRESERVE"), contradictionCount: metadata.contradictionCount ?? 0, operationTypes,
  };
}
const emitTrace = (trace: BriefRevisionTraceSink | undefined, snapshot: BriefRevisionTraceSnapshot) => trace?.(snapshot);
const removeOperations = (operations: ResolvedBriefRevisionOperation[]) => operations.filter(({ operation }) => operation.kind === "REMOVE");
const operationTypes = (operations: ResolvedBriefRevisionOperation[]) => operations.map(({ operation }) => operation.kind);
const removeResolved = (operations: ResolvedBriefRevisionOperation[]) => removeOperations(operations).every(({ targets }) => targets.length > 0);
const removeVerified = (brief: RequirementSpecification, operations: ResolvedBriefRevisionOperation[]) => removeOperations(operations).every(({ targets }) => !targets.length || !candidateContainsTarget(brief, targets));

const historyFor = (existing: RequirementSpecification, candidate: RequirementSpecification, operations: ResolvedBriefRevisionOperation[], revisionReference: string) => {
  const prior = existing.requirementHistory ?? [];
  const entries = operations.filter(({ operation }) => operation.kind === "REMOVE" || operation.kind === "REPLACE" || operation.kind === "UPDATE").flatMap(({ operation, targets }) => {
    const source = [...locatedRequirements(getEffectiveBriefRequirements(existing)), ...locatedRequirements(getEffectiveBriefRequirements(candidate))];
    return targets.flatMap((target) => source.filter((item) => normalize(item.value) === normalize(target)).map((item) => ({
      id: item.id ?? `legacy:${createHash("sha256").update(item.value).digest("hex").slice(0, 24)}`, statement: item.value, sourceRefs: item.sourceRefs?.length ? item.sourceRefs : ["requirements:current"],
      status: operation.kind === "REMOVE" ? "REMOVED" as const : "SUPERSEDED" as const, operation: operation.kind === "UPDATE" ? "UPDATE" as const : operation.kind,
      revisionReference, ...(operation.value ? { supersededBy: operation.value } : {}),
    })));
  });
  return unique([...prior, ...entries]);
};

export function applyBriefRevisionSemantics(existing: RequirementSpecification, candidate: RequirementSpecification, instruction: string) { return applyBriefRevisionSemanticsWithOptions(existing, candidate, instruction); }
export function applyBriefRevisionSemanticsWithOptions(existing: RequirementSpecification, candidate: RequirementSpecification, instruction: string, options: { providerOperations?: BriefRevisionOperation[]; trace?: BriefRevisionTraceSink } = {}) {
  const intent = extractBriefRevisionIntent(instruction);
  const operations = resolveBriefRevisionOperations(existing, candidate, intent, options.providerOperations ?? []);
  const delta = briefRevisionDelta(operations);
  const types = operationTypes(operations);
  emitTrace(options.trace, createBriefRevisionTraceSnapshot("LEGACY_INPUT", existing, { operationTypes: types }));
  emitTrace(options.trace, createBriefRevisionTraceSnapshot("PROVIDER_CANDIDATE", candidate, { operationTypes: types, removeTargetResolved: removeResolved(operations) }));
  try { validateProviderRevisionOperations(existing, candidate, options.providerOperations ?? []); } catch (error) {
    emitTrace(options.trace, createBriefRevisionTraceSnapshot("REVISION_OPERATIONS", candidate, { operationTypes: types, removeTargetResolved: removeResolved(operations), removeVerificationPassed: false }));
    throw error;
  }
  emitTrace(options.trace, createBriefRevisionTraceSnapshot("REVISION_OPERATIONS", candidate, { operationTypes: types, removeTargetResolved: removeResolved(operations) }));
  let next: Record<string, unknown> = structuredClone(candidate) as Record<string, unknown>;
  for (const { operation, targets } of operations.filter(({ operation }) => operation.kind === "REMOVE" || operation.kind === "REPLACE")) for (const target of targets.length ? targets : operation.target ? [operation.target] : []) next = removeTarget(next, target) as Record<string, unknown>;
  emitTrace(options.trace, createBriefRevisionTraceSnapshot("POST_REVISION_APPLICATION", next as RequirementSpecification, { operationTypes: types, removeTargetResolved: removeResolved(operations), removeVerificationPassed: removeVerified(next as RequirementSpecification, operations) }));
  if (intent.preserveUnmentioned || operations.some(({ operation }) => operation.kind === "PRESERVE")) addMissingPreserved(next, getEffectiveBriefRequirements(existing), delta.removedTargets, delta);
  emitTrace(options.trace, createBriefRevisionTraceSnapshot("POST_PRESERVATION", next as RequirementSpecification, { operationTypes: types, removeTargetResolved: removeResolved(operations), removeVerificationPassed: removeVerified(next as RequirementSpecification, operations) }));
  const history = historyFor(existing, candidate, operations, instructionChecksum(instruction));
  if (history.length) next.requirementHistory = history;
  const effective = getEffectiveBriefRequirements(next as RequirementSpecification);
  emitTrace(options.trace, createBriefRevisionTraceSnapshot("EFFECTIVE_SELECTION", next as RequirementSpecification, { operationTypes: types, removeTargetResolved: removeResolved(operations), removeVerificationPassed: removeVerified(effective, operations) }));
  const diagnostics: BriefRevisionDiagnostics = {
    revisionOperationTypes: types, removeTargetResolved: removeResolved(operations), candidateHasOldProhibition: prohibitionStatements(candidate).some(isSimulationProhibitionRequirement),
    candidateHasSimulatedSuccess: candidate.formBehaviorRequirements?.successUx === "SIMULATED", historicalHasOldProhibition: (existing.requirementHistory ?? []).some((entry) => isSimulationProhibitionRequirement(entry.statement)),
    effectiveHasOldProhibition: prohibitionStatements(effective).some(isSimulationProhibitionRequirement), contradictionAuthority: "CURRENT_EFFECTIVE",
  };
  return { brief: next as RequirementSpecification, intent, diagnostics, delta };
}

export function validateBriefRevisionSemantics(existing: RequirementSpecification, candidate: RequirementSpecification, instruction: string, providerOperations: BriefRevisionOperation[] = []) {
  const intent = extractBriefRevisionIntent(instruction);
  const operations = resolveBriefRevisionOperations(existing, candidate, intent, providerOperations);
  const currentBrief = getEffectiveBriefRequirements(candidate);
  const current = flattenBriefRequirements(currentBrief).map((item) => normalize(item.value));
  const existingValues = new Set(flattenBriefRequirements(existing).map((item) => normalize(item.value)));
  const issues: string[] = [];
  const removedTargets = new Set<string>();
  for (const { operation, targets, dimension } of operations) {
    if (operation.kind === "PRESERVE" && operation.target) {
      const conflicting = operations.some((other) => (other.operation.kind === "REMOVE" || other.operation.kind === "REPLACE") && (other.dimension === dimension || other.targets.some((target) => targets.includes(target))));
      if (conflicting) issues.push("REVISION_OPERATION_CONFLICT"); else if (!targets.some((target) => current.includes(normalize(target)))) issues.push("REVISION_PRESERVE_NOT_APPLIED");
    }
    if ((operation.kind === "REMOVE" || operation.kind === "REPLACE") && operation.target) {
      if (!targets.length && providerOperations.some((providerOperation) => JSON.stringify(providerOperation) === JSON.stringify(operation))) issues.push("BRIEF_REVISION_TARGET_NOT_FOUND");
      for (const target of targets.length ? targets : [operation.target]) { removedTargets.add(normalize(target)); if (current.includes(normalize(target))) issues.push(operation.kind === "REMOVE" ? "BRIEF_REVISION_REMOVE_NOT_APPLIED" : "BRIEF_REVISION_REPLACE_NOT_APPLIED"); }
    }
    if (operation.kind === "REPLACE" && operation.value) {
      const replacementApplied = current.includes(normalize(operation.value)) || (dimension === "FORM_SUCCESS_SIMULATION" && currentBrief.formBehaviorRequirements?.successUx === "SIMULATED");
      if (!replacementApplied) issues.push("REVISION_REPLACEMENT_MISSING");
    }
  }
  if (intent.preserveUnmentioned) for (const value of existingValues) if (!removedTargets.has(value) && !current.includes(value)) issues.push("REVISION_PRESERVE_NOT_APPLIED");
  return [...new Set(issues)];
}
