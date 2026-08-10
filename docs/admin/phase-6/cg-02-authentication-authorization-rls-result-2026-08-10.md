# Phase 6C — cg-02 Authentication, Authorization, and RLS

Status: **COMPLETE**

- Baseline: `9956fc5`
- Correction commit: `5014f7f` — `fix: enforce authenticated ownership boundaries`
- Group: `cg-02-authentication-authorization-rls`
- Root-cause confidence: **HIGH**

## Scope and root cause

The authoritative Phase 6A root cause was: make authenticated identity and user-scoped authorization mandatory before protected database behavior is considered valid. This affected generated customer project security contracts only; Factory metadata persistence, Factory migrations, and unrelated correction groups were untouched.

The trust boundary is server-side Supabase Auth identity → protected Server Action/Route Handler authorization → Postgres `user_id` ownership enforced by RLS.

The remaining CRITICAL finding `finding-233d7f1502c96cf535e1` belongs to cg-02 and is **RESOLVED**.

| Boundary | Before | After | Proof |
|---|---|---|---|
| Authentication | `getAuthenticatedUser()` returned `null`. | Server-only Supabase SSR client calls `auth.getUser()` and fails closed. | Backend regression tests; Security Reviewer APPROVED |
| Authorization | Protected handlers only parsed input. | Handlers re-check identity and compare database ownership with `user.id`. | Backend tests; Contract Auditor APPROVED |
| Ownership | No generated ownership column. | Non-null `user_id` references `auth.users(id)`. | Schema validator and template test |
| RLS | `auth.uid() is not null` allowed all authenticated rows. | Owner-only authenticated SELECT/INSERT/UPDATE/DELETE policies with `WITH CHECK` for writes. | RLS validator and targeted tests |
| Privileged access | No service-role bypass in baseline. | No service-role credential generated or used for ordinary requests. | Static boundary checks |

## Finding resolution

| Finding ID | Reviewer | Severity | Correction evidence | Reviewer verification | Final state |
|---|---|---|---|---|---|
| finding-0590fb313e72090696f0 | security-reviewer | ERROR | Server-side Supabase Auth with fail-closed handling | Security Reviewer; Contract Auditor | RESOLVED |
| finding-233d7f1502c96cf535e1 | security-reviewer | CRITICAL | Owner-only RLS policies using `auth.uid() = user_id` | Security Reviewer; Contract Auditor | RESOLVED |
| finding-7586dd5bd4661d954bf4 | security-reviewer | ERROR | `user_id uuid not null references auth.users(id)` | Security Reviewer; Contract Auditor | RESOLVED |
| finding-865697184809f419d1b7 | security-reviewer | WARNING | Explicit authenticated owner policies for all operations | Security Reviewer; Contract Auditor | RESOLVED |
| finding-c200a7f61e715bc94be1 | security-reviewer | ERROR | Canonical server-side session lookup | Security Reviewer; Contract Auditor | RESOLVED |
| finding-e055bfdcbad92c9b36eb | security-reviewer | ERROR | Auth check plus database owner comparison at each protected entry point | Security Reviewer; Contract Auditor | RESOLVED |

## Changes

- `src/agents/implementation/provider.ts`: corrected generated Auth, protected handler, ownership schema, and RLS templates.
- `src/agents/implementation/backend.ts`: wired deterministic security validation into backend proposal gates.
- `src/runtime/validation/security.ts`: added fail-closed, ownership, and RLS semantic checks.
- `src/agents/implementation/backend.test.ts`: added baseline regression and complete-contract tests.
- `scripts/backend-smoke.ts`: updated the existing smoke fixture for the ownership contract.
- `scripts/phase-6c-cg02-verification.ts`: reused existing production-provider verification infrastructure for the exact two required reviewer roles.

No Factory schema or migration changed. Generated customer policy templates changed only for `approved_records_select`, `approved_records_insert`, `approved_records_update`, and `approved_records_delete`. Factory DB remains 17/17 RLS-enabled tables with zero public policies.

## Verification

Targeted backend tests, backend smoke, schema/security validator, typecheck, lint, and database integrity passed. Full validation also passed: `67` test files / `814` tests, build, npm audit with `0` vulnerabilities, database status/verify, Docker Compose config, TaskGraph smoke with `releaseEligible=true`, and `git diff --check`. Lint reported only the three pre-existing warnings.

Required rechecks:

- Security Reviewer — `auth-storage-security-review`, `supabase-rls-1e36b217c969`: **RESOLVED**.
- Contract Auditor — `acceptance-criteria-80493e317476`, `requirements-evidence-traceability`: **RESOLVED**.

Two real GPT calls completed with zero provider failures. Evidence validated against current source checksums. Machine verification: `docs/admin/phase-6/cg-02-authentication-authorization-rls-verification-2026-08-10.json`.

Six cg-02 findings resolved; zero remain active, partial, or regressed. Correction-ready findings decreased from `30` to `24`; active CRITICAL decreased from `1` to `0`. Remaining counts: CRITICAL `0`, ERROR `9`, WARNING `14`, INFO `1`.

Newly unblocked groups: `cg-03-storage-ownership-controls`, `cg-04-provider-config-and-lifecycle`, `cg-05-design-durable-state-authority`, `cg-06-database-error-propagation`, and `cg-12-architecture-review-context`. The DAG recommends `cg-03-storage-ownership-controls` next. It was not started.
