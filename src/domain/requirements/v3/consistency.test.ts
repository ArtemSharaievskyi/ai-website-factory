import { describe, expect, it } from "vitest";
import { applyBriefChangeSet } from "./reducer";
import { cleanBriefV3 } from "./fixtures";
import { CanonicalBriefV3Schema } from "./schema";
import { createBriefConsistencyCorrectionChangeSet, deterministicBriefCorrectionInstruction, PublicEmailCorrectionInputSchema, validateCanonicalBriefConsistency } from "./consistency";
import { canonicalBriefChecksum } from "./normalize";

const projectId = "22222222-2222-4222-8222-222222222222";
const correction = {
  marketingName: "MITTELHESSEN DEMONTAGE & OBJEKTSERVICE",
  proprietorName: "Artem Sharaievskyi",
  primaryStructure: "ONE_PAGE" as const,
  assetBinding: { target: "ASSET_COMPANY_LOGO" as const, assetId: "44444444-4444-4444-8444-444444444444", sha256: "a".repeat(64) },
};

const inconsistentBrief = CanonicalBriefV3Schema.parse({
  ...cleanBriefV3,
  title: "SHARAIEVSKYI Rückbau · Entkernung",
  pages: [
    { id: "PAGE:home", slug: "home", purpose: "Hero.", sourceRefs: ["fixture:page"] },
    { id: "PAGE:services", slug: "services", purpose: "Services.", sourceRefs: ["fixture:page"] },
    { id: "PAGE:imprint", slug: "imprint", purpose: "Legal.", sourceRefs: ["fixture:page"] },
  ],
  decisions: { ...cleanBriefV3.decisions, routePolicy: { mode: "MULTI_PAGE" } },
  assets: [{ id: "ASSET_COMPANY_LOGO", reference: `asset:${correction.assetBinding.assetId}`, role: "logo", usage: "Customer supplied logo.", replacementPolicy: "FORBIDDEN", sourceRefs: ["fixture:asset"] }],
  brand: { referenceStrategy: "USER_SUPPLIED", suppliedInformation: "SHARAIEVSKYI identity.", suppliedLogoDescription: "Supplied logo." },
  seo: {
    ...cleanBriefV3.seo,
    primaryKeywords: ["sharaievskyi demolition"],
    exactTitle: "SHARAIEVSKYI Rückbau",
    exactMetaDescription: "SHARAIEVSKYI local demolition.",
    locationTargeting: [{ id: "REQUIREMENT:location", category: "SEO", statement: "Target SHARAIEVSKYI locally.", sourceRefs: ["fixture:seo"] }],
    pageMetadata: [{ route: "/", title: "SHARAIEVSKYI", metaDescription: "SHARAIEVSKYI", keywords: ["sharaievskyi"], sourceRefs: ["fixture:seo"] }, { route: "/imprint", title: "Imprint", metaDescription: null, keywords: [], sourceRefs: ["fixture:seo"] }],
  },
  requirements: [
    ...cleanBriefV3.requirements,
    { id: "REQUIREMENT:old-brand", category: "BRAND_VISUAL", statement: "Use the SHARAIEVSKYI wordmark; no logo exists.", sourceRefs: ["fixture:old"] },
    { id: "REQUIREMENT:bad-exclusion", category: "BRAND_VISUAL", statement: "Do not infer legal identity from the logo and exclude unsafe service scope.", sourceRefs: ["fixture:old"] },
    { id: "REQUIREMENT:legal-confirmed", category: "LEGAL_FACT", statement: "Inhaber Artem Sharaievskyi.", sourceRefs: ["fixture:legal"] },
    { id: "REQUIREMENT:contact", category: "CONTACT_FACT", statement: "Contact: [PHONE]", sourceRefs: ["fixture:contact"] },
  ],
  evidence: [{ field: "brand.logo", source: "old", excerpt: "no logo; do not invent one", sourceRefs: ["fixture:old"] }, { field: "legal.proprietor", source: "customer", excerpt: "Inhaber Artem Sharaievskyi", sourceRefs: ["fixture:legal"] }],
  unresolved: [],
});

