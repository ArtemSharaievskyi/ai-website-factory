# Phase 7B Revision 2 Plan

Status: ready for a bounded future implementation turn. This run executes zero groups.

Source reconciliation: [phase-7b-semantic-reconciliation-2026-08-11.json](phase-7b-semantic-reconciliation-2026-08-11.json)

## Next group

`R2-G1-HOST_CONTEXT_AUTHENTICITY`

The host context is the authority root, so it must be addressed before the downstream external-result group. Execute only this group in the next authorized turn.

## Groups

| Group | Findings | Defect class | Risk | Dependencies | Reviewers | Budget |
|---|---|---|---|---|---|---|
| `R2-G1-HOST_CONTEXT_AUTHENTICITY` | `7b-sec-001` | Security boundary defect | High | None | Architecture, Security | 1 implementation cycle |
| `R2-G2-EXTERNAL_RESULT_BOUNDARY` | `7b-sec-002`, `7b-sec-004` | Security boundary defect | High | After G1 | Security, Code / Integration, Test / Quality | 1 implementation cycle |
| `R2-G3-EVIDENCE_COMPLETENESS` | `contract-audit-001`, `tqr-7b-003` | Review/test evidence gap | Medium | Independent | Contract, Test / Quality | 1 implementation cycle |

The DAG is `G1 -> G2`; G3 is independent. At most two groups may execute before another reconciliation.

## Group acceptance criteria

### R2-G1-HOST_CONTEXT_AUTHENTICITY

Current defect: exported `createToolHostContext` accepts caller-supplied scope and trusted executor identities. Its brand proves construction through the exported function, not host provenance.

Required proof:

- only a host-owned binding can create usable authority context;
- caller-supplied identity cannot authorize an operation;
- unregistered executors, stale project/task/workspace scope, and permission mismatches remain fail-closed;
- no generic shell, Filesystem MCP, direct mutation tool, new agent, or widened permission path is introduced;
- focused negative tests, full tests, typecheck, lint, build, audit, and diff checks pass;
- Architecture and Security rechecks approve.

### R2-G2-EXTERNAL_RESULT_BOUNDARY

Current defect: `registeredOutputToToolResult` serializes before its size/schema bound, and regex redaction is not guaranteed to cover quoted JSON secret keys.

Required proof:

- oversized and cyclic values fail safely without unbounded pre-validation materialization;
- common JSON-key and token/private-key secrets are redacted;
- all external adapters remain schema-validated and `UNTRUSTED_EXTERNAL`;
- bounded result tests and deterministic gates pass;
- Security, Code / Integration, and Test / Quality rechecks approve.

### R2-G3-EVIDENCE_COMPLETENESS

Current defect: the final semantic review identity/source snapshot was not persisted, and the focused test does not invoke the generated TaskGraph builder.

Required proof:

- persisted review identity, reviewer roles, model/provider, selected skill checksums, and source/evidence checksums exist;
- the generated graph path is exercised and proves capabilities, aliases, allowed/denied policy, and legacy compatibility;
- no customer-project lineage identifiers are invented;
- Contract and Test / Quality rechecks accept the evidence.

## Scope and invariants

Included: Phase 7B typed tools, host-owned operations, permission intersections, deterministic policy, bounded/redacted results, currentness/cancellation, and closure evidence.

Excluded: customer generation E2E, Phase 7C typed task/data contracts, Phase 7D AST patching, Phase 7E QA cleanup, deployment, preview, new agents, new skills, Filesystem MCP, unrestricted shell, and direct write-file/edit-file mutation paths.

Preserve nine agents, one Implementation Agent, skills as procedures only, ChangeProposal as write authority, Dependency Authority, Phase 6 COMPLETE with 0 findings, Phase 7A COMPLETE, and the existing no-generic-shell/no-Filesystem-MCP boundaries.

Phase 7B closes only after all three valid groups are resolved, deterministic gates are green, the relevant reviewer rechecks approve, and a fresh authorized semantic closure review has no valid blocker. Phase 7C remains unopened.
