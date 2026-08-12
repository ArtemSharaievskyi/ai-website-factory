# Phase 7D — Controlled AST-Aware Patching

Status: **COMPLETE**  
Recorded: 2026-08-12  
Candidate: `phase-7d-controlled-ast-patching-2026-08-12`  
Candidate checksum: `694a62684a412a5886080e9baad1eadf75a9a81cc255b2e95dcb51cb14f752fb`  
Implementation commit: `eb9295f6b324b2411bdebe9f92c75a643aaba0b5`  
Baseline parent: `35bd11b4a123c230edbaa66f77945b62b85093ab`

## Outcome

Phase 7D adds a typed, bounded `AST_PATCH_EXISTING` operation for existing `.ts` and `.tsx` files. The TypeScript compiler API performs structural lookup; the host applies narrow source-span edits, reparses the complete result, verifies the exact expected-result checksum, and records bounded evidence.

The existing `ImplementationChangeProposal` → `AtomicChangeApplier` transaction remains the sole mutation authority. `controlled-edit:ast-patch` is a typed capability marker and host adapter only. No generic filesystem, shell, second mutation executor, new dependency, new agent, new reviewer, or new MCP was added. Reviewers remain read-only.

## Contract and safety closure

- Contract: [ast-patching.ts](../../src/domain/implementation/ast-patching.ts:3) defines operation version `1.0.0`, strict selectors, patch kinds, checksums, bounded payloads, and bounded evidence.
- Structural host: [ast-patch-executor.ts](../../src/agents/implementation/ast-patch-executor.ts:57) parses with the TypeScript compiler API, rejects missing/ambiguous/fingerprint-mismatched targets, supports six narrow patch kinds, preserves untouched spans, and validates the complete result.
- Authority: [applier.ts](../../src/agents/implementation/applier.ts:28) enforces current role/tool/capability/task/TaskGraph/contract identity, paths, scopes, dependencies, DatabaseDecision `NONE`, atomic transaction, rollback, cancellation, idempotency, and result checksums.
- Context and transport: [contracts.ts](../../src/agents/implementation/contracts.ts:17), [policy.ts](../../src/agents/implementation/policy.ts:493), and [adapters.ts](../../src/integrations/openai/adapters.ts:123) bind the strategy to current structural context and strict provider transport.
- Capability boundary: [registry.ts](../../src/orchestration/tooling/registry.ts:95) and [tooling adapters](../../src/orchestration/tooling/adapters.ts:20) expose only the typed controlled-edit operation and identifier/evidence metadata.

Supported patch kinds are `REPLACE_NODE_BODY`, `INSERT_BEFORE_NODE`, `INSERT_AFTER_NODE`, `ADD_NAMED_IMPORT`, `REMOVE_IMPORT_SPECIFIER`, and `ADD_OBJECT_PROPERTY`. Selectors are function, arrow-function, variable, object-property, import-declaration, import-specifier, and class-method. Payloads are limited to 32,000 UTF-8 bytes and eight operations per proposal.

## Acceptance reconciliation

All D1–D40 acceptance items are `PASS`. The machine-readable item-level references and summaries are in the accompanying [JSON result](phase-7d-controlled-ast-aware-patching-result-2026-08-12.json). The closure validator [phase7d-evidence.test.ts](../../src/operations/phase7d-evidence.test.ts:1) verifies the 22-file frozen manifest, exact per-file SHA-256 values, D1–D40 completeness, and every repository-relative evidence reference.

| Acceptance range | Result | Evidence focus |
|---|---:|---|
| D1–D4 | PASS | Strict versioned contract, closed selector union, checksums, bounded evidence |
| D5–D9 | PASS | Compiler-API parsing, structural lookup, span edits, ambiguity handling, bounded context |
| D10–D18 | PASS | Task/currentness, role/capability, scope, dependency, security, transaction, rollback, idempotency |
| D19–D24 | PASS | Complete-file parse validation, CRLF preservation, imports, object properties, malformed input, bounds |
| D25–D30 | PASS | Legacy proposal compatibility, service persistence, policy/context, strict provider and registry/host boundary |
| D31–D35 | PASS | Implementation-only capability and read-only architecture, contract, code, security, and quality reviewers |
| D36–D40 | PASS | Documentation, focused tests, registry alignment, persisted evidence, final atomic/security compatibility closure |

## Validation evidence

Pre-freeze candidate validation passed:

- `npm run typecheck`
- `npm run lint` — 0 errors, 2 pre-existing warnings
- `npm test -- --run` — 74 files, 909 tests
- focused AST suite — 8 tests
- `npm run build` — Next.js 16.2.12
- `npm run test:reviewers` — 7 files, 77 tests
- `npm run db:validate` — 2 migrations
- `npm run db:test-integrity`
- `npm run taskgraph:smoke` — release eligible, 6 tasks, 0 repairs
- `npm run backend:smoke`
- `npm run generated:runtime-smoke`
- `git diff --check`

The closure rerun adds the deterministic evidence validator and passes with 75 test files and 912 tests, plus typecheck, lint, and diff checks. The candidate manifest remained unchanged during validation.

Reviewer evidence is repository-suite evidence only: Architecture, Contract, Code / Integration, Security, and Test / Quality suites passed. No fresh GPT reviewer call is claimed (`freshGptReviewerCalls: 0`).

New dependencies: none. Factory database schema and security model: unchanged. Adjacent findings: none. Existing `.context7-cache/` and 14 historical Phase 7B admin files were preserved as pre-existing untracked content.

Phase 7E is deferred and was not executed.