describe("Canonical Brief cross-field consistency", () => {
  it("creates a deterministic correction that propagates brand, SEO, evidence, topology, unresolved state, and categories", () => {
    const changeSet = createBriefConsistencyCorrectionChangeSet({ brief: inconsistentBrief, projectId, projectVersion: 1, correction });
    const next = applyBriefChangeSet(inconsistentBrief, changeSet);
    expect(validateCanonicalBriefConsistency(next)).toEqual([]);
    expect(next.brand.marketingName).toBe(correction.marketingName);
    expect(next.title).toContain(correction.marketingName);
    expect(next.title).not.toMatch(/SHARAIEVSKYI/i);
    expect(next.seo.exactTitle).toContain(correction.marketingName);
    expect(next.seo.primaryKeywords.join(" ")).not.toMatch(/SHARAIEVSKYI/i);
    expect(next.evidence.some((entry) => /no logo/i.test(entry.excerpt))).toBe(false);
    expect(next.evidence.some((entry) => /customer-supplied logo exists/i.test(entry.excerpt))).toBe(true);
    expect(next.legal.confirmedProprietor?.name).toBe(correction.proprietorName);
    expect(next.legal.confirmedProprietor?.sourceRefs).toContain("customer-confirmation:brief-consistency");
    expect(next.pages.map((page) => page.slug).sort()).toEqual(["/", "/impressum"]);
    expect(next.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ target: "CONTACT:PHONE", blockingStages: ["PUBLICATION"] })]));
    expect(next.requirements.some((entry) => entry.id === "REQUIREMENT:bad-exclusion")).toBe(false);
    expect(next.requirements.some((entry) => entry.category === "EXCLUSION" && /legal identity/i.test(entry.statement))).toBe(true);
    expect(next.requirements.some((entry) => entry.id === "REQUIREMENT:service")).toBe(true);
    expect(inconsistentBrief.evidence[0]?.excerpt).toBe("no logo; do not invent one");
  });

  it("reports reusable contradictions without using customer-specific values", () => {
    const bad = CanonicalBriefV3Schema.parse({
      ...cleanBriefV3,
      title: "Old Brand",
      brand: { ...cleanBriefV3.brand, marketingName: "Current Brand", referenceStrategy: "USER_SUPPLIED" },
      legal: { ...cleanBriefV3.legal, confirmedProprietor: { name: "Current Brand", sourceRefs: ["asset:logo"] } },
      pages: [{ id: "PAGE:home", slug: "home", purpose: "Home.", sourceRefs: ["fixture"] }, { id: "PAGE:services", slug: "services", purpose: "Services.", sourceRefs: ["fixture"] }],
      decisions: { ...cleanBriefV3.decisions, routePolicy: { mode: "SINGLE_PAGE" } },
      evidence: [{ field: "brand.logo", source: "fixture", excerpt: "no logo exists", sourceRefs: ["fixture"] }],
      requirements: [{ id: "REQUIREMENT:bad", category: "BRAND_VISUAL", statement: "AI-generated imagery may replace the logo and exclude legal service scope.", sourceRefs: ["fixture"] }, { id: "REQUIREMENT:placeholder", category: "CONTACT_FACT", statement: "Phone [PHONE]", sourceRefs: ["fixture"] }],
      unresolved: [],
    });
    expect(validateCanonicalBriefConsistency(bad).map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "ACTIVE_SUPERSEDED_BRAND",
      "SUPPLIED_LOGO_CONTRADICTED",
      "LOGO_REPLACEMENT_PERMISSION",
      "PROPRIETOR_MARKETING_CONFLATION",
      "PROPRIETOR_INFERRED_FROM_LOGO",
      "PLACEHOLDER_NOT_UNRESOLVED",
      "SINGLE_PAGE_TOPOLOGY",
      "LEGAL_EXCLUSION_CATEGORY",
    ]));
  });

  it("persists a typed confirmed public email, reconciles only email obligations, and remains idempotent", () => {
    const publicEmail = {
      email: " kontakt@example.com ",
      confirmation: "CUSTOMER_CONFIRMED" as const,
      source: "CUSTOMER_CONFIRMATION" as const,
      publicationAuthorized: true as const,
      publicationScopes: ["IMPRESSUM", "CONTACT", "CONTACT"] as Array<"CONTACT" | "IMPRESSUM">,
    };
    const before = CanonicalBriefV3Schema.parse({
      ...cleanBriefV3,
      requirements: [
        ...cleanBriefV3.requirements,
        { id: "REQUIREMENT:contact-email", category: "CONTACT_FACT", statement: "Public contact email: [EMAIL]", sourceRefs: ["fixture:contact"] },
        { id: "REQUIREMENT:imprint-email", category: "LEGAL_FACT", statement: "Impressum email: [EMAIL]", sourceRefs: ["fixture:impressum"] },
      ],
      unresolved: [
        { target: "CONTACT:EMAIL", reason: "The customer email remains unavailable; keep a placeholder.", sourceRefs: ["fixture:email"], blockingStages: ["PUBLICATION"] },
        { target: "CONTACT:PHONE", reason: "The customer phone remains unavailable; keep a placeholder.", sourceRefs: ["fixture:phone"], blockingStages: ["PUBLICATION"] },
        { target: "CONTACT:ADDRESS", reason: "The customer postal address remains unavailable; keep a placeholder.", sourceRefs: ["fixture:address"], blockingStages: ["PUBLICATION"] },
      ],
    });
    const beforeChecksum = canonicalBriefChecksum(before);
    const changeSet = createBriefConsistencyCorrectionChangeSet({ brief: before, projectId, projectVersion: 1, correction: { publicEmail } });
    const next = applyBriefChangeSet(before, changeSet);

    expect(next.contact?.publicEmail).toMatchObject({ email: "kontakt@example.com", confirmation: "CUSTOMER_CONFIRMED", source: "CUSTOMER_CONFIRMATION", publicationAuthorized: true, publicationScopes: ["CONTACT", "IMPRESSUM"] });
    expect(next.contact?.publicEmail?.email).not.toMatch(/^mailto:/i);
    expect(next.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "CONTACT:PHONE" }),
      expect.objectContaining({ target: "CONTACT:ADDRESS" }),
    ]));
    expect(next.unresolved.some((item) => /email/i.test(item.target))).toBe(false);
    expect(next.requirements.find((entry) => entry.id === "REQUIREMENT:contact-email")?.statement).toContain("kontakt@example.com");
    expect(next.requirements.find((entry) => entry.id === "REQUIREMENT:imprint-email")?.statement).toContain("kontakt@example.com");
    expect(next.requirements.filter((entry) => /kontakt@example\.com/i.test(entry.statement))).toHaveLength(2);
    expect(next.requirements.some((entry) => entry.id === "REQUIREMENT:service")).toBe(true);
    expect(next.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ field: "contact.publicEmail", source: "customer-confirmation" })]));
    expect(canonicalBriefChecksum(next)).not.toBe(beforeChecksum);

    const replay = applyBriefChangeSet(next, createBriefConsistencyCorrectionChangeSet({ brief: next, projectId, projectVersion: 1, correction: { publicEmail: { ...publicEmail, email: "kontakt@example.com" } } }));
    expect(canonicalBriefChecksum(replay)).toBe(canonicalBriefChecksum(next));
    expect(deterministicBriefCorrectionInstruction({ publicEmail })).not.toContain("kontakt@example.com");
    expect(deterministicBriefCorrectionInstruction({ publicEmail })).not.toBe(deterministicBriefCorrectionInstruction({ publicEmail: { ...publicEmail, email: "support@example.com" } }));
  });

  it("validates ordinary public email values without accepting unsafe representations", () => {
    const valid = PublicEmailCorrectionInputSchema.parse({
      publicEmail: {
        email: "  contact@example.com  ",
        confirmation: "CUSTOMER_CONFIRMED",
        source: "CUSTOMER_CONFIRMATION",
        publicationAuthorized: true,
        publicationScopes: ["CONTACT", "CONTACT"],
      },
    });
    expect(valid.publicEmail.email).toBe("contact@example.com");
    expect(valid.publicEmail.publicationScopes).toEqual(["CONTACT"]);
    for (const email of ["not-an-email", "mailto:contact@example.com", "https://example.com/contact@example.com", "a@example.com,b@example.com", "a\u0000@example.com", "Display Name <contact@example.com>"]) {
      expect(PublicEmailCorrectionInputSchema.safeParse({ publicEmail: { ...valid.publicEmail, email } }).success).toBe(false);
    }
    expect(PublicEmailCorrectionInputSchema.safeParse({ publicEmail: { ...valid.publicEmail, publicationScopes: [] } }).success).toBe(false);
    expect(PublicEmailCorrectionInputSchema.safeParse({ publicEmail: { ...valid.publicEmail, publicationScopes: ["UNKNOWN"] } }).success).toBe(false);
    expect(PublicEmailCorrectionInputSchema.safeParse({ publicEmail: { ...valid.publicEmail, confirmation: "PROVIDER_CONFIRMED" } }).success).toBe(false);
  });
});
