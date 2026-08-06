# Task lifecycle

Tasks transition through `pending`, `blocked`, `ready`, `running`, `passed`, `failed`, and `cancelled`. Transitions use the persisted graph checksum as an optimistic concurrency token. Attempts are bounded: implementation defaults to three, validation to two, and release preparation to one. Failed tasks may be explicitly retried or receive a targeted repair task; a repair does not regenerate the project. Cancellation preserves the task and its history.

Task execution is intentionally not implemented. Blocking failures keep dependents blocked and prevent release readiness. Reconciliation reports interrupted running tasks, checksum mismatches, missing graphs/dependencies, and other ambiguous states for explicit action.
