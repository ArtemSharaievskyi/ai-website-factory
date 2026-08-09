---
name: project-data-model-planning
description: Derive a minimal Factory-compatible data model from approved requirements and access patterns.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: planner
capabilities: planning.architecture
coverage-keys: data-modeling
context-range: 5–9 KB
---

# Project Data Model Planning

## Purpose

Use this procedure when approved requirements imply durable data, ownership, or
cross-request state. Produce a planning contract that Implementation and
Security can trace; do not jump directly to database schema code.

## Inputs and evidence

- approved Brief and planning package;
- persistence mode and domain schemas;
- described forms, workflows, read/write flows, and access policies;
- existing database and RLS policy conventions where applicable.

## Steps

1. Extract domain nouns, actors, outcomes, and ownership claims from approved
   requirements. Label each proposed entity with its requirement evidence.
2. Separate durable entities from transient UI state, derived values, and
   external-service responses. Do not create persistence for a temporary need.
3. Map identifiers, relationships, cardinality, lifecycle, required and
   optional properties, and invariants. Record unresolved choices explicitly.
4. Derive read and write access patterns, ownership boundaries, privacy
   implications, storage-versus-relational placement, and RLS implications.
5. Trace each model decision to a requirement, form or flow, and planned
   implementation responsibility. Return the smallest sufficient model.

## Decision rules

- A model element requires a durable reason, not merely a plausible future use.
- Ownership is explicit for user-scoped or organization-scoped data.
- A derived value is not stored unless consistency and lifecycle justify it.
- RLS implications are recorded for Security; this procedure does not author
  policies or migrations.

## Quality checks

- Every entity and relationship has requirement or flow evidence.
- Cardinality and lifecycle are stated where they affect behavior.
- Read/write paths and ownership are testable by later tasks.
- No SQL, migration, repository, or RLS implementation is embedded in the plan.

## Non-goals and authority

This procedure does not write migrations, execute a database, implement a
repository, use a browser, invent persistence, or approve architecture. It grants no source
mutation, database, shell, package, network, or approval authority.
