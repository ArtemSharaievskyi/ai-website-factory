---
name: maintainable-performance-implementation
description: Choose maintainable local solutions and avoid avoidable runtime, bundle, and complexity costs during bounded implementation.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: implementation
capabilities: implementation.code
coverage-keys: maintainable-performance
context-range: 5–8 KB
---

# Maintainable and Performant Incremental Implementation

## Purpose

Use this procedure to make bounded implementation choices that preserve the
codebase's source of truth and reasonable web performance. It is a judgment
method, not a subjective score gate or premature optimization program.

## Inputs and evidence

- approved task slice and nearby codebase conventions;
- codebase memory, implementation policy, and validation diagnostics;
- evidence of a performance-sensitive flow, bundle concern, or maintenance
  cost where one exists.

## Steps

1. Identify the existing helper, component, adapter, or source of truth that
   already owns the behavior. Prefer reuse when it avoids meaningful drift.
2. Choose the smallest cohesive change. Reject abstraction whose only benefit
   is hypothetical reuse, while consolidating duplication that would otherwise
   diverge.
3. Check Server Component, client-bundle, data-flow, dependency, image, font,
   and obvious waterfall consequences relevant to this task.
4. Use lazy loading, caching, or memoization only when the boundary and
   expected benefit are clear. Keep error paths understandable.
5. Run the existing deterministic gates and record only material residual
   risks; do not claim performance improvement without evidence.

## Decision rules

- Prefer a local, reversible solution over a broad rewrite.
- Avoid unnecessary client JavaScript and dependencies.
- Performance work needs an observed or contract-based reason.
- Maintainability findings concern future defects or churn, not personal style.

## Quality checks

- The changed source of truth and data flow are named.
- Abstraction, dependency, and client-bundle choices have task evidence.
- No unsupported score or optimization gate is introduced.
- Lint, typecheck, build, and QA remain authoritative deterministic checks.

## Non-goals and authority

This procedure does not replace Architecture or Code Review, run benchmarks,
install packages, use a browser, deploy, or grant network, shell, package, or unrestricted
mutation or approval authority.
