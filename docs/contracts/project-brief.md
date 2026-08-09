# Project Brief

The Lead Agent assembles a draft `requirements.json` containing project identity, purpose, audience, pages, functionality, contact/legal/brand facts, logo metadata, image sourcing, localization, authentication/storage/email/admin decisions, acceptance criteria, unresolved items, evidence, recommendations, and approval metadata.

The draft is not approved merely because extraction succeeded. It must have no blocking clarifications, unresolved contradictions, unsupported business facts, missing required image-source decisions, or missing acceptance criteria. The draft checksum covers the persisted requirements document.

The brief remains a draft until a user supplies the matching checksum and explicitly approves it. The approval transition is server-side and optimistic-concurrency protected.
