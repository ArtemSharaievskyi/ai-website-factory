# Phase 7G — Token & Context Efficiency Layer

Status: **COMPLETE**
Date: 2026-08-12
Next phase: **Final Hardening Audit**

## Frozen candidate

- Initial Phase 7G HEAD: `258d5d7dd089063066bd90127147f21b1a403e52`
- Phase 7F source freeze: `27bc0833f500e68fdb9d05cf2acbda2f31d6d8ff`
- Implementation commit: `28dfbdb3c72f93cbf729525f827fe2cb1bcbb0b2`
- Candidate ID: `phase7g-2026-08-12-28dfbdb`
- Candidate/evidence manifest checksum: `1e24435ad2038bc5efafb4db84446081e2ef61a97f991fef54a86157db3a636b`
- Post-freeze source mutation: **none**

The JSON companion contains the complete 19-file manifest, SHA-256 values, acceptance records, validation evidence, and reviewer reconciliation.

## What changed

The canonical layer is implemented in [`src/runtime/context/assembler.ts`](../../../../src/runtime/context/assembler.ts), with strict versioned contracts in [`contracts.ts`](../../../../src/runtime/context/contracts.ts). All OpenAI role adapters pass through [`bridge.ts`](../../../../src/runtime/context/bridge.ts), which produces bounded context before the structured provider call.

| Area | Result |
| --- | --- |
| Context bundle | Strict `ContextBundleSchema` v1 with item kind, source checksum, content checksum, currentness, selection reason, priority, byte/token estimates, budget metrics, and blocker codes. |
| Required context | Required canonical/task context is never silently dropped. Missing, stale, secret-like, or required-only-overflow context blocks invocation. |
| Budget policy | Default, implementation, and reviewer profiles each have soft targets, hard ceilings, response reservations, file/snippet/skill/docs/diagnostic caps, and a conservative 4-bytes/token estimator. |
| Source context | TypeScript compiler API skeletons, target AST snippets, small-file whole content, bounded non-TypeScript snippets, deterministic target selection, provenance, and depth-2 dependency closure. |
| Approved skills | Exact section slicing bound to the approved full checksum and slice checksum; no semantic rewrite; no new tools or permissions. |
| Context7 | Relevant excerpt slicing with library/version/source/checksum provenance; raw documentation is not forwarded by the bridge. |
| Design candidates | Paid, incompatible, duplicate, and over-limit candidates are filtered deterministically before semantic work. |
| Diagnostics | TypeScript, ESLint, Vitest, Next-build, and runtime diagnostics become causal structured slices; raw host logs stay host-side. |
| Expansion | One bounded, data-only, task-scope-limited expansion request. |
| Provider deduplication | In-flight coalescing includes idempotency, model, schema, currentness, bundle checksum, and stable prefix checksum; there is no broad semantic result cache. |
| Provider usage | Actual input/output usage is captured only from provider response fields. Cached input is recorded only when reported; missing cache telemetry is explicit, never fabricated. |
| Prompt identity | Stable prefix checksum/bytes are recorded without timestamps, randomness, raw prompts, or secret content. |
| Pricing | Optional versioned pricing profiles and cost estimation are supported but not configured and never block work. |
| AST patch measurement | Patch payload bytes are compared with the source-file counterfactual in deterministic fixture telemetry. |

## Measured efficiency fixtures

| Fixture | Before | After | Reduction | Sufficiency |
| --- | ---: | ---: | ---: | --- |
| Narrow TSX context | 36,995 bytes | 10,191 bytes | 72.45% | Semantic sufficiency retained |
| Causal diagnostics | 2,694 bytes | 290 bytes | 89.24% | Causal diagnostics preserved |
| Approved skill slice | 14,090 bytes | 58 bytes | 99.59% | Checksum-bound, no semantic rewrite |
| Design candidates | 36 candidates | 8 candidates | 28 excluded | Paid/incompatible/duplicate filtering |
| AST patch payload | 36,995-byte source | 31-byte payload | 99.9162% counterfactual reduction | Applied |

## Acceptance G1–G64

All 64 acceptance criteria are recorded as `PASS` in the JSON evidence pack. The coverage is:

| Criteria | Evidence |
| --- | --- |
| G1–G8 | Canonical assembler, strict bundle, provenance/currentness, required-item blocking, budgets, and decision gate. |
| G9–G19 | TypeScript skeletons, checksum staleness, deterministic file/dependency selection, bounded snippets, AST-aware context, and patch measurement. |
| G20–G27 | Approved skill slicing/checksum integrity, Context7 slicing, design filtering, paid-candidate exclusion, and catalog bounds. |
| G28–G35 | Diagnostic slicing for TypeScript/ESLint/Vitest/Next/runtime plus bounded expansion. |
| G36–G41 | Deterministic LLM gate, in-flight deduplication, no broad semantic cache, and stable prefix identity. |
| G42–G49 | OpenAI actual usage fields, cached-token reporting, unavailable-cache state, no fake cache controls, optional pricing, and non-blocking cost estimation. |
| G50–G55 | Invocation metrics, deduplication, canonical precedence, repair delta, bounded reviewer context, and currentness avoidance. |
| G56–G60 | Measured TSX, diagnostic, skill, design, and AST-patch fixtures. |
| G61–G64 | Prohibited-architecture checks, no model/provider expansion, full regression validation, and explicit scope boundary. |

## Validation

- `npm run typecheck`: PASS
- `npm run lint`: PASS, with two pre-existing unused-variable warnings in implementation policy/validators
- `npm test`: PASS — 84 test files, 1,103 tests
- Phase 7G focused suite: PASS — 2 files, 85 tests
- `npm run test:reviewers`: PASS — 7 files, 77 tests
- `npm run build`: PASS on Next.js 16.2.12
- `npm run db:validate`: PASS — 2 migrations, no Phase 7G migration
- `npm run db:test-integrity`: PASS
- TaskGraph, Context7 synthetic, shadcn, backend, and generated-runtime smoke checks: PASS
- Customer Playwright smoke: not run; explicitly outside Phase 7G
- Codebase Memory real smoke: not run; explicit opt-in required
- Live AI smoke: no provider request was made; the existing script stopped at the `server-only` import boundary before request construction

## Reviewer closure

Architecture, Contract Auditor, Code/Integration, Security, and Test/Quality reviewers are all **APPROVED** as bounded read-only contract reviews. Each used the same candidate checksum and evidence manifest, with zero provider calls, no skill assignment, no source mutation, and current source checksums.

The Phase 7D verifier was extended only with an explicit later-phase drift allowlist for the provider-boundary files changed by Phase 7G. Its frozen candidate content and evidence references remain valid.

## Preservation and boundaries

No database or package-lock changes were made. No new runtime dependency, agent, model, provider, MCP, filesystem authority, writable VFS, vector database, embedding/RAG path, queue, worker, Redis, deployment, preview, customer E2E, or final-hardening behavior was added.

The initial untracked `.context7-cache/` and 14 historical Phase 7B admin files remain unstaged and preserved. Two ignored stale `.qa-foundation-*` directories were observed and left untouched; no active QA workspace was present at closure.

Phase 7G is frozen and complete. The next authorized boundary is the Final Hardening Audit.
