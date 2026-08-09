---
name: lead-requirements-completeness
description: Turn clarified user intent into a complete, uncertainty-labeled requirement set without inventing business facts.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: lead
capabilities: requirements.clarify, requirements.brief
coverage-keys: requirements-completeness
context-range: 4–8 KB
---

# Requirements Completeness and Clarification Lens

## Purpose

Use this procedure before Brief approval to find material missing information.
It supplements the Lead clarification policy by checking whether the intended
product can be described well enough for downstream planning.

## Inputs and evidence

- the original user request and explicit constraints;
- the clarification session, answers, refusals, and unresolved questions;
- the Lead input/output contracts and Project Brief schema.

Preserve a short evidence reference for every material conclusion. Treat an
inference as an assumption, not as a user-provided fact.

## Steps

1. Inventory the stated purpose, audience, outcomes, pages or features,
   workflows, content facts, brand/assets, image strategy, constraints, and
   success expectations.
2. For each relevant dimension, classify information as `KNOWN`,
   `UNKNOWN_BUT_MATERIAL`, `NOT_APPLICABLE`, or `CAN_BE_DECIDED_TECHNICALLY_LATER`.
3. Check for contradictions between answers, requested behavior, and stated
   constraints. Separate a genuine contradiction from a harmless wording gap.
4. Ask only business-facing questions for material unknowns. Do not ask the
   user to choose implementation details that belong to Planner.
5. Emit a bounded completeness rationale containing evidence, unresolved
   uncertainty, and the condition under which the Brief can proceed.

## Decision rules

- A missing fact is material only when it can change scope, user outcome,
  privacy, persistence, or acceptance expectations.
- Mark `NOT_APPLICABLE` only when the request or evidence supports that result.
- Mark technical choices for later when the user outcome is clear and the
  choice is owned by Planning or Implementation.
- Never turn a plausible assumption into a requirement.

## Quality checks

- Every clarification need has an evidence reference and a user-facing reason.
- No implementation-level question is presented as a product requirement.
- The result distinguishes absent information from rejected information.
- The output remains compatible with the typed Brief contract.

## Non-goals and authority

This procedure does not replace Brief parsing, deterministic validation, or
approval gates. It cannot approve a Brief, alter clarification IDs, mutate
workflow state, or invent business facts. It grants no shell, browser, network,
package, filesystem, orchestration, or approval authority.
