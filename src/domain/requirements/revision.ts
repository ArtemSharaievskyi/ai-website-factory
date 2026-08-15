import { z } from "zod";
import type { RequirementSpecification } from "./schema";

export const BriefRevisionOperationKindSchema = z.enum(["ADD", "UPDATE", "REPLACE", "REMOVE", "PRESERVE"]);
export type BriefRevisionOperationKind = z.infer<typeof BriefRevisionOperationKindSchema>;
export const BriefRevisionOperationSchema = z.object({
  kind: BriefRevisionOperationKindSchema,
  field: z.string().min(1).max(160),
  target: z.string().min(1).max(400).optional(),
  value: z.string().min(1).max(400).optional(),
}).strict();
export type BriefRevisionOperation = z.infer<typeof BriefRevisionOperationSchema>;

export type BriefRevisionIntent = {
  operations: BriefRevisionOperation[];
  preserveUnmentioned: boolean;
};

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\s._-]+/g, " ").trim();
const quoted = /[„“”"]([^„“”"]{1,400})[„“”"]/g;
const quoteValues = (text: string) => [...text.matchAll(quoted)].map((match) => match[1]!.trim()).filter(Boolean);

export function extractBriefRevisionIntent(instruction: string): BriefRevisionIntent {
  const preserveUnmentioned = /(?:all|alle|übrig|uebrig|rest|remain|beibehalten|unverändert|unveraendert|preserve|unchanged|confirmed requirements)/i.test(instruction);
  const operations: BriefRevisionOperation[] = [];
  const quotedValues = quoteValues(instruction);
  const removePattern = /(?:remove|delete|drop|entfern(?:e|en|t)?|löschen|loeschen|streichen|nicht mehr enthalten|aus .* entfernen)/i;
  if (removePattern.test(instruction)) {
    const target = quotedValues[0];
    if (target) operations.push({ kind: "REMOVE", field: "effective-requirements", target });
  }
  const replacePattern = /(?:replace|ersetze|ersetzen|ersetzen durch|replace .* with)/i;
  if (replacePattern.test(instruction) && quotedValues.length >= 2) {
    operations.push({ kind: "REPLACE", field: "effective-requirements", target: quotedValues[0], value: quotedValues[1] });
  }
  if (/(?:add|include|ergänz|ergaenz|hinzufügen|hinzufuegen|aufnehmen|festhalten|keep|beibehalten)/i.test(instruction)) operations.push({ kind: "ADD", field: "structured-brief" });
  if (/(?:update|ändern|aendern|korrig|correct|change|aktual)/i.test(instruction)) operations.push({ kind: "UPDATE", field: "structured-brief" });
  if (preserveUnmentioned) operations.push({ kind: "PRESERVE", field: "unmentioned-requirements" });
  return { operations, preserveUnmentioned };
}

type LocatedRequirement = { path: string; value: string };
const located = (value: unknown, path = ""): LocatedRequirement[] => {
  if (typeof value === "string") return value.trim() ? [{ path, value }] : [];
  if (Array.isArray(value)) return value.flatMap((entry, index) => located(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (typeof record.statement === "string") return [{ path: `${path}.statement`, value: record.statement }];
  return Object.entries(record).flatMap(([key, entry]) => located(entry, path ? `${path}.${key}` : key));
};

export function flattenBriefRequirements(brief: RequirementSpecification) {
  return located({
    businessGoals: brief.businessGoals,
    targetAudiences: brief.targetAudiences,
    pages: brief.pages,
    features: brief.features,
    forms: brief.forms,
    contentRequirements: brief.contentRequirements,
    backendRequirements: brief.backendRequirements,
    supabaseRequirements: brief.supabaseRequirements,
    seoRequirements: brief.seoRequirements,
    technicalConstraints: brief.technicalConstraints,
    explicitExclusions: brief.explicitExclusions,
    userAcceptanceCriteria: brief.userAcceptanceCriteria,
    contactFacts: brief.contactFacts,
    legalFacts: brief.legalFacts,
    brandFacts: brief.brandFacts,
    logoMetadata: brief.logoMetadata,
    imageSourcingNotes: brief.imageSourcingNotes,
    content: brief.content,
    technical: brief.technical,
    brandVisualRequirements: brief.brandVisualRequirements,
    assetRequirements: brief.assetRequirements,
    formBehaviorRequirements: brief.formBehaviorRequirements,
    uxResponsiveRequirements: brief.uxResponsiveRequirements,
    seoMetadata: brief.seoMetadata,
    legalComplianceConstraints: brief.legalComplianceConstraints,
    prohibitedRequirements: brief.prohibitedRequirements,
    deferredIntegrations: brief.deferredIntegrations,
    decisions: brief.decisions,
  });
}

const removeTarget = (value: unknown, target: string): unknown => {
  if (typeof value === "string") return normalize(value) === normalize(target) ? undefined : value;
  if (Array.isArray(value)) return value.flatMap((entry) => { const next = removeTarget(entry, target); return next === undefined ? [] : [next]; });
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.statement === "string" && normalize(record.statement) === normalize(target)) return undefined;
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, removeTarget(entry, target)]).filter(([, entry]) => entry !== undefined));
};

