---
name: typed-form-implementation
description: Implement forms with explicit schemas, user-visible states, and server-side validation while keeping the smallest justified client surface.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: implementation
capabilities: implementation.code
coverage-keys: forms-validation
context-range: 5–8 KB
---

# Typed Form and Validation Implementation

## Purpose

Use this procedure for an approved form task. It connects the Design and
Planning form contract to typed input, authoritative validation, and visible
behavior without inventing fields or treating client validation as security.

## Inputs and evidence

- form task slice and approved form contract;
- canonical English field IDs, localized labels, and expected states;
- Zod and fixed-stack policy;
- server action or handler contract and quality-gate expectations.

## Steps

1. Derive fields, field IDs, submission states, and outcomes from the approved
   contract. Keep stable internal IDs separate from localized labels.
2. Define one canonical Zod input schema at the authoritative boundary. Add
   client validation only to improve feedback and keep the server check.
3. Map validated form input to the typed domain input; do not pass arbitrary
   form values through to persistence or an external service.
4. Connect field and form errors to labels, pending state, retry, success, and
   recovery behavior. Use React Hook Form only when its complexity is justified.
5. Verify success and failure behavior at the smallest appropriate test level,
   and record authorization as a separate server-side concern.

## Decision rules

- A field must trace to the approved contract; do not infer fields from labels.
- Client validation is UX, never the trusted boundary.
- Server Actions are preferred where appropriate; Route Handlers are second.
- Authorization is not implied by schema validity.

## Quality checks

- IDs are language-independent and labels remain presentation data.
- The same contract drives validation, domain mapping, and visible errors.
- Errors identify the affected field or form and have a recovery path.
- No package is installed solely to follow a generic preference.

## Non-goals and authority

This procedure does not choose product requirements, perform Security Review,
install packages by default, or grant browser, shell, network, deployment, or
unrestricted source or approval authority.
