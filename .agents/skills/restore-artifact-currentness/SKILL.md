---
name: restore-artifact-currentness
description: Restore or reconcile downstream artifact currentness after an upstream change through canonical bindings.
---

# Restore artifact currentness

## When it applies

Use when an upstream Brief, PlanningPackage, Planning Acceptance, Architecture,
Phase 7C, Architecture Review, Contract Audit, or Design binding appears stale
or requires reconciliation.

## Authority and preconditions

Read actual repository rows, artifact bindings, checksum domains, approval
state, and row versions. A stale marker is a signal, not authority. Distinguish
semantic checksums from document checksums and validate the complete dependency
chain before rebuilding anything.

## Allowed mutations

Use the owning canonical service to rebuild or rebind the affected current
artifact, preserving immutable history and user approvals that remain valid.
Reconciliation may repair a derived projection from canonical rows after a
successful commit.

## Forbidden shortcuts

Never manually rewrite currentness flags, row versions, checksum bindings,
workflow state, approval records, or Project Memory. Never assume that every
stale marker requires a rebuild, and never use semantic equality to bypass
document/CAS currentness.

## Stop and certification

Stop when actual bindings conflict, CAS cannot be restored safely, approval is
no longer valid, or the canonical service cannot represent the dependency.
Certify the read-before-write decision, preserved history, correct checksum
domain, atomic canonical result, and idempotent projection reconciliation.
