# AI Website Factory Web Workbench closure reconciliation

Status: **BLOCKED — `WEB_WORKBENCH_SEMANTIC_REVIEW_BLOCKED`**

The previous closure incorrectly reused the Phase 7E QA Workspace Lifecycle candidate:

- `phase-7e-qa-workspace-lifecycle-2026-08-12`
- `d7d462c3f0dfe74319ff974d734d870da6382a2eb36fe612c27b60dff19967ae`

That identity belongs to historical QA workspace lifecycle evidence and cannot own the Web Workbench. Those Phase 7E artifacts were not modified.

## Frozen Workbench candidate

- Candidate: `web-workbench-2026-08-12`
- Baseline: `97bd700fef997326477c72561fb8d5890c1178af`
- Implementation: `b86027a7f0ef8e1b6dd3caec8b29e70a640c8b34`
- Documentation: `1624b3c35a6efb89f8f700dce20db785e3dd586e`
- Final HEAD before closure: `1624b3c35a6efb89f8f700dce20db785e3dd586e`
- Candidate checksum: `758b623b29bf8d61a2f224571869e3522453fb6eff3b7de16ef618059c41b3c6`
- File count: 19
- Full manifest and SHA-256 hashes: `docs/admin/workbench/web-workbench-candidate-2026-08-12.json`

The candidate contains the accepted Workbench source, server boundary, production/persistence integration, package configuration, focused tests, and synthetic Playwright smoke. The operational trial guide remains separate at `docs/operations/first-trial-website.md`. No source, test, package, lockfile, database, or migration file was modified during reconciliation.

## Evidence pack

- Evidence pack: `web-workbench-evidence-pack-2026-08-12`
- Evidence checksum: `93b23f6688ade0afca60f388d7ccc95bf1bdf6389b7304f35447471be0d081b0`
- Path: `docs/admin/workbench/web-workbench-evidence-pack-2026-08-12.json`
- Repository-relative references: 25
- Valid references: 25
- Invalid references: 0
- `evidenceValid`: `true`

The pack covers the one-page route, prompt submission, InitialProjectRequest and Trial Entry integration, Lead-first behavior, clarification continuation, canonical approvals, database/dependency/design/implementation authorities, project isolation and refresh, client/provider boundaries, output safety, no Preview, CLI fallback, preserved runtime path, no migration/Codex, synthetic-only testing, W1-W40, focused tests, and validation.

## Reviewer governance

`npm run test:reviewers` is deterministic reviewer infrastructure validation, not a fresh semantic review. It passed 7 files / 77 tests.

Fresh semantic review is required because this candidate/evidence identity is new and the Workbench introduced a new typed server contract plus cross-artifact workflow integration. The minimal current ownership set is:

- Architecture Reviewer
- Contract Auditor
- Code / Integration Reviewer
- Security Reviewer
- Test / Quality Reviewer

No semantic execution was reused: existing executions bind different candidate/evidence identities. No fresh execution was possible because the current environment has no valid OpenAI provider configuration. No execution IDs, skills, verdicts, or findings were fabricated. Per-reviewer records are in the machine closure result with `executionId: null` and `NOT_EXECUTED_PROVIDER_UNAVAILABLE`.

## Validation

- Workbench focused tests: 45 passed
- W1-W40: passed
- Full suite: 86 files / 1,178 tests passed
- Typecheck: passed
- Lint: passed with 2 accepted pre-existing warnings
- Build: passed
- Audit: 0 high vulnerabilities
- Database validation/status/verification/integrity: passed; no migration
- Docker Compose config: passed
- TaskGraph: passed
- Backend and generated-runtime smokes: passed
- Synthetic Workbench Playwright: passed
- `git diff --check`: passed

QA lifecycle reconciliation found zero Factory-owned stale workspaces and zero active workspaces. One unverified empty `.qa-foundation-*` directory remains preserved because ownership could not be proven.

## Final state

- Real Haus & Garten project: not submitted
- Customer source: not generated
- Codex provider: not added
- Database migration: not added
- Candidate: current
- Evidence: valid
- Workbench: blocked only on required semantic reviewer execution

Next action: configure the approved provider and run the five required semantic reviewers against the frozen candidate/evidence identity. Do not mutate candidate files before those reviews. After approved semantic closure, run the real trial manually with `npm run dev` at `http://localhost:3000`.
