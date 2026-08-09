# Approved skills runtime

The runtime treats an approved skill as supplemental, checksum-bound procedure text. It cannot grant a tool, permission, requirement, approval, executor, or write path. `AgentDefinition.allowedSkillIds` is the allowlist; the registry approval record remains authoritative for role, task type, tools, files, expiry, and immutable content integrity.

`resolveApprovedSkillContext` evaluates every skill in the agent allowlist and supports zero, one, or multiple results. It filters by approved status, capability, task type, project surfaces, and requested coverage; rejects explicit conflicts and redundant overlap; then orders candidates by applicability priority and stable internal ID. It loads each selected procedure through `SkillRegistry.load`, preserving role/task/tool authority and the remaining shared context budget. There is no fixed maximum or top-K quota.

The resolver returns selected skill IDs, coverage, immutable source checksums, loaded text, exclusions, byte usage, and a deterministic context identity. Reviewer services include that identity in their idempotency/staleness hash and pass the selected procedures to the OpenAI adapter. Prompt assembly labels them as supplemental, renders their approved checksums, and explicitly preserves canonical artifacts and reviewer role authority.

The Phase 4D4 active assignments are recorded in [the active portfolio snapshot](../admin/skill-curation/active-agent-skill-portfolio-2026-08-09.json). All nine agents have explicit allowlists. The complete active artifact set is 4 external plus 13 internal, with 18 assignment references because `requirements-evidence-traceability` is intentionally shared by Contract Auditor and Test / Quality Reviewer.

- Architecture Reviewer: `module-boundaries-fb20497b5c35`, `review-maintainability-d9faf7cb9775`, and `architecture-tradeoff-review`.
- Contract Auditor: `acceptance-criteria-80493e317476` and `requirements-evidence-traceability`.
- Code / Integration Reviewer: `react-nextjs-integration-review`.
- Security Reviewer: `supabase-rls-1e36b217c969` and `auth-storage-security-review` when relevant.
- Test / Quality Reviewer: `requirements-evidence-traceability` and `behavioral-test-quality-review`.
- Lead, Planner, Design, and Implementation use their active project-owned portfolios as recorded in the snapshot.

The RLS procedure is selected only when the bounded security input identifies a Supabase/Postgres, RLS, or user-scoped database surface. It is not selected for `NONE`, static/no-persistence, or external-API-only reviews.

Internal and external procedures use identical runtime authority checks. Skills remain supplemental context: they cannot grant tools, mutate source, approve artifacts, change workflow, or replace deterministic validation.
