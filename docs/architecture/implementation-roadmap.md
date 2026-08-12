# Implementation roadmap

> Status: ROADMAP
> Authority: This document is a descriptive roadmap, not runtime authority. `CURRENT` marks implemented Factory capability, `PLANNED_FUTURE` marks approved future work, and `DEFERRED_WORK` marks explicitly postponed or excluded capability.

## Current implementation baseline

> State: CURRENT

- The production provider foundation is available behind existing ports; real smoke testing remains explicit opt-in.
- Durable workflow state, approved skills, Lead clarification/brief approval, three-direction Design selection, and versioned workspace foundations are implemented in the current Factory contracts and services.
- The active skill portfolio contains 4 approved external and 13 approved internal artifacts across all nine agents; three external candidates remain deferred for future policy review.
- The Orchestrator provides deterministic TaskGraph planning, and production execution-state/task-executor adapters bridge the existing FullTaskGraph scheduler to application services.
- The Planner / Architect foundation consumes only approved Briefs and accepts them without advancing beyond `AWAITING_DESIGN_SELECTION`. The Design Agent creates exactly three deterministic directions and waits for explicit selection before `READY_FOR_IMPLEMENTATION`.
- Read-only Context7 documentation enrichment, approved read-only shadcn Registry references, the backend task-handler foundation, npm-only runtime validation, controlled Playwright QA, bounded full TaskGraph execution, and optional read-only Codebase Memory are implemented current foundations.

## Planned and deferred work

> State: PLANNED_FUTURE / DEFERRED_WORK

- Complete customer-project source generation, generated-project npm/build/test execution, customer migration execution, and full generated-project browser validation remain future work.
- Repair-loop hardening, versioning/export finishing, local Git, optional GitHub creation, customer repository automation, automatic shadcn installation, and backend task-handler integration remain future work where not already covered by the current foundations above.
- Paid design-generator integration: **EXCLUDED** by the current capability policy; it is not a current production integration and has no runtime credential or tool path.
- `Dependency Authority`: **CURRENT_IMPLEMENTATION** for bounded package decisions; Phase 7F uses it for the optional exact `motion@12.43.0` request and user-approved amendment.
- `Preview` and `Deployment`: **DEFERRED_WORK** and excluded from the current Factory; no Preview Agent, Deployment Agent, deployment stage, or customer deployment is implemented.

The active skill portfolio snapshot is documented in [`../admin/skill-curation/active-agent-skill-portfolio-2026-08-09.json`](../admin/skill-curation/active-agent-skill-portfolio-2026-08-09.json) as a derived historical/admin view.

The production stage composition root is documented in [`../operations/production-factory-runtime.md`](../operations/production-factory-runtime.md). The production E2E stage-runner milestone is composed through `startImplementation` and the execution adapters; real opt-in execution remains dependent on the configured provider, npm, and Chromium.
