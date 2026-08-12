# Phase 7C — Typed Task/Data Contracts + Database Decision

Status: COMPLETE
Candidate: `phase-7c-typed-contracts-2026-08-12`
Candidate checksum: `595f64a981512bda3f5616c742f379d4281af5b322dd5200f28202e08cdc42ce`
Baseline: Phase 7B COMPLETE at `e40b61348b87f149a0bdff2f431c655802ce0eae`
Implementation commit: `736cedee4c9ca6255bb6870ae8f92cd1cb5c5148`

Implemented the canonical Phase 7C contract package with strict, versioned, checksum-bound `DatabaseDecision`, `DataContract`, `TaskContract`, `DependencyProposal`, `PlanningAcceptance`, and aggregate package models. Database mode is limited to `NONE`, `SUPABASE_NEW`, and `SUPABASE_EXISTING`; only Supabase PostgreSQL is supported when persistence is required.

The Planner emits a recommendation only. User actions are explicit and persisted through the existing `workflow_documents` path: database approval, optional dependency approval, and planning acceptance. `NONE` carries no database credentials and rejects database tasks, migrations, persisted DataContracts, and database-scoped ChangeProposals. Existing/new modes expose only environment names, presence, connection status, and verification state; raw secrets are rejected and never enter implementation context.

TaskGraph creation binds current TaskContracts and persists the contract-package revision. Implementation context and ChangeProposal carry only checksum-bound contract metadata. START_IMPLEMENTATION reloads the current package and requires current planning/dependency acceptance, architecture and Contract Audit approval, design selection, current task bindings, and READY database connection status where applicable.

## Acceptance C1–C40

| ID | Result | Evidence |
|---|---|---|
| C1 | PASS | Strict DataContract; persisted data requires DatabaseDecision reference. |
| C2 | PASS | Strict TaskContract and deterministic binding. |
| C3 | PASS | Strict DatabaseDecision and canonical modes. |
| C4 | PASS | Strict DependencyProposal and four classes. |
| C5 | PASS | Version, checksum, and currentness validation. |
| C6 | PASS | NONE has no DB provider, credentials, or requirements. |
| C7 | PASS | Planner recommendation is not approval. |
| C8 | PASS | User identity/time required for database approval. |
| C9 | PASS | Approval binds exact decision checksum. |
| C10 | PASS | Material changes become stale. |
| C11 | PASS | Database connection must be READY. |
| C12 | PASS | Missing SUPABASE_NEW metadata blocks start. |
| C13 | PASS | NONE has no database credential metadata. |
| C14 | PASS | NONE rejects DB implementation paths. |
| C15 | PASS | Raw secret fields/values are rejected. |
| C16 | PASS | GPT/implementation context receives safe metadata only. |
| C17 | PASS | Presence/status/verification are typed separately. |
| C18 | PASS | Auth/storage remain independent. |
| C19 | PASS | Persisted DataContracts bind current DB decision. |
| C20 | PASS | DB TaskContracts bind ID/checksum. |
| C21 | PASS | Phase7C TaskGraph binds every generated task. |
| C22 | PASS | No tool/skill/capability/scope/artifact escalation. |
| C23 | PASS | Requirement-to-validation traceability is typed. |
| C24 | PASS | Dependency Authority remains package authority. |
| C25 | PASS | Optional dependency approvals are explicit. |
| C26 | PASS | Foundation dependencies require no approval spam. |
| C27 | PASS | Undeclared/forbidden dependencies are rejected. |
| C28 | PASS | Planning/dependency approvals are currentness-bound. |
| C29 | PASS | TaskGraph carries contract/package checksums. |
| C30 | PASS | ChangeProposal binds TaskContract/DB metadata. |
| C31 | PASS | Unplanned files remain outside task scope. |
| C32 | PASS | Stale contracts/approvals block gates. |
| C33 | PASS | Package persistence round-trip is stable. |
| C34 | PASS | Secret/tamper/checksum tests pass. |
| C35 | PASS | Machine identifiers are separate from labels. |
| C36 | PASS | Existing workflow and reviewer tests remain green. |
| C37 | PASS | All deterministic validation gates pass. |
| C38 | PASS | Evidence pack is checksum-bound and validated. |
| C39 | PASS | Architecture, Contract, Security, and Test/Quality suites approve. |
| C40 | PASS | No Phase 7D/7E, customer E2E, or deployment executed. |

## Validation evidence

- `npx vitest run src/domain/contracts/phase7c.test.ts`: 10 passed.
- `npm test`: 73 files, 903 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: 0 errors; 3 pre-existing unused-helper warnings.
- `npm run build`: passed on Next.js 16.2.12.
- `npm run test:reviewers`: 77 tests passed.
- Migration validation/integrity, TaskGraph smoke, backend smoke, and live DB verification passed.
- Factory DB remained unchanged: 17 tables verified, RLS 17/17, public policies 0.

Next: Phase 7D controlled AST-aware patching. Do not execute it as part of Phase 7C.
