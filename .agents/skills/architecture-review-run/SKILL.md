---
name: architecture-review-run
description: Run the production Architecture Review boundary with host-owned evidence, currentness, and atomic persistence.
---

# Architecture Review run

## When it applies

Use after Planning Acceptance and before Design eligibility when the canonical
workflow requires Architecture Review.

## Authority and preconditions

Use the production entrypoint with the current Brief, accepted PlanningPackage,
Architecture, Phase 7C package, policy snapshot, and host-issued request-bound
`EvidenceCatalog`. Validate strict evidence membership and all currentness/CAS
inputs before provider spend.

## Allowed mutations

The provider returns semantic findings only. The host owns policyVersion,
provenance, artifact identity, currentness, and workflow routing. One canonical
transaction persists the result, history, decision, and an approved routing
transition. Project Memory is written only as a post-commit projection.

## Forbidden shortcuts

No free-form evidence references, provider-authored host metadata, transaction
spanning provider work, partial review persistence, history replacement, or
retry without explicit authorization.

## Stop and certification

`PASS` may continue automatically when the task policy permits it.
`CHANGES_REQUIRED` and `BLOCKED` stop at Architecture Review. Certify strict
evidence membership, host policy/provenance, atomic rollback, preserved review
history, currentness recheck at commit, and projection recovery without a
second provider call.
