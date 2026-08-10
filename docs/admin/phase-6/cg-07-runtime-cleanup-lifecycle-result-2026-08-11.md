# Phase 6H cg-07 result: runtime cleanup lifecycle

Status: COMPLETE

## Finding and root cause

Finding `finding-517e635c9c23995687d8` is a WARNING from the Code / Integration Reviewer, category `ERROR_HANDLING`. The Factory E2E script created a production runtime and released it only after successful report persistence. Exceptions during runtime validation, resume loading, E2E stage execution, or report writing could therefore leave the runtime open.

The exact runtime domain is `FACTORY_E2E_RUNTIME`. The affected owned resource is the Factory production runtime handle, whose implemented close contract ends its runtime-owned PostgreSQL pool. This finding does not concern `.qa-foundation-*` directories, generated project cleanup, browsers, ports, locks, or child-process trees.

## Reproduction and correction

The baseline source at `fa7801c` showed runtime creation before the post-creation operation and `runtime.close()` only after report persistence, without a `try/finally`. A controlled post-creation failure makes that success-path close unreachable. No real provider-backed E2E was invoked during reproduction.

The correction adds a small `withRuntimeLifecycle` boundary. The existing validation, resume loading, E2E execution, report writing, output, and opt-in behavior remain inside the operation callback; the helper awaits `runtime.close()` in `finally`. The original error still propagates to the existing safe outer handler.

## Resource lifecycle

| Resource | Created by | Owner | Release condition | Before | After | Proof |
| --- | --- | --- | --- | --- | --- | --- |
| Factory production runtime / PostgreSQL pool | `createProductionFactoryRuntime` | `scripts/factory-e2e-smoke.ts` invocation | Terminal success or rejection of the post-creation operation | Close only after successful report persistence | Awaited close in `finally` | 2 lifecycle tests; both success and failure close exactly once |

| Terminal path | Process released? | Handles closed? | Temp cleanup? | Final result preserved? |
| --- | --- | --- | --- | --- |
| SUCCESS | No process change required | Runtime close awaited | Not applicable | Yes |
| FAILURE | No process change required | Runtime close awaited | Not applicable | Original error reaches existing outer handler |
| CANCEL | No separate script signal currently passed | Rejection still reaches `finally` if cancellation occurs | Not applicable | Existing cancellation/error semantics preserved |
| RETRY/RESUME | No process change required | Same invocation boundary closes after operation | Not applicable | Existing resume report behavior preserved |

No filesystem cleanup was added. No path validation, marker, filesystem retry, or recursive deletion is applicable. The correction does not introduce AI-generation timeouts or global process termination.

Child processes, process trees, temporary ports, browser/context/page handles, and workspace locks are not resources created by this assigned boundary. Existing Functional QA owns its browser/server lifecycle separately. Promoted generated versions, customer projects, debug workspaces, and unknown directories remain untouched. The machine group contract does not represent rollback criteria; this bounded correction is reversible by reverting `247babe`.

## Historical temporary directories

The `.qa-foundation-*` count was 14 before targeted tests, 14 after targeted tests, and 14 after the full suite. No new persistent leak was created. Historical cleanup was not authorized by the cg-07 machine contract; all 14 directories were retained. No `.factory-generated*` or customer project directories were deleted, and promoted or debug workspaces remain untouched.

## Verification

Added two deterministic lifecycle tests: successful operation cleanup and post-creation failure cleanup. The targeted E2E/lifecycle set passed 32/32, including the existing 30 E2E safety tests and 2 new lifecycle tests. The production stage-runner tests passed in the full suite. Explicitly disabling the opt-in produced `REAL_FACTORY_E2E_PENDING` without launching the real E2E path.

Required reviewer rechecks passed with valid evidence:

- Code / Integration Reviewer: RESOLVED / APPROVED, 1 real GPT call.
- Test / Quality Reviewer: RESOLVED / APPROVED, 1 real GPT call; selected `behavioral-test-quality-review` and `requirements-evidence-traceability`.

Full validation passed: 69 test files and 830 tests, lint with only the three known pre-existing warnings, typecheck, build, npm audit with 0 vulnerabilities, database validation/status/verify/integrity, Docker Compose config, TaskGraph smoke with `releaseEligible=true`, and `git diff --check`. No intentional customer website-generation E2E was run.

Production correction commit: `247babe` (`fix: release the E2E runtime on terminal paths`).

## Phase state

The resolved warning leaves 16 correction-ready findings: 0 CRITICAL, 5 ERROR, 10 WARNING, and 1 INFO. No groups became newly unblocked because cg-14 also depends on cg-13. The next recommended group from the updated DAG is `cg-08-context7-authority`; it was not started.
