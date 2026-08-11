# Phase 6T / cg-11: Codebase Index Identity

Status: **COMPLETE**

## Finding resolution

| Finding | Severity | Category | Result |
| --- | --- | --- | --- |
| `finding-9106112c9ba65e4be7ed` | WARNING | `IDENTITY_MODEL` | **RESOLVED** |

The correction makes Codebase Memory query selection deterministic when one project version has multiple valid workspace paths. Query plans now require the complete `WorkspaceScope`, the plan project identity must match the scope, and index lookup uses only the exact canonical workspace identity:

`projectId:projectVersion:path.resolve(workspacePath).toLowerCase()`

The existing content-based source manifest remains the freshness boundary. The existing cg-09 durable metadata, cache, idempotency, atomic publication, restart, corruption, and concurrency behavior remains in force.

## Reproduction and correction

The baseline behavior was reproduced with two valid workspaces carrying the same project ID and version but different paths. First-match lookup returned the wrong workspace index. The final regression proves:

- an unscoped query plan is rejected;
- projectId and projectVersion mismatches between plan and scope are rejected with `CODEBASE_MEMORY_WORKSPACE_INVALID`;
- the intended scoped workspace is selected, and the other workspace cannot be reused.

Production changes are limited to `service.ts` and `contracts.ts`; the Codebase Memory test and the shared cg-11 verifier provide the regression and review evidence. The existing `policy.ts`, metadata durability, and Implementation Agent scope consumer were reviewed and preserved.

## Identity boundaries

| Identity | Authority and behavior |
| --- | --- |
| Project / version | Required in the query and must agree with `WorkspaceScope`. |
| Workspace | Resolved, validated, generated-root-contained, and part of canonical identity. |
| Source snapshot | Existing sorted SHA-256 manifest of allowed source files; unchanged policy. |
| Index | Exact workspace identity plus manifest checksum; no first-match fallback. |
| Cache / query | Existing manifest/operation/plan keys and scope keys; now impossible to enter without scope. |
| Optional upstream | Read-only adapter input only; unavailable in this environment, with no fake fallback. |

No whole-repository hash, secret value, database migration, workspace storage redesign, new authority, or new agent/tool/MCP was introduced.

## Review and validation

Both required reviewers approved the final bounded correction with valid evidence. The first bounded cycle left one code-integration concern about binding scope to plan identity; the second cycle added that guard and direct tests. Four fresh provider calls were used across the two reviewer cycles; no reviewer execution was reused.

| Check | Result |
| --- | --- |
| Targeted Codebase Memory tests | PASS — 12 tests |
| `npm test` | PASS — 70 files / 850 tests |
| `npm run test:reviewers` | PASS — 7 files / 77 tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 errors; 3 known pre-existing warnings |
| `npm run build` | PASS — Next.js 16.2.12 |
| `npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| Database validation/status/verify/integrity | PASS |
| `docker compose config` | PASS |
| `npm run taskgraph:smoke` | PASS — release eligible; 6 tasks; 0 repairs |
| `git diff --check` | PASS |

The optional live Codebase Memory smoke was not run: `codebase-memory-mcp` is unavailable and `ALLOW_REAL_CODEBASE_MEMORY_SMOKE` is unset. QA foundation count stayed at 16 before targeted checks, after targeted checks, and after the full suite. `.context7-cache/` remains untracked and unstaged.

## Phase 6 closure

- Remaining findings: **0** (`CRITICAL 0`, `ERROR 0`, `WARNING 0`, `INFO 0`).
- Remaining correction groups: **0**.
- All finding-bearing groups are terminal and the DAG remains acyclic.
- Approved portfolio invariants remain 4 external artifacts, 13 internal artifacts, 17 unique artifacts, 18 assignment references, and 9 catalog agents.
- No customer website-generation E2E or deployment was initiated.
- Historical reports and `.qa-foundation-*` directories were preserved.

Terminal successor state: `phase-6-execution-state-2026-08-11-cg11-result.json`.

Next: **POST-PHASE-6 HARDENING PLAN**.
