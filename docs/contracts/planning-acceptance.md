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
no unnecessary infrastructure. `PlannerArchitectService.acceptPlanningPackage`
re-reads current canonical rows and commits the accepted PlanningPackage
envelope, the acceptance decision, the Phase 7C package, and the transition to
`ARCHITECTURE_REVIEW` in one host-owned database transaction. Unchanged content
and asset documents are not rewritten merely to materialize acceptance.

The PlanningPackage semantic checksum excludes the host-owned acceptance
envelope; acceptance metadata may advance its persisted document row without
changing planning meaning. Project Memory and filesystem snapshots are derived
post-commit projections. If projection fails, canonical acceptance remains
reconstructable and `reconcileAcceptedPlanningProjection` can restore it; a
projection failure is never reported as a successful synchronized snapshot.
Acceptance does not create design directions or authorize publication. Final
legal facts and verified asset rights remain required for publication readiness.
