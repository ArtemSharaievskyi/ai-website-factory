# Contract Auditor

The Contract Auditor is the final pre-implementation contract gate. It answers whether approved requirements and architectural obligations remain connected through Planning, the selected Design, TaskGraph tasks, capabilities, executors, ownership, dependencies, and required quality responsibilities.

It is distinct from the Architecture Reviewer: Architecture Reviewer asks whether the architecture is sensible and implementable; Contract Auditor asks whether the approved contract survived across artifacts without loss, incompatible renaming, contradiction, orphaning, or unowned execution work.

## Workflow and inputs

The stage is `CONTRACT_AUDIT`, after Orchestrator TaskGraph preparation and before `START_IMPLEMENTATION`. Its bounded `ContractAuditInput` contains the approved Brief and checksum, accepted PlanningPackage and checksum, current approved Architecture Review reference/checksum, selected Design and checksum, current TaskGraph and checksum, and a bounded current executor catalog. It never receives `.env`, the repository, generated source, unbounded Project Memory, or raw provider history.

The auditor requires a current approved Architecture Review. A missing, stale, blocked, or changes-required Architecture Review blocks the audit. A stale Brief, PlanningPackage, Design, or TaskGraph also blocks it.

## Deterministic and semantic checks

Deterministic checks establish references, checksums, route/form/data/auth ownership, stable form identities, task dependencies, capabilities and current executors, bounded scopes, and mandatory lint/typecheck/unit-test/build/Functional QA gates. Functional QA must depend on build. Persistent-data obligations require database and RLS ownership; authentication is required only when the canonical contract requires it.

The sole AI provider is the existing GPT-5.6 Luna structured-output adapter. It is used only for semantic gaps that deterministic checks cannot prove, such as materially changed downstream meaning or an inappropriate task boundary. The prompt is independently versioned as `contract-auditor.v1`, with policy `contract-audit-v1`.

## Results and correction ownership

The auditor reuses `ReviewResult`, verdicts, severities, evidence references, and strict structured output. Contract-specific categories cover missing traceability, ownership, capabilities/executors, validation, identity, route/form/data/scope/dependency mismatches, and contradictions. Actionable findings identify `PLANNING`, `DESIGN`, `TASKGRAPH`, or `WORKFLOW_CONTRACT` as the correction target. The auditor never performs the correction.

Results are persisted as `contract-audit` records plus history documents, with upstream checksums, policy/prompt/agent metadata, result checksum, and no chain-of-thought. Identical canonical inputs are idempotent. Any upstream artifact or policy change makes an approval stale and unable to unlock implementation.

TaskGraph-only regeneration, when separately authorized by the Orchestrator, is bounded to one cycle; the changed checksum makes the prior audit stale and requires a fresh audit. Planning and Design findings return `CHANGES_REQUIRED` without silently mutating those artifacts.

The auditor is read-only: it cannot modify Brief, Planning, Architecture Review, Design, TaskGraph, task state, source files, migrations, or the filesystem. It may receive the approved `acceptance-criteria-80493e317476` procedure as supplemental, checksum-bound guidance; that skill grants no tools or authority.
