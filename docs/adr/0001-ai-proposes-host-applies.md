# ADR 0001: AI proposes; the host applies

Status: Accepted

## Decision

AI providers return bounded, typed proposals. Host-owned deterministic reducers
validate and apply those proposals to canonical state. A provider-generated full
canonical Brief is never a mutation authority.

## Rationale

A full provider candidate and a separate operation description create competing
sources of truth. Reconciliation then needs text matching, hidden preservation,
contradiction repair, and history-aware merge behavior. A typed ChangeSet gives
the provider interpretation responsibility while leaving identity, locality,
normalization, invariants, currentness, and provenance with the host.

## Consequence

Provider transport and canonical state remain separate contracts. Legacy Briefs
are migrated at the adapter boundary, and history is derived only after a
successful host reduction.
