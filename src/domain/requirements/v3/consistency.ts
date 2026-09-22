import { createHash } from "node:crypto";
import { z } from "zod";
import { createV3RequirementId } from "./identity";
import { BriefV3Error } from "./errors";
import type { BriefChange, BriefChangeSet } from "./changeset";
import {
  CanonicalBriefV3Schema,
  CanonicalEvidenceSchema,
  CanonicalRequirementValueSchema,
  CanonicalPublicEmailSchema,
  CanonicalSeoSchema,
  ConfirmedProprietorSchema,
  type CanonicalBriefV3,
  type CanonicalEvidence,
  type CanonicalPage,
  type CanonicalRequirement,
} from "./schema";
import { SEMANTIC_TARGETS, pageTargetForSlug } from "./targets";
import { normalizeCanonicalBrief, stableSerialize } from "./normalize";

const source = "customer-confirmation:brief-consistency";
const systemSource = "system:brief-consistency";
const noLogoMarker = /(?:no\s+logo|kein(?:e|\s+)?logo|logo\s+(?:does\s+not|doesn't)\s+exist|do\s+not\s+invent\s+(?:a\s+)?logo)/iu;
const imagePermissionMarker = /(?:ai[- ]generated|placeholder|generated imagery|generate images?)/iu;
const brandMarkMarker = /(?:logo|wordmark|brand\s+mark|company\s+branding|brand(?:ing)?\s+replacement|legal\s+identity)/iu;
const legalMarker = /(?:legal|proprietor|inhaber|impressum|datenschutz|tax|vat|registration|address|postal|phone|email|contact)/iu;
const serviceExclusionMarker = /(?:legal|proprietor|inhaber|safety|exclude|exclusion|not\s+infer|do\s+not\s+invent|service\s+scope|service\s+exclusion)/iu;
const placeholderPattern = /\[\s*(PHONE|WHATSAPP|EMAIL|ADDRESS|POSTAL[_ -]?ADDRESS|REGISTRATION|TAX|VAT|CONTACT)\s*\]/giu;

const BrandConsistencyCorrectionInputSchema = z.object({
  marketingName: z.string().trim().min(1).max(300),
  proprietorName: z.string().trim().min(1).max(300),
  primaryStructure: z.literal("ONE_PAGE"),
  assetBinding: z.object({
    target: z.literal("ASSET_COMPANY_LOGO"),
    assetId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict();
export const PublicEmailCorrectionInputSchema = z.object({
  publicEmail: CanonicalPublicEmailSchema,
}).strict();
export const BriefConsistencyCorrectionInputSchema = z.union([
  BrandConsistencyCorrectionInputSchema.extend({ publicEmail: CanonicalPublicEmailSchema.optional() }).strict(),
  PublicEmailCorrectionInputSchema,
]);
export type BriefConsistencyCorrectionInput = z.infer<typeof BriefConsistencyCorrectionInputSchema>;

export type BriefConsistencyIssue = {
  code:
    | "ACTIVE_SUPERSEDED_BRAND"
    | "SUPPLIED_LOGO_CONTRADICTED"
    | "LOGO_REPLACEMENT_PERMISSION"
    | "PROPRIETOR_MARKETING_CONFLATION"
    | "PROPRIETOR_SOURCE_NOT_CONFIRMED"
    | "PROPRIETOR_INFERRED_FROM_LOGO"
    | "PLACEHOLDER_NOT_UNRESOLVED"
    | "SINGLE_PAGE_TOPOLOGY"
    | "LEGAL_EXCLUSION_CATEGORY";
  path: string;
};

const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const contains = (value: string | null | undefined, needle: string) => Boolean(value && needle && normalize(value).includes(normalize(needle)));
const replaceAllInsensitive = (value: string, candidate: string, replacement: string) => value.replace(new RegExp(escapeRegExp(candidate), "giu"), replacement);
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const hasBrandConsistencyCorrection = (correction: BriefConsistencyCorrectionInput): correction is Extract<BriefConsistencyCorrectionInput, { marketingName: string }> => "marketingName" in correction;

/** Operation identity intentionally carries only a digest of the canonical email. */
export function deterministicBriefCorrectionInstruction(correction: BriefConsistencyCorrectionInput): string {
  const parsed = BriefConsistencyCorrectionInputSchema.parse(correction);
  if (!parsed.publicEmail) return `Deterministic Brief consistency correction:${JSON.stringify(parsed)}`;
  const safe = parsed.publicEmail
    ? { ...parsed, publicEmail: { ...parsed.publicEmail, email: `sha256:${digest(parsed.publicEmail.email)}` } }
    : parsed;
  return `Deterministic Brief consistency correction:${stableSerialize(safe)}`;
}

export const isLegalAuxiliarySlug = (slug: string): boolean => /^\/?(?:impressum|datenschutz|privacy|imprint|legal|terms)(?:\/)?$/iu.test(slug.trim());

function candidateLegacyBrandReferences(brief: CanonicalBriefV3, marketingName: string): string[] {
  const candidates = new Set<string>();
  const activeTokens = new Set(normalize(marketingName).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2));
  for (const text of [brief.title, brief.seo.exactTitle, ...brief.seo.primaryKeywords].filter((value): value is string => Boolean(value))) {
    for (const match of text.matchAll(/\b[\p{Lu}][\p{Lu}\p{N}&-]{3,}\b/gu)) {
      const token = normalize(match[0]);
      if (!activeTokens.has(token) && !normalize(marketingName).includes(token)) candidates.add(match[0]);
    }
  }
  const oldTitle = brief.title?.split(/[·|–—:]/u)[0]?.trim();
  if (oldTitle && normalize(oldTitle) !== normalize(marketingName) && oldTitle.length >= 3 && !legalMarker.test(oldTitle)) candidates.add(oldTitle);
  return [...candidates].sort((left, right) => right.length - left.length);
}

function rewriteMarketingText(value: string, brief: CanonicalBriefV3, marketingName: string): string {
  return candidateLegacyBrandReferences(brief, marketingName).reduce((result, candidate) => replaceAllInsensitive(result, candidate, marketingName), value);
}

function marketingRequirement(requirement: CanonicalRequirement): boolean {
  return !["LEGAL_FACT", "LEGAL_CONSTRAINT", "CONTACT_FACT"].includes(requirement.category);
}

function hasCustomerConfirmation(sourceRefs: readonly string[]): boolean {
  return sourceRefs.some((ref) => /customer[-_: ]confirmation|customer[-_: ]confirmed/iu.test(ref));
}

function isPublicEmailUnresolved(item: CanonicalBriefV3["unresolved"][number]): boolean {
  const target = item.target.trim();
  const text = `${item.target} ${item.reason}`;
  return /^(?:email|e-mail)$/iu.test(target)
    || /(?:^|[:._-])(?:contact|public[_ -]?contact)[:._-]*(?:email|e-mail)(?:$|[:._-])/iu.test(target)
    || /\[\s*EMAIL\s*\]/iu.test(text)
    || /(?:public|contact|impressum|imprint).{0,80}(?:e-?mail|email)/iu.test(text);
}

function unresolvedForPlaceholders(brief: CanonicalBriefV3, values: readonly string[], resolvedPlaceholders: ReadonlySet<string> = new Set()): CanonicalBriefV3["unresolved"] {
  const existing = brief.unresolved.filter((item) => !contains(item.reason, brief.legal.confirmedProprietor?.name ?? "") && !(resolvedPlaceholders.has("EMAIL") && isPublicEmailUnresolved(item)));
  const byTarget = new Map(existing.map((item) => [item.target, item]));
  for (const value of values) {
    if (resolvedPlaceholders.has(value)) continue;
    const target = `CONTACT:${value}`;
    if (!byTarget.has(target)) byTarget.set(target, {
      target,
      reason: `The customer ${value.toLocaleLowerCase()} value remains unavailable; keep an explicit placeholder until publication.`,
      sourceRefs: [source],
      blockingStages: ["PUBLICATION"],
    });
  }
  return [...byTarget.values()];
}

function extractPlaceholders(brief: CanonicalBriefV3): string[] {
  const values = new Set<string>();
  const scan = (value: unknown) => {
    if (typeof value === "string") for (const match of value.matchAll(placeholderPattern)) values.add(match[1]!.replaceAll(" ", "_").toUpperCase());
    else if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === "object") Object.values(value).forEach(scan);
  };
  scan({ title: brief.title, requirements: brief.requirements, seo: brief.seo, pages: brief.pages });
  return [...values];
}

function requirementId(projectId: string, projectVersion: number, key: string): `REQUIREMENT:${string}` {
  return createV3RequirementId({ projectId, projectVersion, stableSemanticKey: `brief-consistency:${key}` }) as `REQUIREMENT:${string}`;
}

function requirementValue(category: CanonicalRequirement["category"], statement: string, sourceRefs: readonly string[] = [source]): z.infer<typeof CanonicalRequirementValueSchema> {
  return CanonicalRequirementValueSchema.parse({ category, statement, sourceRefs: [...new Set(sourceRefs)] });
}

function evidenceValue(field: string, excerpt: string, sourceRefs: readonly string[] = [source]): CanonicalEvidence {
  return CanonicalEvidenceSchema.parse({ field, source: "customer-confirmation", excerpt, sourceRefs: [...new Set(sourceRefs)] });
}

function publicEmailEvidence(publicEmail: z.infer<typeof CanonicalPublicEmailSchema>): CanonicalEvidence {
  return evidenceValue(
    "contact.publicEmail",
    `Customer-confirmed public contact email ${publicEmail.email} is authorized for ${publicEmail.publicationScopes.join(" and ")} publication.`,
  );
}

function isPublicEmailRequirement(entry: CanonicalRequirement, email: string): boolean {
  const text = `${entry.id} ${entry.statement}`;
  return contains(entry.statement, email)
    || /\[\s*EMAIL\s*\]/iu.test(text)
    || /(?:public[_ -]?contact|contact|impressum|imprint).{0,80}(?:e-?mail|email)/iu.test(text)
    || /(?:e-?mail|email).{0,80}(?:public[_ -]?contact|contact|impressum|imprint)/iu.test(text);
}

function publicEmailRequirementChanges(input: { brief: CanonicalBriefV3; projectId: string; projectVersion: number; publicEmail: z.infer<typeof CanonicalPublicEmailSchema> }): BriefChange[] {
  const scopes = input.publicEmail.publicationScopes;
  const candidates = input.brief.requirements.filter((entry) => isPublicEmailRequirement(entry, input.publicEmail.email));
  const selected = new Set<string>();
  const changes: BriefChange[] = [];
  const candidateFor = (scope: "CONTACT" | "IMPRESSUM") => candidates.find((entry) => {
    if (selected.has(entry.id)) return false;
    const text = `${entry.id} ${entry.statement}`;
    if (scope === "IMPRESSUM") return entry.category !== "CONTACT_FACT" && /impressum|imprint|legal/iu.test(text);
    return entry.category === "CONTACT_FACT" || !/impressum|imprint/iu.test(text);
  });
  const addScopeRequirement = (scope: "CONTACT" | "IMPRESSUM") => {
    const existing = candidateFor(scope);
    const target = existing?.id ?? requirementId(input.projectId, input.projectVersion, `public-email:${scope.toLocaleLowerCase()}`);
    const category = scope === "CONTACT" ? "CONTACT_FACT" as const : "LEGAL_FACT" as const;
    const statement = scope === "CONTACT"
      ? `Customer-confirmed public contact email: ${input.publicEmail.email}. Publish it in the public contact section; authorized publication scope: CONTACT.`
      : `Customer-confirmed public contact email: ${input.publicEmail.email}. Include it in the Impressum; authorized publication scope: IMPRESSUM.`;
    changes.push({ operation: "UPSERT", target: target as `REQUIREMENT:${string}`, value: requirementValue(category, statement, [...(existing?.sourceRefs ?? []), source]), sourceRefs: [source] });
    selected.add(target);
  };
  if (scopes.includes("CONTACT")) addScopeRequirement("CONTACT");
  if (scopes.includes("IMPRESSUM")) addScopeRequirement("IMPRESSUM");
  for (const entry of candidates) if (!selected.has(entry.id)) changes.push({ operation: "REMOVE", target: entry.id as `REQUIREMENT:${string}`, sourceRefs: [systemSource] });
  return changes;
}

function pageValue(slug: string, purpose: string, sourceRefs: readonly string[] = [source]): CanonicalPage {
  return { id: pageTargetForSlug(slug), slug, purpose, sourceRefs: [...new Set(sourceRefs)] };
}

function normalizedLegalRoutes(brief: CanonicalBriefV3): string[] {
  const routes = [...brief.pages.map((page) => page.slug), ...brief.seo.pageMetadata.map((page) => page.route)].filter(isLegalAuxiliarySlug);
  const normalized = new Set<string>();
  for (const route of routes) {
    if (/imprint|impressum/iu.test(route)) normalized.add("/impressum");
    else if (/privacy|datenschutz/iu.test(route)) normalized.add("/datenschutz");
    else if (/terms/iu.test(route)) normalized.add("/terms");
    else normalized.add(route.startsWith("/") ? route : `/${route}`);
  }
  return [...normalized].sort();
}

function marketingPages(brief: CanonicalBriefV3, marketingName: string): CanonicalPage[] {
  const refs = [...new Set(brief.pages.filter((page) => !isLegalAuxiliarySlug(page.slug)).flatMap((page) => page.sourceRefs))];
  return [pageValue("/", `Primary customer-facing marketing route for ${marketingName}; preserve the accepted content scope as anchored sections.`, refs.length ? refs : [source])];
}

function rewriteRequirementChanges(input: { brief: CanonicalBriefV3; projectId: string; projectVersion: number; marketingName: string; proprietorName: string }): BriefChange[] {
  const changes: BriefChange[] = [];
  for (const entry of input.brief.requirements) {
    const legalFact = entry.category === "LEGAL_FACT" && contains(entry.statement, input.proprietorName);
    const legalOrContact = ["LEGAL_FACT", "LEGAL_CONSTRAINT", "CONTACT_FACT"].includes(entry.category);
    const staleVisual = entry.category === "BRAND_VISUAL" && (serviceExclusionMarker.test(entry.statement) || imagePermissionMarker.test(entry.statement) || noLogoMarker.test(entry.statement));
    if (staleVisual) {
      changes.push({ operation: "REMOVE", target: entry.id as `REQUIREMENT:${string}`, sourceRefs: [systemSource] });
      const category = serviceExclusionMarker.test(entry.statement) ? "EXCLUSION" : "IMAGE_NOTE";
      const statement = category === "EXCLUSION"
        ? rewriteMarketingText(entry.statement, input.brief, input.marketingName)
        : "Supporting imagery may be generated or use placeholders only when it is not a logo, wordmark, brand mark, legal identity, or replacement company branding.";
      changes.push({ operation: "UPSERT", target: requirementId(input.projectId, input.projectVersion, `reclassified:${entry.id}`), value: requirementValue(category, statement, [...entry.sourceRefs, source]), sourceRefs: [source] });
      continue;
    }
    if (noLogoMarker.test(entry.statement) && !legalOrContact) {
      changes.push({ operation: "REMOVE", target: entry.id as `REQUIREMENT:${string}`, sourceRefs: [systemSource] });
      changes.push({ operation: "UPSERT", target: requirementId(input.projectId, input.projectVersion, `logo:${entry.id}`), value: requirementValue("LOGO_METADATA", "A customer-supplied authoritative logo exists; use it without regeneration, replacement, redraw, reinterpretation, wordmark substitution, or replacement company branding. Responsive sizing, placement, spacing, accessibility, and suitable backgrounds are allowed.", [...entry.sourceRefs, source]), sourceRefs: [source] });
      continue;
    }
    if (legalFact) {
      const sourceRefs = [...new Set([...entry.sourceRefs, source])];
      changes.push({ operation: "UPSERT", target: entry.id as `REQUIREMENT:${string}`, value: requirementValue(entry.category, entry.statement, sourceRefs), sourceRefs });
      continue;
    }
    if (!legalOrContact && marketingRequirement(entry)) {
      const statement = rewriteMarketingText(entry.statement, input.brief, input.marketingName);
      if (statement !== entry.statement) {
        changes.push({ operation: "REMOVE", target: entry.id as `REQUIREMENT:${string}`, sourceRefs: [systemSource] });
        changes.push({ operation: "UPSERT", target: requirementId(input.projectId, input.projectVersion, `reference:${entry.id}`), value: requirementValue(entry.category, statement, [...entry.sourceRefs, source]), sourceRefs: [source] });
      }
    }
  }
  const existingStatements = new Set(input.brief.requirements.map((entry) => `${entry.category}:${normalize(entry.statement)}`));
  const additions: Array<[CanonicalRequirement["category"], string, string]> = [
    ["BRAND_FACT", `The only active customer-facing marketing brand is ${input.marketingName}.`, "marketing-brand"],
    ["LEGAL_FACT", `Confirmed legal proprietor/Inhaber: ${input.proprietorName}. This fact is customer-confirmed; do not infer additional legal facts.`, "confirmed-proprietor"],
    ["LOGO_METADATA", "A customer-supplied authoritative logo exists; use it without regeneration, replacement, redraw, reinterpretation, wordmark substitution, or replacement company branding. Responsive sizing, placement, spacing, accessibility, and suitable backgrounds are allowed.", "logo-preservation"],
    ["IMAGE_NOTE", "Supporting imagery may be generated or use placeholders only when it is not a logo, wordmark, brand mark, legal identity, or replacement company branding.", "non-logo-imagery"],
    ["DECISION", "The primary marketing website uses one route at / with anchored sections; legally required auxiliary document routes may remain separate.", "one-page-topology"],
  ];
  for (const [category, statement, key] of additions) {
    if (!existingStatements.has(`${category}:${normalize(statement)}`)) changes.push({ operation: "UPSERT", target: requirementId(input.projectId, input.projectVersion, key), value: requirementValue(category, statement), sourceRefs: [source] });
  }
  return changes;
}

function correctedEvidence(brief: CanonicalBriefV3, marketingName: string, proprietorName: string): CanonicalEvidence[] {
  const logoEvidence = "Customer-supplied logo exists; use it and do not invent a replacement.";
  const result = brief.evidence.map((entry) => {
    const legal = legalMarker.test(`${entry.field} ${entry.excerpt}`) || contains(entry.excerpt, proprietorName);
    if (!legal && noLogoMarker.test(entry.excerpt)) return evidenceValue("brand.logo", logoEvidence, [...entry.sourceRefs, source]);
    if (legal && contains(entry.excerpt, proprietorName)) return { ...entry, sourceRefs: [...new Set([...entry.sourceRefs, source])] };
    if (legal) return entry;
    return { ...entry, excerpt: rewriteMarketingText(entry.excerpt, brief, marketingName) };
  });
  if (!result.some((entry) => entry.field === "brand.logo" && contains(entry.excerpt, "customer-supplied logo"))) result.push(evidenceValue("brand.logo", logoEvidence));
  if (!result.some((entry) => contains(entry.excerpt, proprietorName) && hasCustomerConfirmation(entry.sourceRefs))) result.push(evidenceValue("legal.proprietor", `Confirmed legal proprietor/Inhaber: ${proprietorName}; this is explicit customer confirmation and is not inferred from the logo.`));
  return result;
}

function correctedSeoPageMetadata(brief: CanonicalBriefV3, title: string, marketingName: string): z.infer<typeof CanonicalSeoSchema>["pageMetadata"] {
  const legal = normalizedLegalRoutes(brief);
  const byRoute = new Map(brief.seo.pageMetadata.map((entry) => [entry.route, entry]));
  return [
    { route: "/", title, metaDescription: brief.seo.exactMetaDescription ? rewriteMarketingText(brief.seo.exactMetaDescription, brief, marketingName) : null, keywords: brief.seo.primaryKeywords, sourceRefs: [source] },
    ...legal.map((route) => {
      const old = byRoute.get(route) ?? [...byRoute.values()].find((entry) => isLegalAuxiliarySlug(entry.route));
      return { route, title: old?.title ? rewriteMarketingText(old.title, brief, marketingName) : null, metaDescription: old?.metaDescription ? rewriteMarketingText(old.metaDescription, brief, marketingName) : null, keywords: old?.keywords ?? [], sourceRefs: [...new Set([...(old?.sourceRefs ?? []), source])] };
    }),
  ];
}

function createPublicEmailOnlyCorrectionChangeSet(input: { brief: CanonicalBriefV3; projectId: string; projectVersion: number; correction: Extract<BriefConsistencyCorrectionInput, { publicEmail: unknown; marketingName?: never }> }): BriefChangeSet {
  const brief = CanonicalBriefV3Schema.parse(input.brief);
  const publicEmail = CanonicalPublicEmailSchema.parse(input.correction.publicEmail);
  const normalized = normalizeCanonicalBrief({
    ...brief,
    evidence: [...brief.evidence, publicEmailEvidence(publicEmail)],
    unresolved: unresolvedForPlaceholders(brief, extractPlaceholders(brief), new Set(["EMAIL"])),
  });
  return {
    contractVersion: 1,
    changes: [
      { operation: "SET", target: SEMANTIC_TARGETS.PUBLIC_CONTACT_EMAIL, value: publicEmail, sourceRefs: [source] },
      { operation: "SET", target: SEMANTIC_TARGETS.BRIEF_EVIDENCE, value: normalized.evidence, sourceRefs: [source] },
      { operation: "SET", target: SEMANTIC_TARGETS.BRIEF_UNRESOLVED, value: normalized.unresolved, sourceRefs: [source] },
      ...publicEmailRequirementChanges({ brief, projectId: input.projectId, projectVersion: input.projectVersion, publicEmail }),
    ],
    unresolved: [],
  };
}

/** Deterministically creates a typed patch from confirmed customer facts. No provider is involved. */
export function createBriefConsistencyCorrectionChangeSet(input: { brief: CanonicalBriefV3; projectId: string; projectVersion: number; correction: BriefConsistencyCorrectionInput }): BriefChangeSet {
  const correction = BriefConsistencyCorrectionInputSchema.parse(input.correction);
  if (!hasBrandConsistencyCorrection(correction)) return createPublicEmailOnlyCorrectionChangeSet({ ...input, correction });
  const brief = CanonicalBriefV3Schema.parse(input.brief);
  const title = `${correction.marketingName}${brief.title?.includes("·") ? ` · ${brief.title.split("·").slice(1).join("·").trim()}` : ""}`;
  const metaDescription = brief.seo.exactMetaDescription ? rewriteMarketingText(brief.seo.exactMetaDescription, brief, correction.marketingName) : null;
  const keywords = brief.seo.primaryKeywords.map((keyword) => rewriteMarketingText(keyword, brief, correction.marketingName));
  const locationTargeting = brief.seo.locationTargeting.map((entry) => ({ ...entry, statement: rewriteMarketingText(entry.statement, brief, correction.marketingName) }));
  const primaryPages = marketingPages(brief, correction.marketingName);
  const pages = [...primaryPages, ...normalizedLegalRoutes(brief).map((slug) => pageValue(slug, "Legally required auxiliary document route; do not infer missing legal facts."))];
  const asset = brief.assets.find((entry) => entry.id === correction.assetBinding.target);
  const assetValue = {
    reference: `asset:${correction.assetBinding.assetId}`,
    role: "logo" as const,
    usage: "Use the customer-supplied authoritative logo; responsive sizing, placement, spacing, accessibility, and suitable backgrounds are allowed.",
    replacementPolicy: "FORBIDDEN" as const,
    sourceRefs: [...new Set([...(asset?.sourceRefs ?? []), source])],
  };
  const confirmedProprietor = ConfirmedProprietorSchema.parse({ name: correction.proprietorName, sourceRefs: [source] });
  const brandInformation = `${correction.marketingName}; customer-confirmed customer-facing brand identity. The registered customer-supplied logo is authoritative and may be responsively sized, placed, spaced, made accessible, and shown on suitable backgrounds; it must not be regenerated, replaced, redrawn, reinterpreted, or substituted.`;
  const logoDescription = "Customer-supplied authoritative logo. Do not regenerate, replace, redraw, reinterpret, substitute, or use replacement company branding; responsive sizing, placement, spacing, accessibility, suitable backgrounds, and non-distorting presentation are allowed.";
  const placeholderValues = extractPlaceholders(brief);
  const resolvedPlaceholders = correction.publicEmail ? new Set(["EMAIL"]) : new Set<string>();
  const correctedEvidenceValue = correctedEvidence(brief, correction.marketingName, correction.proprietorName);
  const normalizedFixedValues = normalizeCanonicalBrief({
    ...brief,
    seo: { ...brief.seo, primaryKeywords: keywords, locationTargeting, pageMetadata: correctedSeoPageMetadata(brief, title, correction.marketingName) },
    evidence: correction.publicEmail ? [...correctedEvidenceValue, publicEmailEvidence(correction.publicEmail)] : correctedEvidenceValue,
    unresolved: unresolvedForPlaceholders(brief, placeholderValues, resolvedPlaceholders),
  });
  const changes: BriefChange[] = [
    { operation: "SET", target: SEMANTIC_TARGETS.BRAND_REFERENCE_STRATEGY, value: "USER_SUPPLIED", sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.BRAND_MARKETING_NAME, value: correction.marketingName, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.BRAND_SUPPLIED_INFORMATION, value: brandInformation, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.BRAND_SUPPLIED_LOGO_DESCRIPTION, value: logoDescription, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.LEGAL_CONFIRMED_PROPRIETOR, value: confirmedProprietor, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.LEGAL_INVENTED_FACTS_POLICY, value: "FORBIDDEN", sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.ROUTE_POLICY, value: "SINGLE_PAGE", sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.BRIEF_TITLE, value: title, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.SEO_TITLE, value: title, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.SEO_META_DESCRIPTION, value: metaDescription, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.SEO_PRIMARY_KEYWORDS, value: normalizedFixedValues.seo.primaryKeywords, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.SEO_LOCATION_TARGETING, value: normalizedFixedValues.seo.locationTargeting, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.SEO_PAGE_METADATA, value: normalizedFixedValues.seo.pageMetadata, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.BRIEF_EVIDENCE, value: normalizedFixedValues.evidence, sourceRefs: [source] },
    { operation: "SET", target: SEMANTIC_TARGETS.BRIEF_UNRESOLVED, value: normalizedFixedValues.unresolved, sourceRefs: [source] },
    { operation: "UPSERT", target: "ASSET_COMPANY_LOGO", value: assetValue, sourceRefs: [source] },
    ...brief.pages.map((page) => ({ operation: "REMOVE" as const, target: page.id as `PAGE:${string}`, sourceRefs: [systemSource] })),
    ...pages.map((page) => ({ operation: "UPSERT" as const, target: page.id as `PAGE:${string}`, value: { slug: page.slug, purpose: page.purpose, sourceRefs: page.sourceRefs }, sourceRefs: [source] })),
    ...rewriteRequirementChanges({ brief, projectId: input.projectId, projectVersion: input.projectVersion, marketingName: correction.marketingName, proprietorName: correction.proprietorName }),
  ];
  if (correction.publicEmail) changes.push(
    { operation: "SET", target: SEMANTIC_TARGETS.PUBLIC_CONTACT_EMAIL, value: correction.publicEmail, sourceRefs: [source] },
    ...publicEmailRequirementChanges({ brief, projectId: input.projectId, projectVersion: input.projectVersion, publicEmail: correction.publicEmail }),
  );
  return { contractVersion: 1, changes, unresolved: [] };
}

export function validateCanonicalBriefConsistency(brief: CanonicalBriefV3): readonly BriefConsistencyIssue[] {
  const parsed = CanonicalBriefV3Schema.parse(brief);
  const issues: BriefConsistencyIssue[] = [];
  const marketingName = parsed.brand.marketingName;
  const proprietor = parsed.legal.confirmedProprietor;
  if (marketingName) {
    const references: Array<[string, string | null | undefined]> = [
      ["title", parsed.title],
      ["seo.exactTitle", parsed.seo.exactTitle],
      ["seo.exactMetaDescription", parsed.seo.exactMetaDescription],
      ["brand.suppliedInformation", parsed.brand.suppliedInformation],
      ...parsed.seo.pageMetadata.flatMap((entry) => [[`seo.pageMetadata:${entry.route}:title`, entry.title], [`seo.pageMetadata:${entry.route}:metaDescription`, entry.metaDescription]] as Array<[string, string | null]>),
    ];
    for (const [path, value] of references) {
      if (value && candidateLegacyBrandReferences(parsed, marketingName).some((candidate) => contains(value, candidate))) issues.push({ code: "ACTIVE_SUPERSEDED_BRAND", path });
    }
    for (const entry of parsed.requirements) if (marketingRequirement(entry) && candidateLegacyBrandReferences(parsed, marketingName).some((candidate) => contains(entry.statement, candidate))) issues.push({ code: "ACTIVE_SUPERSEDED_BRAND", path: `requirements:${entry.id}` });
  }
  const suppliedLogo = parsed.brand.referenceStrategy === "USER_SUPPLIED" && parsed.assets.some((asset) => asset.id === "ASSET_COMPANY_LOGO" && asset.role === "logo" && asset.replacementPolicy === "FORBIDDEN");
  if (suppliedLogo) {
    if (parsed.evidence.some((entry) => !legalMarker.test(`${entry.field} ${entry.excerpt}`) && noLogoMarker.test(entry.excerpt))) issues.push({ code: "SUPPLIED_LOGO_CONTRADICTED", path: "evidence" });
    for (const entry of parsed.requirements) if (imagePermissionMarker.test(entry.statement) && brandMarkMarker.test(entry.statement) && !/(?:not|without|exclude|except)[^.!?]{0,80}(?:logo|wordmark|brand\s+mark|company\s+branding)/iu.test(entry.statement)) issues.push({ code: "LOGO_REPLACEMENT_PERMISSION", path: `requirements:${entry.id}` });
  }
  if (proprietor) {
    if (!hasCustomerConfirmation(proprietor.sourceRefs)) issues.push({ code: "PROPRIETOR_SOURCE_NOT_CONFIRMED", path: "legal.confirmedProprietor.sourceRefs" });
    if (proprietor.sourceRefs.some((ref) => /asset:|logo/iu.test(ref))) issues.push({ code: "PROPRIETOR_INFERRED_FROM_LOGO", path: "legal.confirmedProprietor.sourceRefs" });
    if (marketingName && normalize(marketingName) === normalize(proprietor.name)) issues.push({ code: "PROPRIETOR_MARKETING_CONFLATION", path: "brand.marketingName" });
    for (const [path, value] of [["title", parsed.title], ["seo.exactTitle", parsed.seo.exactTitle], ["seo.exactMetaDescription", parsed.seo.exactMetaDescription], ["brand.suppliedInformation", parsed.brand.suppliedInformation]] as Array<[string, string | null | undefined]>) if (contains(value, proprietor.name)) issues.push({ code: "PROPRIETOR_MARKETING_CONFLATION", path });
  }
  const unresolvedText = parsed.unresolved.map((item) => `${item.target} ${item.reason}`).join(" ");
  for (const placeholder of extractPlaceholders(parsed)) if (!new RegExp(`(?:${escapeRegExp(placeholder)}|${escapeRegExp(placeholder.replaceAll("_", " "))})`, "iu").test(unresolvedText)) issues.push({ code: "PLACEHOLDER_NOT_UNRESOLVED", path: placeholder });
  if (parsed.decisions.routePolicy.mode === "SINGLE_PAGE" && parsed.pages.filter((page) => !isLegalAuxiliarySlug(page.slug)).length > 1) issues.push({ code: "SINGLE_PAGE_TOPOLOGY", path: "pages" });
  for (const entry of parsed.requirements) if (entry.category === "BRAND_VISUAL" && serviceExclusionMarker.test(entry.statement)) issues.push({ code: "LEGAL_EXCLUSION_CATEGORY", path: `requirements:${entry.id}` });
  return issues;
}

export function assertCanonicalBriefConsistency(brief: CanonicalBriefV3): void {
  const issues = validateCanonicalBriefConsistency(brief);
  if (issues.length) throw new BriefV3Error("BRIEF_V3_INVARIANT_VIOLATION", { invariant: "cross-field-consistency", issueCodes: [...new Set(issues.map((issue) => issue.code))].join(",") });
}
