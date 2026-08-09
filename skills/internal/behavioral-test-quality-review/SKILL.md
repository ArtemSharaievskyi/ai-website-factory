---
name: behavioral-test-quality-review
description: Judge whether the smallest meaningful test strategy and evidence validate approved behavior and regression risk.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: test-quality-reviewer
capabilities: review.test-quality
coverage-keys: test-strategy, meaningful-assertions, playwright-quality
context-range: 6–10 KB
---

# Behavioral Test Quality Review

## Purpose

Use this read-only procedure to judge whether tests demonstrate approved
behavior rather than merely existing or passing. Runtime QA remains responsible
for executing Vitest and Playwright.

## Inputs and evidence

- approved requirements and derived quality evidence;
- test artifacts, diagnostics, deterministic quality-gate results, and direct
  implementation behavior;
- forms, auth, persistence, integration, and user-flow contracts where present.

## Steps

1. Map approved behavior and important failure modes to the test evidence. Note
   missing happy-path, error-path, and important edge-condition coverage.
2. Inspect assertions for observable outcomes, meaningful state or response
   changes, and false-positive risk. Flag tests that pass without proving the
   requirement.
3. Check isolation, determinism, fixture ownership, mock fidelity, async
   handling, and implementation-detail overfitting.
4. Judge whether unit, integration, or E2E level is proportionate to the
   behavior and regression risk. Do not demand a universal percentage.
5. Return semantic gaps with the smallest sufficient remedy and owner; never
   execute or write the tests.

## Decision rules

- An assertion is meaningful when its failure would expose a behavior regression.
- A mock is weak when it can pass while the real contract is disconnected.
- Error and recovery behavior matter where the approved flow exposes them.
- Test quality is distinct from deterministic command success and traceability.

## Quality checks

- Findings cite the behavior, test evidence, assertion, and regression risk.
- Isolation and async behavior are considered without inventing tooling.
- Test level follows the boundary and user outcome.
- Output remains the existing read-only ReviewResult contract.

## Non-goals and authority

This procedure does not write or run tests, operate a browser, execute Vitest or
Playwright, mutate source, create tasks, or grant shell, network, MCP, or
workflow or approval authority. Shared semantic traceability remains in its
single shared skill.
