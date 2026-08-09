# Production stage composition

The composition root preserves the existing service boundaries: GPT adapters remain behind the shared AI client, Orchestrator remains authoritative for deterministic TaskGraph persistence, Implementation remains behind the existing agent service, runtime validation uses the real process runner, and functional QA uses the real localhost Chromium runner. No synthetic provider, fake process runner, fake browser, deployment, Git operation, Preview, or customer migration is introduced by the production composition.

The real smoke report includes safe adapter identity and real-stage evidence fields. A successful report must prove Lead, Planner, Design, Implementation, npm, and browser execution; adapter identity alone cannot create release eligibility.

FullTaskGraph execution adapters are documented in [`production-execution-state-adapter.md`](production-execution-state-adapter.md) and [`production-task-executor-adapter.md`](production-task-executor-adapter.md).

The concrete E2E stage runner consumes this composition and coordinates application services only; it does not select transports or provide scheduler callbacks.
