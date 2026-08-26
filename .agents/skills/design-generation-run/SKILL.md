---
name: design-generation-run
description: Generate exactly three canonical Design directions after all host-owned eligibility gates pass.
---

# Design generation run

## When it applies

Use only when the current lifecycle is eligible for Design generation.

## Authority and preconditions

The host must re-read current Brief, accepted PlanningPackage, Architecture,
Phase 7C package, and required Architecture Review evidence. Check approval,
currentness/CAS, deterministic Design eligibility, and professional capability
availability separately from user selection.

## Allowed mutations

The Design provider proposes semantic directions. The host adds the
`professionalDesign` enrichment, assigns identity/checksums/currentness, and
atomically persists the complete artifact and history.

## Forbidden shortcuts

Do not use stale or legacy requirements, persist partial directions, let the
provider author host metadata, silently require unavailable professional
capabilities, retry without authorization, or select a direction automatically.

## Stop and certification

Stop for any failed eligibility/currentness check, provider failure, invalid
semantic output, or persistence failure. Produce exactly three materially
distinct directions, then stop for explicit user Design Selection. Certify
zero partial artifact on failure, host enrichment, distinctness, atomicity, and
no selection side effect.
