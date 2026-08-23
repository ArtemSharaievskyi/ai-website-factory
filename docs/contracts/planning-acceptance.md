# Planning acceptance

Planning acceptance validates the complete package: scope, sitemap, navigation, page responsibilities, flows, forms, data model, auth, Supabase, email, Storage, administration, content, assets, architecture, environment variables, dependencies, tests, security, and traceability.

The host-owned `evaluatePlanningAcceptanceReadiness` authority separates
technical acceptance blockers from lifecycle obligations. Its result exposes
`readyForAcceptance`, `blockingItems`, and `deferredItems`. Technical admission
failures, concrete invalid assets, unresolved product decisions, and unknown
blockers remain in `blockingItems`. Explicitly permitted legal placeholders and
planned, not-yet-selected photography may remain visible in `deferredItems` when
their later publication-safety obligation is recorded. Deferred items never
authorize publication and are not silently removed from the persisted package.

Acceptance requires a matching approved-Brief checksum, an empty
`blockingItems` result, npm, fixed-stack compliance, no speculative feature, and
no unnecessary infrastructure. It persists the package and checksums, writes
Project Memory, records a DecisionRecord, and remains in
`AWAITING_DESIGN_SELECTION`. It does not create design directions or transition
toward implementation. Publication readiness is a separate, stricter decision
that still requires final legal facts and verified asset rights.
