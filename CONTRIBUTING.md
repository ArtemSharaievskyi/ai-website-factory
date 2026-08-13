# Contributing

Use npm commands only. Keep the Factory foundation separate from generated customer projects and do not add Preview, deployment, worker, microservice, or external integration infrastructure without an approved architecture change.

Before a change is handed off, stop local servers and run `npm run clean:workspace`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. `clean:workspace` is deliberately bounded: it never removes generated customer projects, Factory assets, database state, environment files, or `node_modules`; use `PRESERVE_QA_ARTIFACTS=1` when retaining QA workspaces is required.

For an implementation handoff, exact-stage only the accepted source, tests, migrations, configuration, and documentation for that change, review `git diff --cached --name-only` and `git diff --cached --stat`, create one bounded commit, and verify the tracked worktree is clean. Diagnostic-only, read-only, and explicitly uncommitted experiments are exceptions. Runtime code must never create commits automatically.
