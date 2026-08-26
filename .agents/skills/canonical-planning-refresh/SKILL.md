---
name: canonical-planning-refresh
description: Refresh a current PlanningPackage from an approved lossless CanonicalBriefV3 through the host-owned planning boundary.
---

# Canonical planning refresh

## When it applies

Use when an approved current V3 Brief requires a new or reconciled planning
candidate. It is generic and never contains project state.

## Authority and preconditions

- `CanonicalBriefV3.current` and its host-issued currentness token are the sole
  requirements input.
- Validate Brief currentness, approval, readiness, and provider eligibility
  before provider spend.
- Assemble lossless Planner input; legacy requirements may be read/migrated for
  compatibility but never used as current authority.
- Use the production Planner port and deterministic admission validators.

## Allowed mutations

The Planner may propose a typed candidate. The canonical planning service owns
semantic diffing, checksum assignment, CAS/currentness checks, approval
invalidation, dependent handling, and atomic persistence.

If semantics change, create a new semantic checksum and require any approval
again. If semantics do not change, restore or rebind currentness only through
the canonical service; do not create a fake semantic revision.

## Forbidden shortcuts

No manual database patch, checksum rewrite, legacy-current substitution,
self-approval, direct persistence from a provider, or partial save before
deterministic admission.

## Stop and certification

Stop for missing approval, semantic `BLOCKED`/`CHANGES_REQUIRED`, provider
failure without authorized retry, source defect, unsafe CAS/currentness, or an
unrepresentable semantic. Certify lossless input, semantic diff behavior,
checksum domains, atomic rollback, preserved immutable history, and no provider
call after failed preflight.
