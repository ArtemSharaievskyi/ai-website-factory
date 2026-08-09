---
name: nextjs-server-client-implementation
description: Implement bounded Next.js App Router slices using deliberate Server/Client, Action, and Handler boundaries.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: implementation
capabilities: implementation.code
coverage-keys: nextjs-implementation, server-client-boundaries
context-range: 6–10 KB
---

# Next.js Server and Client Implementation

## Purpose

Use this procedure for an approved Next.js App Router task slice. It gives
Implementation a boundary method for fixed-stack work; current API syntax and
version details still come from the project documentation source.

## Inputs and evidence

- approved task slice, Planning package, and selected Design;
- canonical route, data, mutation, and validation contracts;
- fixed stack: Next.js App Router, React 19, TypeScript, and npm;
- current Server/Client policy and deterministic implementation validators.

## Steps

1. Locate the canonical route, source of truth, data owner, and required user
   interaction. Identify the smallest affected implementation slice.
2. Keep Server Components by default. Choose a Client Component only for
   interaction, browser state, or an API that genuinely requires it.
3. Minimize the `use client` boundary and verify that server-only data,
   credentials, and operations do not cross into the browser bundle.
4. Place data fetching with its owner, use a Server Action for an appropriate
   same-application mutation, and use a Route Handler only when an HTTP
   endpoint is actually required.
5. Preserve serialization boundaries, loading/error states, route structure,
   and component composition. Validate the smallest slice and record evidence.

## Decision rules

- Prefer server execution unless interaction or browser APIs require client
  execution.
- A Route Handler is not a default substitute for a Server Action.
- Secrets and privileged operations remain server-side.
- Do not introduce an alternative architecture or unplanned dependency.

## Quality checks

- Each client boundary has a named reason and the smallest justified scope.
- Data, mutation, validation, and result handling have one canonical owner.
- Loading and error behavior is reachable from the implemented path.
- Deterministic TypeScript, lint, build, and file-safety gates remain separate.

## Non-goals and authority

This procedure does not deploy, install packages, plan architecture, replace
validators, or grant unrestricted filesystem, network, browser, shell, workflow, or
approval authority. Implementation remains task-scoped and executor-controlled.
