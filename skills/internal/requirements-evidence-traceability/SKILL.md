---
name: requirements-evidence-traceability
description: Semantically audit preservation from approved requirements through planning, tasks, implementation evidence, and quality evidence.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: contract-auditor, test-quality-reviewer
capabilities: review.contracts, review.test-quality
coverage-keys: requirements-traceability-review, cross-stage-consistency, traceability-evidence
context-range: 5–9 KB
---

# Requirements and Evidence Traceability

## Purpose

Use this shared read-only procedure to judge whether approved intent survives
across the Factory stages. The Contract Auditor judges semantic preservation;
the Test / Quality Reviewer judges whether the resulting behavior has
sufficient evidence.

## Inputs and evidence

- approved Brief and requirements;
- Planning contracts and TaskGraph responsibilities;
- implemented artifacts or behavior evidence;
- deterministic validation and derived quality evidence.

## Steps

1. Build a bounded semantic trace from each material requirement to its
   planning contract, responsible task, implemented outcome, and evidence.
2. Check whether meaning, constraints, ownership, and expected outcomes were
   preserved rather than merely renamed.
3. Classify each finding as `COMPLETE`, `MISSING_TRACE`, `WEAK_TRACE`,
   `CONTRADICTORY_TRACE`, or `UNSUPPORTED_EVIDENCE`. Separate deterministic
   facts from reviewer judgment.
4. For Contract review, focus on cross-stage preservation and orphaned or
   drifting obligations. For Test review, focus on whether behavioral evidence
   demonstrates the approved outcome and important failure modes.
5. Return role-specific findings with evidence and the smallest responsible
   owner. Do not redesign Planning or Implementation.

## Decision rules

- Deterministic IDs, checksums, and reference graphs are not re-reviewed here.
- A trace is not complete merely because every stage contains a matching name.
- Evidence must demonstrate the behavior or contract it claims to support.
- Missing evidence and contradictory behavior are distinct findings.

## Quality checks

- Each conclusion points to bounded stage evidence.
- Semantic preservation and evidence sufficiency are not conflated.
- Findings use the existing ReviewResult contract and named ownership.
- The same content and checksum serve both target reviewers; only the output
  focus differs.

## Non-goals and authority

This procedure does not write tasks or tests, execute tests, run a browser,
mutate source, authorize redesign, or bypass a review gate. It is one shared
read-only skill with no shell, network, database, MCP, or approval authority.
