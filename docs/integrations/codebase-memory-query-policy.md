# Codebase Memory query policy

Every query is a validated `CodebaseMemoryQueryPlan` containing project/version, task, requester role, operation, narrow target, reason, references, bounds, and the current source-manifest checksum. Secret-like values, conversation dumps, environment values, and broad requests are rejected.

The normalized result contains symbols, relationships, and bounded source excerpts. Raw MCP envelopes are never passed to a provider. Cache keys include project/version, manifest checksum, operation, canonical query, and normalization version. Query-id reuse with different input returns `IDEMPOTENCY_CONFLICT`.

Permissions are explicit: `codebase-memory-read`. Lead, design, approval, release, deployment, and unrelated planner tasks cannot use it.
