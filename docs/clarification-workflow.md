# Clarification workflow

The supported path is:

`DRAFT → CLARIFYING → AWAITING_BRIEF_APPROVAL → AWAITING_DESIGN_SELECTION`

Intake normalizes only CRLF/CR line endings and stores the original prompt in Project Memory plus a SHA-256 checksum in Supabase metadata. Analysis is versioned by project and prompt checksum. Questions have stable IDs, requirement keys, fingerprints, blocking flags, and answer history. Blocking questions cannot be deferred.

Answers are persisted in the clarification log, mirrored to Project Memory, and recorded as evidence in the brief. Repeated requests use idempotency keys. A stale prompt checksum, brief checksum, or project row version is rejected.

Only the user can approve the brief. A revision invalidates approval, records a requirement-change decision, and reopens clarification.
