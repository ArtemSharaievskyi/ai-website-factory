import { describe, expect, it } from "vitest";
import { applyBriefChangeSet } from "./reducer";
import { cleanBriefV3 } from "./fixtures";
import { CanonicalBriefV3Schema, canonicalizePublicPhone, canonicalizeServiceAddress, derivePublicTelephoneDisplay, derivePublicTelephoneUri } from "./schema";
import { createBriefConsistencyCorrectionChangeSet, deterministicBriefCorrectionInstruction, PublicEmailCorrectionInputSchema, PublicationIdentityCorrectionInputSchema, validateCanonicalBriefConsistency } from "./consistency";
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

const syntheticPublicationIdentityCorrection = {
  kind: "DETERMINISTIC_PUBLICATION_IDENTITY" as const,
  serviceAddress: {
    street: "Beispielstraße",
    houseNumber: "12",
    postalCode: "12345",
    city: "Beispielstadt",
    countryCode: "DE",
    countryDisplayName: "Deutschland",
    confirmation: "CUSTOMER_CONFIRMED" as const,
    source: "CUSTOMER_CONFIRMATION" as const,
    publicationAuthorized: true as const,
    publicationScopes: ["CONTACT", "IMPRESSUM"] as Array<"CONTACT" | "IMPRESSUM">,
  },
  publicPhone: {
    e164: "+4915123456789",
    confirmation: "CUSTOMER_CONFIRMED" as const,
    source: "CUSTOMER_CONFIRMATION" as const,
    publicationAuthorized: true as const,
    publicationScopes: ["CONTACT", "IMPRESSUM"] as Array<"CONTACT" | "IMPRESSUM">,
  },
  businessEntityType: {
    entityType: "SOLE_PROPRIETORSHIP" as const,
    legalDescription: "Einzelunternehmen" as const,
    confirmation: "CUSTOMER_CONFIRMED" as const,
    source: "CUSTOMER_CONFIRMATION" as const,
    publicationAuthorized: true as const,
    publicationScopes: ["CONTACT", "IMPRESSUM"] as Array<"CONTACT" | "IMPRESSUM">,
  },
  commercialRegisterStatus: {
    status: "NOT_REGISTERED" as const,
    confirmation: "CUSTOMER_CONFIRMED" as const,
    source: "CUSTOMER_CONFIRMATION" as const,
    publicationAuthorized: true as const,
    publicationScopes: ["CONTACT", "IMPRESSUM"] as Array<"CONTACT" | "IMPRESSUM">,
  },
  ustIdStatus: {
    status: "NOT_YET_ASSIGNED" as const,
    confirmation: "CUSTOMER_CONFIRMED" as const,
    source: "CUSTOMER_CONFIRMATION" as const,
    publicationAuthorized: true as const,
    publicationScopes: ["CONTACT", "IMPRESSUM"] as Array<"CONTACT" | "IMPRESSUM">,
  },
  wIdStatus: {
    status: "NOT_YET_ASSIGNED" as const,
    confirmation: "CUSTOMER_CONFIRMED" as const,
    source: "CUSTOMER_CONFIRMATION" as const,
    publicationAuthorized: true as const,
    publicationScopes: ["CONTACT", "IMPRESSUM"] as Array<"CONTACT" | "IMPRESSUM">,
  },
};

