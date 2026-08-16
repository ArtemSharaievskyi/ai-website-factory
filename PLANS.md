# Plans policy

Use an ExecPlan when a change crosses architecture boundaries or has enough
dependent steps that the implementation order itself is a risk.

## Plan required for

- architectural changes or new runtime boundaries;
- large changes spanning multiple subsystems;
- database/schema migrations or persistence contract changes;
- broad refactors with many dependent steps;
- new tools, skills, external integrations, deployment, or infrastructure.

## Plan not normally required for

- a small localized bug fix with a known owning boundary;
- a focused UI or copy change;
- a provider field mapping with existing contracts;
- a single regression test or a narrow validator change;
- documentation updates that do not change runtime behavior.

## Required headings

1. **Goal** - the observable outcome and explicit exclusions.
2. **Existing architecture** - actual source paths and authority boundaries.
3. **Files likely involved** - expected files, with uncertainty called out.
4. **Invariants** - contracts, data safety, currentness, and compatibility rules.
5. **Steps** - ordered implementation and review actions.
6. **Validation** - focused tests, repository gates, and migration/QA checks.
7. **Completion criteria** - exact behavior, scope, and clean handoff checks.

Keep plans concise and update them when the discovered architecture changes.
The plan does not grant permission to expand scope, mutate customer data, or
skip the repository rules in `AGENTS.md` and `CONTRIBUTING.md`.
