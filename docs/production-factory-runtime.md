# Production Factory runtime

`src/runtime/production-factory-runtime.ts` is the server-only composition root for `REAL_E2E`. It creates one shared production OpenAI client/provider bundle, Postgres persistence database, workspace manager, GPT-backed Lead/Planner/Design services, real npm runtime validator, real localhost server, real Chromium Playwright QA service, and the existing `FullTaskGraphExecutor` factory.

`src/runtime/deterministic-factory-runtime.ts` is the explicit test composition. Runtime mode is selected by code (`REAL_E2E` or `DETERMINISTIC_TEST`), never inferred from whether a key happens to exist.

The production identity is validated before execution. Mandatory production identities are `production`, `real`, and `production`; Context7 and shadcn remain optional and default to `not-needed`.

The project scope now creates `ProductionExecutionStateAdapter`, `ProductionTaskExecutorAdapter`, and the production repairer internally. REAL_E2E callers receive a fully composed `FullTaskGraphExecutor` context rather than supplying arbitrary state or task callbacks.

The opt-in harness uses `runProductionE2EStages` as its single application-level coordinator around that executor.
