# Codex task protocol

Every execution task declares its operation envelope. The envelope is
machine-readable; this document defines the stable meaning of its fields.

## Task shape

Use the smallest existing structure:

`Milestone -> Task -> optional subtask checklist`

Do not require an Initiative, PRD, Epic, User Story, Task, and Subtask for
every change. A task must still state its observable outcome, owning boundary,
explicit exclusions, acceptance criteria, and expected evidence. Scale the
specification to the change: defects need observed/expected behavior and a
production-boundary regression; contract changes need compatibility and
failure semantics; substantial features need user problem, scope, non-goals,
and acceptance criteria; architectural decisions need alternatives, choice,
and consequences.

Keep Factory requirements, generated-website requirements, engineering
procedure, live project state, and verification evidence distinct. A dated
report or session snapshot can support a decision but does not become current
state by being copied into a task. Agents may correct a specification when
evidence disproves it, but may not lower its acceptance bar to match the
implementation.

Delegation is optional. When used, assignments are bounded by purpose,
expected output, and exact file ownership or read-only scope. One Lead owns
integration and canonical work; parallel canonical writes are forbidden.
Do not add a parallel task database, management framework, orchestration code,
or agent implementation merely to express or coordinate a task.

Required envelope fields are `mode`, `expectedHead`, `operation`,
`providerBudget`, `allowedSourceMutation`, `allowedCanonicalMutation`,
`targetState`, `stopAt`, and `agentPolicy`. `agentPolicy` declares a bounded
`SINGLE`, `BOUNDED_PARALLEL`, or `READ_ONLY_SWARM` mode, with at most four
subagents, one integration authority, and no parallel canonical writes. Use
`npm run codex:task -- --file <task-envelope.json>` for deterministic preflight.

Supported modes:

- `SOURCE_REPAIR`: source changes may be made; canonical and provider mutation
  are forbidden. Use synthetic certification before any real lifecycle task.
- `REAL_LIFECYCLE`: source changes are forbidden; canonical mutation is allowed
  only through production entrypoints, with a protected project and explicit
  provider budget. Run `codex:start -- --protect <project-id>` first.
- `READ_ONLY_AUDIT`: source, canonical, and provider mutation are forbidden.

The runner validates schema, mode/mutation compatibility, agent-policy bounds,
provider-budget shape, expected HEAD, protected-session membership where
required, and source cleanliness. It is a guard, not a workflow engine; it does
not call providers, mutate canonical state, start lifecycle work, or replace
`codex:start`, `codex:affected`, `codex:review-context`, or `codex:verify`.

## Common result contract

Report only fields relevant to the operation, using this compact shape:

```text
initial HEAD: <sha>
final HEAD: <sha>
source commit: <sha or none>
agent policy: <mode; maxSubagents; single integration authority>
subagents used: <count; bounded by envelope>
provider calls by stage: <stage=count>
retries/corrections/fallbacks: <counts>
protected pilot mutations: <count>
source changes: <summary>
canonical mutations: <summary>
current workflow: <state or unchanged>
genuine stop reason: <reason or none>
certification: <checks/evidence>
safe next action: <action>
```

For documentation-only work, the result may omit operation fields that do not
apply, but it must still name changed documents, validation gates, protected
state, baseline failures, remaining uncertainty, and the safe next action.
Never describe an unverified live project, durable database state, provider
eligibility, or lifecycle readiness as established merely because local tests
pass.

## Compact future-task example

Documentation-only example; do not execute it:

```json
{
  "mode": "REAL_LIFECYCLE",
  "expectedHead": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "protectedProjectId": "00000000-0000-4000-8000-000000000000",
  "operation": "PLANNING_REFRESH",
  "providerBudget": {
    "planner": 1,
    "architectureReview": 0,
    "design": 0
  },
  "allowedSourceMutation": false,
  "allowedCanonicalMutation": true,
  "targetState": "PLANNING_REFRESH_PENDING_APPROVAL",
  "stopAt": ["USER_APPROVAL", "SOURCE_DEFECT", "PROVIDER_FAILURE"],
  "agentPolicy": {
    "mode": "BOUNDED_PARALLEL",
    "maxSubagents": 4,
    "parallelCanonicalWrites": false,
    "singleIntegrationAuthority": true
  }
}

```

Follow `AGENTS.md`, `FAST_PILOT.md`, `TASK_PROTOCOL.md`, and the applicable
skill before execution.
