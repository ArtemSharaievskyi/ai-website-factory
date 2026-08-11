# Phase 6K / cg-12 — Architecture Review Context

Status: **COMPLETE**

Baseline: `ee5f622` (clean worktree)

Correction commit: `e2a1963` — `fix: preserve complete architecture review context`

State/report closure commit: this closure artifact commit.

## Contract and findings

| Field | Value |
|---|---|
| Group | `cg-12-architecture-review-context` |
| Title | Complete architecture review context and evidence contract |
| Root cause | The normal Architecture Reviewer had the full typed Brief/Planning input, but its canonical evidence allowlist omitted material approved Brief obligations; semantic reuse also omitted bounded constraints and fixed policy. Factory self-review lacked an explicit documentation-only boundary. |
| Confidence | HIGH |
| Risk | MEDIUM |
| Dependency | `cg-01-cross-artifact-identity` — COMPLETE |
| Highest severity | ERROR |

| Finding ID | Reviewer | Category | Original/current severity | Final state |
|---|---|---|---|---|
| `finding-0e21399a0a91b82a05dc` | Contract Auditor | `REQUIREMENT_NOT_TRACED` | ERROR / ERROR | RESOLVED |
| `finding-2484a19307c1536e12e7` | Architecture Reviewer | `REQUIREMENT_TRACEABILITY` | INFO / INFO | RESOLVED |

## Review path and reproduction

This was a shared boundary with two distinct paths:

| Review path | Stage | Allowed context | Forbidden/unnecessary context |
|---|---|---|---|
| Normal project-generation review | Planning Acceptance → ARCHITECTURE_REVIEW → Design | Approved Brief, accepted PlanningPackage, project/version/checksums, fixed policy, bounded constraints, selected procedural skills | Design, TaskGraph, implementation source, unrestricted memory, Context7/Codebase Memory |
| Factory self-review | Phase 5/6 repository evidence-pack review | Bounded current Factory source/docs slices and selected procedures | Project-specific requirement claims without a Brief/PlanningPackage; customer source as normal-review evidence |

Before correction, the smallest deterministic check showed a canonical evidence set of 25 references and missing `brief:contentRequirements`, `brief:seoRequirements`, `brief:localization`, `brief:userRoles`, `brief:userAcceptanceCriteria`, `brief:explicitExclusions`, and `brief:unresolvedItems`. The new regression then exercised the real service boundary: a provider result citing `brief:contentRequirements` failed with `ARCHITECTURE_REVIEW_OUTPUT_INVALID` / “Review references invented evidence.”

## Context contract

| Context item | Before | After | Authority | Identity relevant? | Required? |
|---|---|---|---|---|---|
| Approved Brief | Typed and checksum-checked, but only a subset was citable | All material requirement fields are canonical evidence | Canonical | Yes, via checksum | Yes |
| PlanningPackage | Typed, accepted, checksum-checked | Identity, acceptance, architecture, and dynamic decision references are canonical | Canonical | Yes, via checksum | Yes |
| Project identity/version | Deterministically checked | Preserved and verified before provider work | Canonical | Yes | Yes |
| Fixed architecture policy | Validated but absent from idempotency hash | Validated and included in semantic identity | Canonical | Yes | Yes |
| Bounded project constraints | Supplied to provider but absent from identity | Supplied and included in semantic identity | Canonical | Yes | Yes when present |
| Selected reviewer skills | Resolver-selected, checksum-bound | Same resolver-selected supplemental procedures | Supplemental | Yes, selected identity only | Role-dependent |
| Context7 | Not part of normal Architecture Review | Remains excluded/supplemental only; no authority change | Supplemental external docs | No | No |
| Codebase Memory | Not part of normal Architecture Review | Remains excluded; no permission change | Read-only structural integration | No | No |
| Source slices | Excluded from normal review | Still excluded from normal review; only bounded verifier slices support cg-12 evidence | Supplemental verification evidence | Candidate-bound in verifier | No for normal gate |
| Factory self-review pack | Did not state its missing project artifacts | Explicitly documentation-only and non-substitutive | Separate self-review contract | Self-review snapshot only | No project gate |

Canonical evidence now includes the Brief’s content, SEO, localization, roles, acceptance criteria, exclusions, storage/email/administration decisions, unresolved items, identity, approval, and remaining typed fields, plus accepted Planning identity/acceptance/architecture references. Invented references remain rejected.

## Identity and currentness

| Context change | Should invalidate? | Before behavior | After behavior | Proof |
|---|---|---|---|---|
| Approved Brief or Planning checksum | Yes | Already part of identity | Preserved | Existing strict checksum/idempotency path |
| Bounded project constraint | Yes | Could reuse old result | Idempotency conflict | New architecture regression |
| Fixed architecture policy | Yes | Could reuse old result | Included in identity | Service hash correction |
| Operational `expectedRowVersion` | No semantic invalidation | Not in identity | Still not in identity | New stability assertion |
| Wrong project/version artifact | Reject before provider | Deterministic precheck | Preserved | Existing stale/mismatch regression |
| Selected approved skill checksum | Yes when selected | Existing resolver identity | Preserved | Existing skill identity behavior |

Review reuse remains idempotent for the same semantic context; relevant changes cannot reuse the prior result, and historical records remain immutable.

## Implementation and scope

