# Trial Entry CLI Node-safe composition repair

Date: 2026-08-12
Implementation commit: `cf24dad`
Baseline: `0932edd85560d07e02257872c5ca044ac05890d3`

The standalone `factory:new`, `factory:respond`, and `factory:status` scripts now use `src/runtime/trial-entry/node.ts`. The Next.js adapter at `src/runtime/trial-entry/production.ts` and the Workbench adapter at `src/runtime/workbench/production.ts` retain `import "server-only"`.

The Node adapter reuses the canonical `TrialEntryService`, Lead service, Project Memory, Postgres persistence, workflow authorities, and `scripts/cli-env.ts`. Status is deterministic and does not construct an AI provider. No package, lockfile, schema, migration, Workbench candidate, or R4 evidence file changed.

Validation:

- CLI1-CLI24 matrix: 24/24 pass.
- CLI/module/Trial Entry focused suites: 61/61 pass.
- Workbench focused suite: 45/45 pass.
- Reviewer suite: 77/77 pass.
- Typecheck, build, audit, database checks, Docker config, TaskGraph, backend, and generated-runtime smoke: pass.
- Full test suite: 1,203/1,205 pass. The two failures are unrelated QA-server tests blocked by Windows `EPERM` while creating symlinks for `node_modules/pg`.
- Lint: pass with two pre-existing unused-variable warnings.

Verified Windows commands:

```powershell
npm.cmd run factory:status -- "--project" "b7a0829d-a077-487c-844a-3232efc21bc3"
npm.cmd run factory:status -- "--project" "b7a0829d-a077-487c-844a-3232efc21bc3" "--json"
```

Both return exit code 0. The unquoted npm 11 form treats `--project` as an npm option/config warning, so the quoted forwarding form is the verified command for this Windows environment.

The real project remains unchanged: version 1, `CLARIFYING`, row version 2, six unresolved clarification questions, no requirements document, and the six Web question IDs remain current. No answers were submitted, no Brief was approved, no source was generated, and no second project was created. The Web 409 was not retried, diagnosed, or repaired.
