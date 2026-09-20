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
- Phase 7G token/context efficiency is CURRENT: role-provider adapters route through the canonical bounded ContextBundle assembler with checksum-bound provenance, TypeScript skeleton/snippet selection, approved-skill and Context7 slicing, diagnostic narrowing, deterministic prefilters, bounded expansion, stable prompt-prefix identity, and non-secret efficiency telemetry.

## Next milestone: durable planning re-execution certification

> State: PLANNED_FUTURE
> Scope: certify the committed Workbench Planning idempotency repair against
> real durable persistence. This milestone does not resolve the broader live
> incident, approve Planning, or authorize a real lifecycle run.
> Provider budget: zero external provider calls. A deterministic provider may
> be injected only for isolated synthetic certification, with no retry,
> correction, or fallback.

The preceding source boundary is locally covered: explicit failed-operation
retries are currentness-bound, unbound legacy re-execution fails closed before
any new attempt, and a proven bound retry keeps the logical operation identity
while isolating fresh attempt evidence. Local evidence is not durable
PostgreSQL evidence.

### Tasks

1. Run a read-only endpoint preflight at the expected source HEAD. If the
   configured database endpoint is unavailable, stop and record the first
   failing boundary. Do not repair credentials, write a probe row, or make a
   provider call to clear this precondition.
2. After preflight passes, use the existing repositories and Workbench
   production boundary with isolated synthetic project records. Fixture setup
   and cleanup must use the approved repository/test harness, never ad hoc SQL
   or the protected project. Verify the historical operation row, attempt rows,
   payload hash, currentness, and row-version behavior for both a proven bound
   retry and an unbound or stale legacy record; unsafe rejection must occur
   before provider or canonical mutation.
3. Compare the protected project's safe persisted identity, row version,
   workflow, checksum, approval, and other non-derived fields before and after
   the certification. Keep real Planning eligibility and any historical hash
   claim unverified unless the durable evidence directly establishes them.

### Acceptance checklist

- [ ] durable historical currentness and exact operation/attempt identity are
  read from persistence rather than inferred from local fixtures;
- [ ] valid bound re-execution and unsafe unbound/stale re-execution are both
  proven at the Workbench boundary with zero unintended provider or canonical
  side effects;
- [ ] protected state is unchanged, and no real Planning operation is labeled
  ready or executed by this certification;
- [ ] the evidence records the first failing boundary and leaves the milestone
  explicitly blocked when the durable endpoint is unavailable.

As of the 2026-09-20 verification attempt, the configured Supabase pooler
returned `XX000 / ENOTFOUND tenant/user`. This is a dated environment
observation, not current canonical project state. Until the condition is
resolved and durable evidence is captured, the exact historical hash,
protected-project live state, and eligibility of the real Planning operation
remain unknown.

## Planned and deferred work

> State: PLANNED_FUTURE / DEFERRED_WORK

- Complete customer-project source generation, generated-project npm/build/test execution, customer migration execution, and full generated-project browser validation remain future work.
- Repair-loop hardening, versioning/export finishing, local Git, optional GitHub creation, customer repository automation, automatic shadcn installation, and backend task-handler integration remain future work where not already covered by the current foundations above.
- Paid design-generator integration: **EXCLUDED** by the current capability policy; it is not a current production integration and has no runtime credential or tool path.
- `Dependency Authority`: **CURRENT_IMPLEMENTATION** for bounded package decisions; Phase 7F uses it for the optional exact `motion@12.43.0` request and user-approved amendment.
- `Preview` and `Deployment`: **DEFERRED_WORK** and excluded from the current Factory; no Preview Agent, Deployment Agent, deployment stage, or customer deployment is implemented.
- Final hardening audit, customer-project E2E, and deployment remain the next/out-of-scope boundaries after Phase 7G; this phase does not claim those outcomes.

The active skill portfolio snapshot is documented in [`../admin/skill-curation/active-agent-skill-portfolio-2026-08-09.json`](../admin/skill-curation/active-agent-skill-portfolio-2026-08-09.json) as a derived historical/admin view.

The production stage composition root is documented in [`../operations/production-factory-runtime.md`](../operations/production-factory-runtime.md). The production E2E stage-runner milestone is composed through `startImplementation` and the execution adapters; real opt-in execution remains dependent on the configured provider, npm, and Chromium.
