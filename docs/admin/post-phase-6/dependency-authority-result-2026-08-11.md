# Phase 7A - Dependency Authority Result

Status: **BLOCKED**

Baseline HEAD: `6cad175`
Production/test correction commit: `fa6e8fd`
Policy version: `generated-dependency-authority-v1`
Canonical authority: `src/dependencies/authority.ts` (`DEPENDENCY_CATALOG`)

## Why this is blocked

The deterministic implementation is complete and all local gates are green, but the flow requires five bounded semantic reviewer rechecks. This workspace has no `OPENAI_MODEL` or `OPENAI_API_KEY`, so those calls were not fabricated or represented as approvals. The repository also has no owned direct version specifications for the currently documented optional Supabase, React Hook Form, Motion, or `@playwright/test` capability packages. The catalog therefore contains zero optional packages and refuses them deterministically rather than inventing versions.

The correct next action is to correct or replan Dependency Authority with deliberate optional catalog entries and then execute the five required read-only reviewer rechecks.

## Authority table

| Question | Canonical authority | AI may override? | Evidence |
| --- | --- | --- | --- |
| Package permitted globally? | `DEPENDENCY_CATALOG` | No | `src/dependencies/authority.ts` |
| Package needed by this project? | Current accepted Planning dependency intent | No | Planner validation and checksum-bound implementation input |
| Task may introduce it? | Current TaskGraph/task capability plus plan | No | `DependencyAuthorityContext` and task boundary |
| Version spec? | Catalog entry | No | Exact spec comparison |
| Manifest acceptance? | `validateGeneratedPackageManifest` | No | ChangeProposal and runtime validation |
| Lockfile? | npm materializer | No | AI package-lock edits rejected; direct root checked |
| Transitives? | npm lockfile | No direct allowlist | Transitive fixture passes |
| Security result? | npm audit and deterministic runtime gates | No | `npm audit --audit-level=high` |

## Current direct catalog

| Package | Approved spec | Class | Allowed context |
| --- | --- | --- | --- |
| `next` | `16.2.12` | `BASELINE_REQUIRED` | generated runtime |
| `react` | `19.2.4` | `BASELINE_REQUIRED` | generated runtime |
| `react-dom` | `19.2.4` | `BASELINE_REQUIRED` | generated runtime |
| `server-only` | `^0.0.1` | `BASELINE_REQUIRED` | generated server boundary |
| `zod` | `^4.4.3` | `BASELINE_REQUIRED` | generated validation |
| `@tailwindcss/postcss` | `^4` | `BASELINE_REQUIRED` | generated styling build |
| `@types/node` | `^20` | `BASELINE_REQUIRED` | generated TypeScript |
| `@types/react` | `^19` | `BASELINE_REQUIRED` | generated TypeScript |
| `@types/react-dom` | `^19` | `BASELINE_REQUIRED` | generated TypeScript |
| `eslint` | `^9` | `BASELINE_REQUIRED` | generated lint |
| `eslint-config-next` | `16.2.12` | `BASELINE_REQUIRED` | generated Next lint |
| `playwright` | `^1.62.1` | `BASELINE_REQUIRED` | generated validation |
| `tailwindcss` | `^4` | `BASELINE_REQUIRED` | generated styling build |
| `typescript` | `^5` | `BASELINE_REQUIRED` | generated typecheck |
| `vitest` | `^3.2.4` | `BASELINE_REQUIRED` | generated tests |

Baseline count: 15. Optional approved count: 0. Factory-only root dependencies were not copied.

## Role boundaries

- Planner may express typed dependency intent, but acceptance deterministically rejects names or architecture dependencies absent from the host catalog.
- Implementation receives a narrow baseline/current-plan context. It cannot self-expand authority; stale accepted Planning is rejected before execution.
- ChangeProposal validation checks `package.json` before atomic apply and rejects `package-lock.json` operations.
- `package.json` is an output manifest, not policy authority. `package-lock.json` is npm/materializer-owned and its v3 root direct declarations must match the authorized manifest.
- Transitive packages do not need direct catalog entries; npm resolves them under the authorized direct manifest and lockfile, followed by build/tests/audit gates.
- Context7, skills, Codebase Memory, shadcn metadata, and admin reports cannot grant direct package authority.

## Bypass table