describe("Deterministic publication identity capability", () => {
  it("validates structured German addresses and deterministic telephone derivation", () => {
    const address = canonicalizeServiceAddress(syntheticPublicationIdentityCorrection.serviceAddress);
    const phone = canonicalizePublicPhone(syntheticPublicationIdentityCorrection.publicPhone);
    expect(address.display).toBe("Beispielstraße 12, 12345 Beispielstadt, Deutschland");
    expect(phone.display).toBe(derivePublicTelephoneDisplay(phone.e164));
    expect(phone.display).toBe("+49 151 23456789");
    expect(phone.telUri).toBe(derivePublicTelephoneUri(phone.e164));
    expect(PublicationIdentityCorrectionInputSchema.safeParse(syntheticPublicationIdentityCorrection).success).toBe(true);
  });

  it("rejects malformed address, postcode, phone, URI, authorization, and scope values", () => {
    expect(PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      serviceAddress: { ...syntheticPublicationIdentityCorrection.serviceAddress, postalCode: "1234" },
    }).success).toBe(false);
    expect(PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      serviceAddress: { ...syntheticPublicationIdentityCorrection.serviceAddress, street: "https://example.invalid" },
    }).success).toBe(false);
    expect(PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      serviceAddress: { ...syntheticPublicationIdentityCorrection.serviceAddress, city: "Example <City>" },
    }).success).toBe(false);
    expect(PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      serviceAddress: { ...syntheticPublicationIdentityCorrection.serviceAddress, street: "Example\nStreet" },
    }).success).toBe(false);
    expect(PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      publicPhone: { ...syntheticPublicationIdentityCorrection.publicPhone, e164: "tel:+4915123456789" },
    }).success).toBe(false);
    expect(PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      publicPhone: { ...syntheticPublicationIdentityCorrection.publicPhone, telUri: "javascript:alert(1)" },
    }).success).toBe(false);
    expect(PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      publicPhone: { ...syntheticPublicationIdentityCorrection.publicPhone, e164: "+4915123456789\n" },
    }).success).toBe(false);
    expect(PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      publicPhone: { ...syntheticPublicationIdentityCorrection.publicPhone, publicationAuthorized: false },
    }).success).toBe(false);
    expect(PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      commercialRegisterStatus: { ...syntheticPublicationIdentityCorrection.commercialRegisterStatus, status: "REGISTERED" },
    }).success).toBe(false);
    expect(PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      ustIdStatus: { ...syntheticPublicationIdentityCorrection.ustIdStatus, status: "ASSIGNED" },
    }).success).toBe(false);
    const contactOnly = PublicationIdentityCorrectionInputSchema.safeParse({
      ...syntheticPublicationIdentityCorrection,
      serviceAddress: { ...syntheticPublicationIdentityCorrection.serviceAddress, publicationScopes: ["CONTACT"] },
    });
    expect(contactOnly.success).toBe(true);
    expect(() => createBriefConsistencyCorrectionChangeSet({ brief: cleanBriefV3, projectId, projectVersion: 1, correction: contactOnly.success ? contactOnly.data : syntheticPublicationIdentityCorrection })).toThrow("BRIEF_V3_INVALID_COMBINATION");
  });

  it("persists identity targets without creating duplicate requirements or legal fiction", () => {
    const before = CanonicalBriefV3Schema.parse({
      ...cleanBriefV3,
      contact: {
        publicEmail: {
          email: "synthetic@example.test",
          confirmation: "CUSTOMER_CONFIRMED",
          source: "CUSTOMER_CONFIRMATION",
          publicationAuthorized: true,
          publicationScopes: ["CONTACT", "IMPRESSUM"],
        },
      },
      legal: {
        ...cleanBriefV3.legal,
        publicationInputs: {
          address: { status: "REQUIRED_BEFORE_PUBLICATION", sourceRefs: ["fixture:address"] },
          rapidContact: { status: "REVIEW_REQUIRED", sourceRefs: ["fixture:rapid-contact"] },
          taxIdentifiers: { status: "CONDITIONAL_IF_APPLICABLE", sourceRefs: ["fixture:tax"] },
          registerInformation: { status: "CONDITIONAL_IF_APPLICABLE", sourceRefs: ["fixture:register"] },
          regulatoryAuthority: { status: "CONDITIONAL_IF_APPLICABLE", sourceRefs: ["fixture:authority"] },
        },
      },
      unresolved: [
        { target: "LEGAL:ADDRESS", reason: "Synthetic address is required before publication.", sourceRefs: ["fixture:address"], status: "REQUIRED_BEFORE_PUBLICATION", blockingStages: ["PUBLICATION"] },
        { target: "CONTACT:RAPID_CHANNEL", reason: "Synthetic rapid contact requires review.", sourceRefs: ["fixture:rapid-contact"], status: "REVIEW_REQUIRED", blockingStages: ["PUBLICATION"] },
        { target: "CONTACT:PHONE", reason: "The synthetic phone remains unavailable.", sourceRefs: ["fixture:phone"], blockingStages: ["PUBLICATION"] },
        { target: "LEGAL:REGISTER_INFORMATION", reason: "Synthetic register status is conditional.", sourceRefs: ["fixture:register"], status: "CONDITIONAL_IF_APPLICABLE", blockingStages: [] },
      ],
    });
    const changeSet = createBriefConsistencyCorrectionChangeSet({ brief: before, projectId, projectVersion: 1, correction: syntheticPublicationIdentityCorrection });
    const next = applyBriefChangeSet(before, changeSet);
    expect(validateCanonicalBriefConsistency(next)).toEqual([]);
    expect(next.legal.serviceAddress?.display).toBe("Beispielstraße 12, 12345 Beispielstadt, Deutschland");
    expect(next.contact?.publicPhone).toMatchObject({ e164: "+4915123456789", display: "+49 151 23456789", telUri: "tel:+4915123456789" });
    expect(next.legal.businessEntityType?.legalDescription).toBe("Einzelunternehmen");
    expect(next.legal.commercialRegisterStatus?.status).toBe("NOT_REGISTERED");
    expect(next.legal.ustIdStatus?.status).toBe("NOT_YET_ASSIGNED");
    expect(next.legal.wIdStatus?.status).toBe("NOT_YET_ASSIGNED");
    expect(next.legal.publicationInputs).toMatchObject({ address: { status: "RESOLVED" }, rapidContact: { status: "RESOLVED" }, registerInformation: { status: "NOT_APPLICABLE" } });
    expect(next.unresolved.some((item) => ["LEGAL:ADDRESS", "CONTACT:RAPID_CHANNEL", "CONTACT:PHONE", "CONTACT:WHATSAPP", "LEGAL:REGISTER_INFORMATION"].includes(item.target))).toBe(false);
    expect(next.contact?.publicEmail?.email).toBe("synthetic@example.test");
    expect(next.requirements).toEqual(before.requirements);
    expect(next.requirements.filter((entry) => /address|phone|register|USt|W-Id/i.test(entry.statement))).toHaveLength(0);
    expect(JSON.stringify(next)).not.toMatch(/Kleinunternehmer|§\s*19\s*UStG/i);
  });

  it("keeps operation identity digest-only and rejects conflicting confirmed values", () => {
    const instruction = deterministicBriefCorrectionInstruction(syntheticPublicationIdentityCorrection);
    expect(instruction).not.toContain("Beispielstraße");
    expect(instruction).not.toContain("+4915123456789");
    expect(instruction).toContain("identityDigest");
    const first = createBriefConsistencyCorrectionChangeSet({ brief: cleanBriefV3, projectId, projectVersion: 1, correction: syntheticPublicationIdentityCorrection });
    const current = applyBriefChangeSet(cleanBriefV3, first);
    expect(() => createBriefConsistencyCorrectionChangeSet({
      brief: current,
      projectId,
      projectVersion: 1,
      correction: { ...syntheticPublicationIdentityCorrection, serviceAddress: { ...syntheticPublicationIdentityCorrection.serviceAddress, street: "Andere Straße" } },
    })).toThrow("BRIEF_V3_INVALID_COMBINATION");
  });
});
