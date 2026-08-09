---
name: react-nextjs-integration-review
description: Review semantic React and Next.js integration behavior after deterministic structural gates.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: code-integration-reviewer
capabilities: review.integration
coverage-keys: react-review, nextjs-review, maintainability-review
context-range: 6–10 KB
---

# React and Next.js Integration Review

## Purpose

Use this read-only procedure after structural validation to inspect whether a
bounded generated change is semantically connected across routes, components,
handlers, data, and state.

## Inputs and evidence

- current Code / Integration approval and deterministic lint, typecheck, and
  build evidence;
- approved contracts, TaskGraph slice, and direct integration neighbors;
- route, navigation, form, handler, data-source, and mutation evidence.

## Steps

1. Map the bounded change to its canonical route, component, handler, data
   owner, and intended outcome.
2. Trace props, state, events, validation, data requests, mutations,
   revalidation, and result handling across the affected path.
3. Check Server/Client boundaries, route-to-navigation consistency, forms to
   handlers, UI to data source, and loading/error reachability.
4. Look for dead or disconnected implementation, duplicate source of truth,
   unplanned alternative architecture, and maintenance consequences.
5. Return evidence-backed findings with implementation ownership. Do not write
   code or repeat deterministic compiler and lint results.

## Decision rules

- A structurally valid path can still fail if the user outcome is disconnected.
- One canonical source of truth is preferred when competing paths can drift.
- A boundary finding must identify the broken semantic connection.
- TypeScript, ESLint, build, and file-safety results remain deterministic gates.

## Quality checks

- Every finding names the connected stages and observed evidence.
- Route, event, data, mutation, and result flows are checked only where bounded.
- Security and test strategy findings are handed to their owners.
- Output remains the existing read-only ReviewResult contract.

## Non-goals and authority

This procedure does not write code, run tests, use a browser, install packages,
mutate source, or approve changes. It grants no shell, network, filesystem,
database, workflow, or approval authority.
