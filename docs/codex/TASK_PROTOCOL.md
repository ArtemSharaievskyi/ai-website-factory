# Codex task protocol

Every execution task declares its operation envelope. The envelope is
machine-readable; this document defines the stable meaning of its fields.

Required fields are `MODE`, `EXPECTED_HEAD`, `OPERATION`, `PROVIDER_BUDGET`,
`ALLOWED_SOURCE_MUTATION`, `ALLOWED_CANONICAL_MUTATION`, `TARGET_STATE`,
`STOP_CONDITIONS`, and `AGENT_POLICY`. `AGENT_POLICY` declares a bounded
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

## Compact future-task example

Documentation-only example; do not execute it:

```text
MODE: REAL_LIFECYCLE
OPERATION: PLANNING_REFRESH
EXPECTED_HEAD: <sha>
PROTECTED_PROJECT: <uuid>
PROVIDER_BUDGET:
  planner: 1
  architectureReview: 0
  design: 0
STOP_AT:
  USER_APPROVAL
  SOURCE_DEFECT
  PROVIDER_FAILURE

Follow AGENTS.md, FAST_PILOT.md, TASK_PROTOCOL.md, and the applicable skill.
```
