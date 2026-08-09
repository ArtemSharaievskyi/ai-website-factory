---
name: supabase-application-integration
description: Integrate Supabase, Postgres, Auth, and Storage into bounded tasks while preserving Factory ownership and security handoffs.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: implementation
capabilities: implementation.backend
coverage-keys: supabase-implementation
context-range: 6–10 KB
---

# Supabase Application Integration

## Purpose

Use this procedure when an approved task explicitly requires Supabase-backed
behavior. Preserve the planned data model, credential boundaries, and Security
handoff while implementing only the requested application slice.

## Inputs and evidence

- accepted architecture and backend task slice;
- planned schema, access patterns, migrations, and generated types;
- Auth, Storage, and RLS policies;
- existing server/client client conventions and error contracts.

## Steps

1. Confirm that persistence or Supabase is required. Map the task to the
   approved persistence surface and identify its owner and access pattern.
2. Choose the server or client client according to the session and data
   boundary. Keep anon credentials limited to their intended surface.
3. Keep service-role secrets and privileged operations server-side. Trace Auth
   identity, authorization assumptions, Storage ownership, and signed-URL use.
4. Connect reads, writes, uploads, and errors to canonical types and planned
   migrations. Do not invent tables, fields, policies, or persistence.
5. Record RLS and security follow-up plus deterministic validation evidence for
   the Security Reviewer and release gates.

## Decision rules

- No Supabase call is justified only by future extensibility.
- RLS assumptions are handed off; this procedure does not replace the approved
  `supabase-rls` review method.
- A service role is never exposed to a browser or user-controlled input.
- Planned migrations and generated types remain the source of truth.

## Quality checks

- Credential and session boundaries are explicit for every operation.
- Ownership, Storage visibility, upload constraints, and signed URLs are traced.
- Error behavior does not leak secrets or sensitive records.
- No autonomous database administration or policy approval occurs.

## Non-goals and authority

This procedure does not run database commands autonomously, administer
Supabase, use a browser, replace Security Review, invent persistence, or grant database,
network, shell, secret, deployment, or approval authority.