| File | Change | Why required |
|---|---|---|
| `src/agents/reviewers/architecture/deterministic.ts` | Expanded canonical Brief/Planning evidence references | Corrects the exact evidence contract defect |
| `src/agents/reviewers/architecture/service.ts` | Added fixed policy and bounded constraints to review identity | Prevents stale semantic reuse |
| `src/agents/reviewers/architecture/architecture.test.ts` | Added material-evidence and currentness regressions | Proves positive, negative, relevant-change, and irrelevant-change behavior |
| `docs/architecture/architecture-reviewer.md` | Documents complete evidence and normal/self-review separation | Resolves the documentation-only self-review traceability finding |
| `scripts/phase-6c-cg02-verification.ts` | Added cg-12 configuration to the existing verifier | Reuses the required Phase 6 verifier; no new pipeline/client |

The machine-plan likely files were changed for the production correction. The one path outside that list, `scripts/phase-6c-cg02-verification.ts`, was required by Task 79 to reuse the existing Phase 6 verifier: it adds only the cg-12 configuration, bounded evidence slices, closure question, and dispatcher entry. No new pipeline/client was created. No DB schema/migration, Project Memory architecture, agent catalog, tool permission, reviewer role, orchestrator, MCP, Context7 authority, or Codebase Memory authority changed.

## Skills, bounds, and authority

The representative Architecture Reviewer recheck selected `architecture-tradeoff-review`, `module-boundaries-fb20497b5c35`, and `review-maintainability-d9faf7cb9775`; the Contract Auditor selected `acceptance-criteria-80493e317476` and `requirements-evidence-traceability`. Source Markdown sizes were 10,495 and 7,161 bytes respectively (17,656 total before prompt serialization). All skills remained supplemental procedures, not evidence or tools; all Architecture skills were not injected indiscriminately.

The Architecture Reviewer remains read-only with OpenAI-only tool permission. Context7 remains supplemental technical documentation and Codebase Memory remains excluded from this normal review. Approved external skills remain 4, approved internal skills 13, unique approved artifacts 17, assignment references 18, agents 9, and deferred skill usage 0.

## Reviewer verification

Required and actual rechecks were exactly:

| Reviewer | State | Verdict | Structured output | Evidence | Real GPT calls |
|---|---|---|---|---|---:|
| Architecture Reviewer | RESOLVED | APPROVED | PASS | PASS | 1 |
| Contract Auditor | RESOLVED | APPROVED | PASS | PASS | 1 |

The shared verifier used current candidate-bound source slices, resolver-approved skills, strict output schemas, and no raw prompts or chain-of-thought. Total real GPT calls: 2. Verification artifact: `cg-12-architecture-review-context-verification-2026-08-11.json`.

## Validation

| Check | Result |
|---|---|
| cg-12 reproduction before correction | Fails as expected: material Brief evidence was rejected as invented |
| Required Brief evidence | PASS |
| Excluded context | PASS |
| Project identity/version | PASS |
| Artifact checksum/currentness | PASS |
| Relevant-change invalidation | PASS |
| Irrelevant-change non-invalidation | PASS |
| Targeted Architecture Reviewer tests | 14 passed |
| Full tests | 69 files / 837 tests passed |
| ESLint | PASS; 3 known pre-existing warnings only |
| TypeScript | PASS |
| Build | PASS |
| npm audit | 0 vulnerabilities |
| Database validation/status/verify/integrity | PASS |
| Docker Compose config | PASS |
| TaskGraph | PASS; `releaseEligible=true` |
| `git diff --check` | PASS |
| Customer website-generation E2E | NOT RUN intentionally |

The first parallel full-suite attempt encountered a build/test ordering race (2 QA tests saw no `.next/BUILD_ID` while the build was still running); after running build first, the mandated full suite passed completely. No customer website-generation E2E was intentionally run.

QA directories: 14 before targeted work, 15 after validation. Historical QA cleanup: none. The one transient `.context7-cache` file was removed and no cache content is committed.

## Findings, counts, and DAG

Both cg-12 findings are RESOLVED: resolved 2, partial 0, still active 0, regression found 0. Only cg-12 findings were closed. Remaining findings are 12 total: 0 CRITICAL, 4 ERROR, 8 WARNING, 0 INFO. No other correction group was modified or auto-resolved.

Newly unblocked groups are `cg-13-reviewer-execution-evidence`, `cg-15-persistence-migration-evidence`, `cg-10-design-request-isolation`, `cg-11-codebase-index-identity`, and `cg-17-design-gate-evidence`. The actual next recommendation is `cg-13-reviewer-execution-evidence`, selected by the current DAG’s severity/order calculation. It was not started.

## Artifacts and closure

- Machine result: `docs/admin/phase-6/cg-12-architecture-review-context-result-2026-08-11.json`
- Human report: `docs/admin/phase-6/cg-12-architecture-review-context-result-2026-08-11.md`
- Reviewer verification: `docs/admin/phase-6/cg-12-architecture-review-context-verification-2026-08-11.json/.md`
- Successor state: `docs/admin/phase-6/phase-6-execution-state-2026-08-11-cg12-result.json`
- Roadmap/state update: yes; cg-12 is COMPLETE and cg-13 is next. Historical state artifacts are preserved.

PHASE 6K / cg-12: COMPLETE
NEXT: cg-13-reviewer-execution-evidence
