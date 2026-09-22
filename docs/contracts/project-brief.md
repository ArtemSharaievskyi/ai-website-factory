# Project Brief

The Lead Agent assembles a draft `requirements.json` containing project identity, purpose, audience, pages, functionality, contact/legal/brand facts, logo metadata, image sourcing, localization, authentication/storage/email/admin decisions, acceptance criteria, unresolved items, evidence, recommendations, and approval metadata.

The draft is not approved merely because extraction succeeded. It must have no blocking clarifications, unresolved contradictions, unsupported business facts, missing required image-source decisions, or missing acceptance criteria. The draft checksum covers the persisted requirements document.

The brief remains a draft until a user supplies the matching checksum and explicitly approves it. The approval transition is server-side and optimistic-concurrency protected.

## Customer-confirmed public contact email

Canonical Brief V3 may carry an additive `contact.publicEmail` object with the
plain email value, `CUSTOMER_CONFIRMED` confirmation, the
`CUSTOMER_CONFIRMATION` source marker, `publicationAuthorized: true`, and one
or more bounded publication scopes: `CONTACT` and/or `IMPRESSUM`. The value is
trimmed at the boundary but its local-part and domain spelling are otherwise
preserved; it is never stored as `mailto:` or as a display name.

The typed `PUBLIC_CONTACT_EMAIL` correction is host-owned and deterministic. It
updates the structured contact field, records bounded customer-confirmation
evidence, reconciles only email placeholders and matching contact/Impressum
requirements, and leaves phone and postal/legal address unresolved until they
are independently confirmed. It uses the existing currentness, idempotency,
immutable history, and projection transaction; it does not construct or call
an AI provider. Future provider Brief revisions receive the current canonical
state and preserve this host-owned target rather than authoring it. A website
may derive `mailto:<canonical-email>` later, but that derived link is not a
canonical Brief value.

Raw email values are canonical customer data: they may appear in authorized
canonical storage and project-data readback, but not in operation IDs, safe
fingerprints, unrestricted logs, or generic diagnostics. Operation identity
uses a digest of the normalized value so a changed confirmed address remains a
distinct semantic intent without exposing the address.
