# Production E2E stage runner

`runProductionE2EStages` is the application-level coordinator for the opt-in REAL_E2E smoke. It owns stage ordering and report assembly; `FullTaskGraphExecutor` remains the only scheduler for implementation, runtime validation, and functional QA.

The runner creates a unique non-production VeloFix project through Lead and Workspace Manager, resolves only fixture-derived clarifications, explicitly approves the Brief, accepts planning, generates exactly three Design directions, selects direction one, asks Orchestrator to create and validate the TaskGraph, calls `startImplementation`, and invokes `ProductionFactoryRuntime.createFullExecutor`. It reads the canonical `full-execution` summary and never calculates or mutates `releaseEligible`.

Provider usage and real ProcessRunner/Playwright evidence are recorded by production adapters and the provider bundle. The runner only validates that evidence. Context7 and shadcn remain optional; `NOT_NEEDED` is valid. The runner has no OpenAI, MCP, shell, npm, Git, deployment, or browser transport access.

Failures preserve a safe stage code. One cancellation signal is propagated and stage boundaries prevent new work after cancellation.
