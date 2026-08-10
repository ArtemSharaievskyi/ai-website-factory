# Phase 6I cg-08 result: Context7 authority

Status: COMPLETE

## Finding and root cause

Finding `finding-20662816cdabed08871f` is a WARNING from the Architecture Reviewer, category `SOURCE_OF_TRUTH`. Context7 eligibility was governed by multiple independently maintained lists: `policy.ts` owned the approved package allowlist, while `service.ts` maintained a separate `fixedStack`; the public resolution input also accepted caller-provided `fixedStack` values.

The affected consumer is `Context7Service.resolveLibrary`. This is an eligibility source-of-truth defect, not a Context7 prompt-authority, tool-permission, or project-state defect.

## Reproduction and correction

Before correction, resolving the policy-approved package `@supabase/supabase-js` without a dependency plan returned `CONTEXT7_LIBRARY_NOT_PLANNED`, because the service-local fixed stack omitted it. The policy allowlist accepted the package, demonstrating the drift.

After correction, `APPROVED_CONTEXT7_PACKAGES` in `policy.ts` is the single eligibility source. The service-local fixed stack was removed, and `fixedStack` was removed from `Context7ResolutionInput`, preventing callers from supplying an alternate eligibility list. Dependency-plan, package.json, and configured-version resolution remains separate and unchanged.

| Information / action | Canonical authority | Context7 role | Can Context7 override? |
| --- | --- | --- | --- |
| Package eligibility | `APPROVED_CONTEXT7_PACKAGES` | Read-only eligibility check | No |
| Version | Accepted dependency plan, package.json, configured version | Version-aware documentation lookup | No |
| Requirements, architecture, Design, TaskGraph | Existing Factory/project artifacts | None | No |
| Tool permissions and file scope | AgentDefinition and task policy | None | No |
| Library API facts | Resolved Context7 library and bounded excerpts | Supplemental technical evidence | No |

Context7 remains optional, read-only, bounded, and version-aware. No new integration, fallback web source, MCP, permission, scope, or canonical-state mutation was added.

## Version, provenance, cache, and safety behavior

Package identity remains bound as `packageName` to `resolvedLibraryId`; no similarly named package fallback was introduced. Version mismatch still raises `CONTEXT7_VERSION_CONFLICT`, and unresolved versions remain explicitly unresolved. Normalized excerpts retain source references and content checksums.

The existing cache remains a transient optimization keyed by package, resolved library, version, topic, and symbol. It is not canonical state or eligibility authority. The Context7 tests created one ignored `.context7-cache` file; that exact test-owned file was removed after validation and no cache file was committed. Existing suspicious-documentation rejection remains unchanged, so retrieved text cannot become instruction authority.

## Verification

Added a deterministic regression proving that the policy-approved Supabase package resolves without caller-provided fixed-stack input while `prisma` remains rejected. The targeted Context7 suite passed 8/8; the synthetic Context7 smoke passed with one bounded excerpt; typecheck passed.

Required reviewer rechecks passed with valid evidence:

- Architecture Reviewer: RESOLVED / APPROVED, 1 real GPT call.
- Code / Integration Reviewer: RESOLVED / APPROVED, 1 real GPT call.

Full validation passed: 69 test files and 831 tests, lint with only the three known pre-existing warnings, typecheck, build, npm audit with 0 vulnerabilities, database validation/status/verify/integrity, Docker Compose config, TaskGraph smoke with `releaseEligible=true`, and `git diff --check`. No intentional customer website-generation E2E was run.

Production correction commit: `ca0583d` (`fix: centralize Context7 eligibility policy`).

## Phase state

The resolved warning leaves 15 correction-ready findings: 0 CRITICAL, 5 ERROR, 9 WARNING, and 1 INFO. No groups became newly unblocked because cg-08 has no downstream dependency edge in the current DAG. The next recommended group is `cg-09-project-memory-durability`; it was not started.
