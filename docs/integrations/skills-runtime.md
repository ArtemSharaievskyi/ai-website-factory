# Approved skills runtime

The runtime treats an approved skill as supplemental, checksum-bound procedure text. It cannot grant a tool, permission, requirement, approval, executor, or write path. `AgentDefinition.allowedSkillIds` is the allowlist; the registry approval record remains authoritative for role, task type, tools, files, expiry, and immutable content integrity.

`resolveApprovedSkillContext` evaluates every skill in the agent allowlist and supports zero, one, or multiple results. It filters by approved status, capability, task type, project surfaces, and requested coverage; rejects explicit conflicts and redundant overlap; then orders candidates by applicability priority and stable internal ID. It loads each selected procedure through `SkillRegistry.load`, preserving role/task/tool authority and the remaining shared context budget. There is no fixed maximum or top-K quota.

The resolver returns selected skill IDs, coverage, immutable source checksums, loaded text, exclusions, byte usage, and a deterministic context identity. Reviewer services include that identity in their idempotency/staleness hash and pass the selected procedures to the OpenAI adapter. Prompt assembly labels them as supplemental, renders their approved checksums, and explicitly preserves canonical artifacts and reviewer role authority.

Phase 4B2 assignments are:

- Architecture Reviewer: `module-boundaries-fb20497b5c35`, exact curated checksum `5ff94ca54b67326d7c377a33d2e61d108887a96729c2c3ff228b4f3a6ff3c5ff`.
- Contract Auditor: `acceptance-criteria-80493e317476`, exact curated checksum `2f522f9ef2d167860e613288395b6777dc2f9cb8fb88d67c255fb83986f579ec`.
- Security Reviewer: `supabase-rls-1e36b217c969`, exact curated checksum `87bc57e597d3eb2e6ec8d4c099684cf4685da84ef45076b14083a7fcc7100877`.

The RLS procedure is selected only when the bounded security input identifies a Supabase/Postgres, RLS, or user-scoped database surface. It is not selected for `NONE`, static/no-persistence, or external-API-only reviews.