| Attempt | Expected | Result |
| --- | --- | --- |
| Unknown package | Deny | PASS: `PACKAGE_NOT_APPROVED` |
| Typo package | Deny without correction | PASS: `PACKAGE_NOT_APPROVED` |
| Wrong version | Deny | PASS: `VERSION_NOT_APPROVED` |
| `latest`, `next`, `beta`, `canary` | Deny | PASS: `UNSUPPORTED_PACKAGE_SPEC` |
| Git, URL, file, link, workspace, npm alias | Deny | PASS: `UNSUPPORTED_PACKAGE_SPEC` |
| Wrong dependency section | Deny | PASS: `DEPENDENCY_SECTION_NOT_ALLOWED` |
| Baseline removal | Deny | PASS: `BASELINE_DEPENDENCY_REQUIRED` |
| Direct unknown `package.json` edit | Deny before apply | PASS: `UNAPPROVED_DEPENDENCY` mapping |
| Direct `package-lock.json` edit | Deny as AI authority | PASS: `IMPLEMENTATION_FORBIDDEN_FILE` |
| `npm install unapproved-package` | Deny/no network | PASS: no arbitrary npm argument path exists |
| Unknown shadcn dependency | Deny | PASS: `SHADCN_UNAPPROVED_DEPENDENCY` |
| Uncataloged optional package | Deny | PASS fail-closed; no optional entry exists |
| Transitive package absent from direct catalog | Allow when lockfile is valid | PASS: transitive fixture accepted |

Optional-approved, approved-but-unplanned, and cross-project optional vectors are not certifiable until the catalog has an owned optional entry. Project/version/checksum identity enforcement remains at the existing Implementation boundary.

## Review table

| Reviewer | Scope | Fresh calls | Verdict | Evidence valid |
| --- | --- | ---: | --- | --- |
| Architecture Reviewer | Single direct-dependency authority and non-authority separation | 0 | NOT RUN - provider unavailable | No |
| Contract Auditor | Catalog, project plan, task permission, manifest, lockfile traceability | 0 | NOT RUN - provider unavailable | No |
| Code / Integration Reviewer | Planner, ChangeProposal, manifest, npm runtime, lockfile | 0 | NOT RUN - provider unavailable | No |
| Security Reviewer | Dependency bypasses and shell/npm/shadcn paths | 0 | NOT RUN - provider unavailable | No |
| Test / Quality Reviewer | Allow/deny/stale/isolation/bypass/transitive proof | 0 | NOT RUN - provider unavailable | No |

The existing deterministic reviewer suite still passes: `npm run test:reviewers`, 7 files and 77 tests.

## Validation table

| Check | Result |
| --- | --- |
| Targeted authority/planner/implementation/runtime/shadcn/currentness suites | PASS; all listed commands passed |
| Full tests | PASS; 71 files, 856 tests |
| Lint | PASS; 0 errors, same 3 known warnings |
| Typecheck | PASS |
| Build | PASS |
| npm audit | PASS; 0 vulnerabilities |
| DB validation/status/verify/integrity | PASS |
| Docker compose config | PASS |
| TaskGraph smoke | PASS; 6 tasks, 0 repairs, no network/npm/browser |
| `git diff --check` | PASS |
| `.qa-foundation-*` | 16 before, after targeted, and after full validation; no cleanup |
| `.context7-cache/` | Untracked and unstaged; never committed |
| Customer website-generation E2E/deployment | Not run |

## Change table

| Area | Change | Why required |
| --- | --- | --- |
| `src/dependencies/authority.ts` | Added typed catalog, decisions, manifest and lockfile validation | Establish one host-owned direct dependency authority |
| Generated foundation policy | Derives baseline specs from the catalog | Remove duplicate version authority |
| Planner/OpenAI context | Adds bounded catalog guidance and acceptance validation | Prevent invented Planner package names/specs |
| Implementation/applier/validators/service | Binds current plan and validates package mutations before apply | Prevent self-expansion and package.json bypass |
| Runtime/production adapters | Validates manifests/lockfiles and carries plan context into fixed npm paths | Preserve npm-only materialization and currentness |
| Authority tests/foundation fixture | Proves allow/deny/lockfile/transitive behavior and updates empty fixture to canonical baseline | Preserve the baseline invariant |

No Factory npm dependencies were added, no generated package versions were upgraded, no agents/reviewers/MCPs were added, no database migration was added, and no historical QA directories were cleaned.

## Phase state

Phase 6 remains `COMPLETE` with `0` findings. Phase 7A is `BLOCKED` until optional version authority is deliberately supplied and all five required semantic reviewer rechecks produce valid approvals.

PHASE 7A - DEPENDENCY AUTHORITY: BLOCKED
NEXT: CORRECT OR REPLAN DEPENDENCY AUTHORITY
