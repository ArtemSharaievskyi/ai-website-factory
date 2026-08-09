# Production Task Executor adapter

`ProductionTaskExecutorAdapter` is the Factory-owned immutable dispatch table between `FullTaskGraphExecutor` and existing application services.

- Implementation tasks call `ImplementationAgentService.executeImplementationTask`.
- `validate-lint`, `validate-typecheck`, `validate-unit-tests`, and `validate-build` call the corresponding bounded runtime-validator method.
- `validate-functional-flow` derives the approved functional QA plan and calls `FunctionalQaService`.
- Unsupported task types fail safely and never become a synthetic pass.

The adapter never calls OpenAI, child processes, or Playwright directly. It builds validated service inputs from canonical documents and maps safe service results back to `TaskExecutionOutcome`.

It also records adapter-owned evidence for successful implementation provider calls, ProcessRunner commands, and Playwright execution; the stage runner only validates those records.
