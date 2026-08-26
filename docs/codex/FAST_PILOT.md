# Fast Pilot policy

This is a reusable execution policy for a protected real pilot. It contains no
project state; the task envelope and canonical persistence provide current
operation parameters and project truth.

## Objective

Move a protected real pilot through canonical lifecycle stages efficiently while
preserving authority, currentness, provider budgets, approval gates, and failure
atomicity.

## Continue automatically through

- deterministic host transitions;
- currentness reconciliation through existing canonical services; and
- internal non-user approval gates.

## Stop conditions

Stop for a genuine condition only:

1. explicit user approval or selection is required;
2. a provider returns semantic `BLOCKED` or `CHANGES_REQUIRED`;
3. a provider request fails and no retry is authorized;
4. a deterministic source defect is discovered;
5. CAS/currentness cannot be restored safely;
6. the authorized provider budget would be exceeded; or
7. the canonical contract cannot represent approved semantics.

## Source versus lifecycle

`SOURCE_REPAIR` permits a bounded source commit, keeps protected-pilot and
provider mutations at zero, and requires synthetic certification before real
use.

`REAL_LIFECYCLE` permits canonical mutation only. It has zero tracked source
mutation, uses production entrypoints, stops on a source defect, and requires an
explicit provider budget.

`READ_ONLY_AUDIT` permits neither source nor canonical mutation and uses zero
provider calls.

## Agent policy

The task envelope may select `SINGLE`, `BOUNDED_PARALLEL`, or
`READ_ONLY_SWARM`. Parallel work is bounded to at most four read-only lanes;
the Lead remains the single integration authority, and parallel canonical
writes are forbidden. `READ_ONLY_SWARM` permits no source, canonical, or
provider mutation. This is a coordination policy, not a new orchestration
framework.

## Provider policy

Run deterministic preflight before provider spend. Exploratory calls, correction
calls, fallback, and automatic retry are disabled by default. The exact budget
belongs in the task envelope, not in this policy.

## Genuine user gates

Never self-authorize a new or revised Brief approval, a changed semantic
PlanningPackage approval, or Design Selection when the canonical contract
requires the user.

## Design

Design generation produces exactly three directions. It never selects one
automatically; after persistence, stop for the user's explicit choice.
