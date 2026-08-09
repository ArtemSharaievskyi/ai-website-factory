---
name: technical-risk-planning
description: Identify actionable technical risks, dependencies, assumptions, and mitigations before TaskGraph creation.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: planner
capabilities: planning.architecture
coverage-keys: technical-risk-planning
context-range: 4–7 KB
---

# Technical Risk and Dependency Planning

## Purpose

Use this procedure before TaskGraph creation to make material uncertainty
visible and actionable. It produces risk and evidence obligations, not a second
orchestration plan.

## Inputs and evidence

- approved Brief, architecture choices, and planning output;
- known Factory stack, tool policies, and integration contracts;
- persistence, authentication, upload, and error/recovery requirements.

## Steps

1. Scan each planned boundary for uncertainty: external integrations, auth,
   authorization, data consistency, uploads, migrations, dependencies,
   browser/runtime assumptions, performance-sensitive flows, and testability.
2. For every material risk record the risk, evidence, affected outcome, impact,
   owner, and stage at which it must be addressed.
3. Identify dependency ordering and blocking assumptions. Distinguish an
   unverified assumption from an already demonstrated constraint.
4. Attach the smallest mitigation and a deterministic or review evidence check.
   Prefer a reversible mitigation over speculative infrastructure.
5. Return a bounded risk register for planning and implementation handoff.

## Decision rules

- Do not use probability numbers unless the evidence supports them.
- A risk is material when failure can change scope, security, data integrity,
  user outcome, or release confidence.
- A mitigation must reduce a named risk and have an owner or validation point.
- Existing deterministic dependency and TaskGraph rules remain authoritative.

## Quality checks

- Each risk has evidence, impact, owner/stage, mitigation, and validation.
- Risks are not disguised product decisions or generic pessimism.
- Duplicate risks are consolidated without losing distinct owners.
- No implementation tasks are created directly by the procedure.

## Non-goals and authority

This procedure does not execute validation, rewrite architecture by preference,
create TaskGraph tasks, transition workflow state, or grant shell, network,
browser, source mutation, or approval authority.
