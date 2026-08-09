# skills.sh Source Integration

`src/integrations/skills-sh/` is a narrow administrative source adapter for the official public skills.sh JSON API. skills.sh is an external source of procedural guidance, not an orchestrator, agent framework, runtime, permission system, or trust authority.

The supported read-only endpoints are the public search endpoint and explicit skill-detail endpoint documented by skills.sh: `https://skills.sh/api/v1/skills/search` and `https://skills.sh/api/v1/skills/{source}/{skill}`. The adapter accepts only the exact HTTPS `skills.sh` origin, JSON responses, bounded files/bytes, bounded retries, cancellation, and a timeout. Redirects, arbitrary hosts, non-HTTPS URLs, credentials, cookies, CLI commands, Git clones, and recursive external links are rejected or not followed.

The lifecycle is: `search -> explicit candidate selection -> bounded detail fetch -> normalized descriptor/provenance -> existing STAGING registry -> deterministic parser/security review -> explicit manual approval -> checksum-bound immutable APPROVED copy`.

The official API currently requires a Vercel OIDC bearer credential for live
administrative requests. The adapter reads `VERCEL_OIDC_TOKEN` only when an
administrative request is made and sends it as `Authorization: Bearer <token>`.
Missing credentials fail fast as `SKILLS_SH_AUTH_REQUIRED`; 401, 403, 429, and
transient/network failures receive distinct safe classifications. The token is
never included in errors, reports, provenance, checksums, skill content, or
runtime/AI context. Local approved-skill loading does not use this credential.

Discovery and fetching never approve or assign a skill. Staged candidates retain the external ID, canonical source reference, retrieval timestamp, retrieved content checksum, normalized checksum, and existing registry manifest checksum. Upstream changes produce a new candidate and require new approval; approved historical copies are never overwritten.

External content is untrusted text. Shell, install, prompt-injection, authority-override, secret-exfiltration, privilege, destructive, obfuscated, and similar instructions are statically quarantined where detected. Code examples are not executable. No imported script is run, no package is installed, and no agent definition is modified. Skill text cannot grant tools or permissions: `AgentDefinition` remains authoritative, wildcard skill permissions are rejected, and runtime loading can require an explicit allowed-skill snapshot.

Approved runtime loading is local-only. Existing approved copies continue to work when skills.sh is unavailable, and runtime never refetches upstream content. Phase 4A deliberately assigns no external skills to any of the nine agents; deliberate curation and assignment belong to Phase 4B.

## Advisory audit metadata

The administrative curation layer may also call the documented
`/api/v1/skills/audit/{source}/{skill}` endpoint. Audit results are stored as
advisory metadata only: a PASS is not Factory approval, a FAIL is surfaced for
human review, and a 404/no-audit result does not fail a locally safe candidate.
