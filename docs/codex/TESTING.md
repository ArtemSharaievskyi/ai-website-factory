# Testing and validation

Choose the smallest complete set for the changed boundary, then run the
repository gates required by `CONTRIBUTING.md` for a handoff.

## Baseline commands

- `npm run typecheck` - TypeScript contract and import validation.
- `npm run lint` - ESLint and repository boundary rules.
- `npm test` - the full Vitest suite.
- `npm run build` - Next.js production build; run when app, route, config, or
  generated-runtime behavior is affected.
- `git diff --check` - whitespace and patch hygiene.
- `npm run clean:workspace` - bounded cleanup before a final local handoff;
  it does not remove customer output, assets, database state, env files, or
  `node_modules`.

## Focused boundary tests

- Workbench/API: `npm run test -- src/app/api/workbench/route.test.ts
  src/runtime/workbench/workbench.test.ts`.
- Clarification and idempotency: `npm run test --
  src/runtime/trial-entry/service.test.ts
  src/runtime/trial-entry/sequential-clarification-idempotency.test.ts`.
- Brief revision: `npm run test --
  src/runtime/workbench/brief-revision-production-trace.test.ts
  src/runtime/workbench/brief-revision-lossless.test.ts
  src/runtime/workbench/brief-revision-idempotency.test.ts
  src/domain/requirements/brief-v2.test.ts`.
- Context losslessness: `npm run test --
  src/runtime/context/lossless-context.test.ts`.
- Assets and persistence: `npm run test --
  src/runtime/workbench/asset-upload.test.ts
  src/runtime/assets/service.test.ts
  src/persistence/database/persistence.test.ts
  src/persistence/database/postgres.test.ts`.
- Agent/reviewer contracts: `npm run test:reviewers`.

## Provider structured-output rule

For an OpenAI contract change, test the production boundary, not only the
domain schema:

1. Construct the exact response schema passed to the production client in
   `src/integrations/openai/client.ts`/`adapters.ts`.
2. Use a fixture shaped like the actual provider response returned by the
   production transport, including its parsed wrapper and role payload.
3. Verify strict unknown-key rejection, required nullable optional values,
   nested arrays/objects, and host-owned fields excluded from provider output.
4. Assert transport response -> adapter mapping -> canonical domain object,
   including checksum/currentness/approval being assigned by the host.
5. Use a synthetic live provider check only when the transport itself is the
   suspected failure and credentials/configuration are available. Never use a
   live check as the only regression proof.

Relevant tests are `src/integrations/openai/provider.test.ts`,
`src/integrations/openai/brief-v2-provider-contract.test.ts`, and
`src/integrations/openai/prompts.test.ts`.

## Database and larger boundaries

- `npm run db:validate` validates migration structure.
- `npm run db:test-integrity` exercises migration integrity fixtures.
- `npm run db:status`, `npm run db:verify`, and `npm run db:smoke` require the
  configured database environment; use them for persistence or migration work.
- `npm run generated:runtime-smoke` validates generated runtime behavior.
- `npm run playwright:smoke` validates controlled functional QA and needs a
  valid built runtime artifact.
- `npm run factory:e2e-smoke` covers the Factory lifecycle harness.
- `npm run taskgraph:smoke` covers TaskGraph construction/execution seams.

For a docs-only change, typecheck, lint, diff check, path/script validation,
and a protected-project status comparison are normally sufficient; do not
mutate real customer data to make a documentation check pass.

## Codex Level 2 and 2.5 workflow

### Level 2.5 guards

- npm run check:architecture parses the TypeScript import graph, including
  relative imports, tsconfig aliases, Windows/POSIX separators, TS/TSX files,
  and index modules. It reports existing violations as baseline debt; it does
  not rewrite production code.
- Architecture and provider guard failures are fingerprinted at codex:start.
  codex:verify blocks new failures, changed fingerprints, resolved baseline
  failures that return, and any task touching a baseline failure activation path.
  An exact unchanged failure outside its activation paths is reported as
  BASELINE_FAILURE and is non-blocking. Config cannot declare a known failure.
  Provider-contract metadata may use narrower `affectedPathPrefixes` for the
  blocking decision while retaining broad `triggerPathPrefixes` to select the
  executable guard. This keeps an unchanged contract failure visible without
  blocking on an unrelated shared-client or diagnostics edit; changes to the
  owning contract paths remain blocking.
- Run npm run codex:review-context for a bounded independent-review handoff.
  It is structural context only; the reviewer remains read-only.

Before a task, create a read-only protected session with
`npm run codex:start -- --protect <project-id>`. It saves only the safe status
fields listed in `scripts/codex/protected-state.ts` and refuses to overwrite an
active session without `--reset`.

Use `npm run codex:affected` to resolve checks from the saved Git baseline;
add `--run` to execute them. `npm run codex:provider-contracts` constructs the
actual registered OpenAI response formats locally, checks strictness and
host-owned field boundaries, and exits non-zero for existing failures. It does
not call the network. `npm run codex:verify` runs the affected checks,
historical regression checks, provider guard when relevant, production-path
evidence, protected snapshots, baseline relationship, and `git diff --check`.

The JSON registries contain IDs and path metadata only. Executable names and
arguments are code-owned in `scripts/codex/checks.ts`; config cannot inject
arbitrary shell commands. Missing production-path evidence is reported as
`PRODUCTION PATH: MISSING` and does not count as coverage.
