# Real Factory end-to-end smoke

`npm run factory:e2e-smoke` is the opt-in smoke boundary for the real Lead, Brief, Planner, Design, explicit direction #1 selection, Orchestrator, TaskGraph, Implementation Agent, generated workspace, npm runtime validation, local server, and Chromium Playwright QA stages.

The command is inert unless `ALLOW_REAL_FACTORY_E2E=true` is present. Without opt-in it prints `REAL_FACTORY_E2E_PENDING`. With opt-in it requires server-only OpenAI configuration, npm, Chromium, a clean worktree, and passing deterministic validations. It never deploys, mutates Git, migrates a customer database, accesses customer data, browses arbitrary external sites, or captures screenshots.

Context7 and shadcn are demand-driven and are recorded as `not-needed` when the VeloFix acceptance path does not require them. Enabled but unavailable integrations block the run rather than being replaced with synthetic responses.

The server-only production composition root is [`production-factory-runtime.ts`](../src/runtime/production-factory-runtime.ts). It owns the shared production AI bundle and real runtime/browser adapters; deterministic tests use the separate deterministic composition.

The composed FullTaskGraph adapters are production-owned and preserve optional Context7/shadcn `not-needed` behavior.

REAL_E2E invokes one concrete production stage runner. Explicit Brief approval, planning acceptance, and design selection precede Orchestrator graph creation and FullTaskGraph execution; adapter-owned real-stage evidence is mandatory for success.
# Codebase Memory boundary

The default and real Factory E2E smoke do not require Codebase Memory. The dedicated structural smoke is separate, explicitly opt-in, and is not run in this task.