const addMissingPreserved = (candidate: Record<string, unknown>, existing: RequirementSpecification, removed: Set<string>) => {
  const fields = ["businessGoals", "targetAudiences", "userRoles", "features", "forms", "contentRequirements", "backendRequirements", "supabaseRequirements", "seoRequirements", "technicalConstraints", "explicitExclusions", "userAcceptanceCriteria", "contactFacts", "legalFacts", "brandFacts", "logoMetadata", "imageSourcingNotes"] as const;
  for (const field of fields) {
    const source = existing[field];
    const current = Array.isArray(candidate[field]) ? candidate[field] as unknown[] : [];
    const currentStrings = new Set(current.filter((item): item is string => typeof item === "string").map(normalize));
    candidate[field] = [...current, ...source.filter((item) => !removed.has(normalize(item)) && !currentStrings.has(normalize(item)))];
  }
  const structuredFields = ["content", "technical", "prohibitedRequirements", "deferredIntegrations", "decisions"] as const;
  for (const field of structuredFields) {
    const source = existing[field] ?? [];
    const current = Array.isArray(candidate[field]) ? candidate[field] as unknown[] : [];
    const currentKeys = new Set(current.map((item) => typeof item === "object" && item !== null && "statement" in item ? normalize(String((item as { statement: unknown }).statement)) : JSON.stringify(item)));
    const preserved = source.filter((item) => {
      const key = typeof item === "object" && item !== null && "statement" in item ? normalize(String((item as { statement: unknown }).statement)) : JSON.stringify(item);
      return !removed.has(key) && !currentKeys.has(key);
    });
    candidate[field] = [...current, ...preserved];
  }
};

/** Applies only explicit user semantics to a provider's complete replacement candidate. */
export function applyBriefRevisionSemantics(existing: RequirementSpecification, candidate: RequirementSpecification, instruction: string) {
  const intent = extractBriefRevisionIntent(instruction);
  let next: Record<string, unknown> = structuredClone(candidate) as Record<string, unknown>;
  const removed = new Set<string>();
  for (const operation of intent.operations.filter((item) => item.kind === "REMOVE" || item.kind === "REPLACE")) {
    if (operation.target) {
      removed.add(normalize(operation.target));
      next = removeTarget(next, operation.target) as Record<string, unknown>;
    }
  }
  if (intent.preserveUnmentioned) addMissingPreserved(next, existing, removed);
  return { brief: next as RequirementSpecification, intent };
}

export function validateBriefRevisionSemantics(existing: RequirementSpecification, candidate: RequirementSpecification, instruction: string) {
  const intent = extractBriefRevisionIntent(instruction);
  const current = flattenBriefRequirements(candidate).map((item) => normalize(item.value));
  const existingValues = new Set(flattenBriefRequirements(existing).map((item) => normalize(item.value)));
  const issues: string[] = [];
  for (const operation of intent.operations) {
    if (operation.kind === "REMOVE" && operation.target && current.includes(normalize(operation.target))) issues.push("REVISION_REMOVE_NOT_APPLIED");
    if (operation.kind === "REPLACE" && operation.target && current.includes(normalize(operation.target))) issues.push("REVISION_REPLACE_NOT_APPLIED");
    if (operation.kind === "REPLACE" && operation.value && !current.includes(normalize(operation.value))) issues.push("REVISION_REPLACEMENT_MISSING");
  }
  if (intent.preserveUnmentioned) {
    const removed = new Set(intent.operations.filter((item) => item.kind === "REMOVE" || item.kind === "REPLACE").flatMap((item) => item.target ? [normalize(item.target)] : []));
    for (const value of existingValues) if (!removed.has(value) && !current.includes(value)) issues.push("REVISION_PRESERVE_NOT_APPLIED");
  }
  return [...new Set(issues)];
}
