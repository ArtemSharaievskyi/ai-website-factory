---
name: architecture-tradeoff-review
description: Review architectural alternatives and evolution risk after the existing module-boundaries lens has been applied.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: architecture-reviewer
capabilities: review.architecture
coverage-keys: architecture-tradeoffs
context-range: 5–8 KB
---

# Architecture Trade-off Review

## Purpose

Use this read-only procedure after module-boundary findings are available to
judge whether a planning choice is proportionate to the approved outcome.
Focus on decisions and consequences, not another cohesion checklist.

## Inputs and evidence

- approved Brief and Planning package;
- stated alternatives, module-boundaries evidence, and architecture schemas;
- data/application boundaries, persistence decisions, and operational
  assumptions.

## Steps

1. State the architectural decision, the outcome it supports, and the viable
   alternatives that were actually available.
2. Compare simplicity, coupling, duplication, abstraction cost, dependency
   choice, state ownership, data boundaries, and server/client placement.
3. Examine operational complexity, reversibility, evolution cost, and the
   smallest material risk introduced by the selected option.
4. Separate evidence-backed constraints from preference or speculative future
   scale. Identify a reversible alternative when the choice is premature.
5. Return an evidence-backed recommendation or finding with an owner; do not
   mutate Planning or demand optional infrastructure.

## Decision rules

- A more extensible design is not better if it adds unsupported complexity.
- Duplication can be preferable when it keeps independent decisions decoupled.
- A boundary is justified by ownership, change rate, security, or operation,
  not by abstraction habit.
- Module-boundaries findings remain complementary and authoritative for their
  own structural checks.

## Quality checks

- Alternatives and trade-offs are concrete rather than rhetorical.
- The recommendation identifies evidence and material consequence.
- No compiler, security, or test claim is presented as architecture evidence.
- Output is an existing typed ReviewResult with no planning mutation.

## Non-goals and authority

This procedure does not repeat module-boundary heuristics, create plans, write
code, call tools, or change workflow state. It is read-only and grants no
shell, browser, network, source, or approval authority.
