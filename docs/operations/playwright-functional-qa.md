# Playwright Functional QA

Playwright is restricted to functional behavior in a mutable generated staging workspace. QA starts only after the allowlisted runtime validation sequence passes, then derives sequential scenarios from approved requirements and planning documents. It checks routes, navigation, forms, approved auth/authorization behavior, and runtime/browser errors.

There is no screenshot review, visual regression, pixel comparison, accessibility stage, deployment, production browsing, customer Git automation, or full TaskGraph execution.

Full execution may invoke this QA service only after the build/runtime prerequisites and QA readiness checks pass.
# Production composition

In `REAL_E2E`, `FunctionalQaService` is composed with `NodeLocalTestServer` and `PlaywrightBrowserRunner`. No screenshot or visual-QA path is enabled.

The production TaskGraph adapter derives the QA plan from approved sitemap/forms/user-flow documents and delegates readiness and browser execution to `FunctionalQaService`.

# QA workspace lifecycle

Every Factory-owned functional-QA run uses `QaWorkspaceLifecycle` (`src/runtime/qa/workspace.ts`). It creates a direct child of the authorized Factory QA root with the fixed `.qa-foundation-` prefix and writes `.factory-qa-workspace.json` before the workspace is used. Marker schema version `1` binds the workspace to a UUID workspace identity, UUID QA-run identity, project/version identity, the SHA-256 authorized-root identity, owner PID, owner session UUID, creation time, and lifecycle state (`CREATED`, `ACTIVE`, `CLEANING`, `CLEANED`, `STALE`, or `ABANDONED`).

The marker is the ownership authority. Cleanup accepts only a direct child with the exact compatible prefix/name, rejects repository-root and traversal targets, refuses authorized roots that are links or filesystem roots, and inspects every link/junction before removal. A link resolving outside the authorized root is a hard safety failure. Unmarked, malformed, colliding, or otherwise unverified prefix matches are preserved and reported; they are never removed by prefix matching alone.

`FunctionalQaService` owns the `try/finally` lifecycle: validate and activate the workspace, stop the browser, stop the owned local server, then remove the workspace and verify terminal absence. On Windows, the server launcher uses only the validated owner handle and fixed `taskkill /pid <owned-pid> /t /f` process-tree escalation; arbitrary PID discovery and shell-built commands are not allowed. Cleanup is bounded and retries only `EPERM`, `EBUSY`, and `ENOTEMPTY` with 25/50/100/200 ms delays. A cleanup result records the safe workspace reference, ownership/run identities, stop flags, removal/absence verification, retry count, deferred/failure state, and reason without replacing the primary QA failure.

At startup or an explicit reconciliation boundary, `inventory()` scans only bounded immediate prefix matches. Active current-owner workspaces are protected. Marker-owned stale workspaces may be reconciled; legacy unmarked workspaces are removable only when the strict generated-project/package/build fingerprint is proven. All other matches remain preserved for manual review. Reconciliation is idempotent, continues after an individual failure, and reports preserved entries and typed failures.
