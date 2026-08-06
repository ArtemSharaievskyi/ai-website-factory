# Persistence concurrency

Workflow transitions are performed by `WorkflowPersistenceService`. The service loads the project, checks the caller's expected state, version, and row version, invokes the existing pure domain transition guard, updates the state, increments `row_version`, and appends a workflow event in one transaction.

Postgres uses a conditional `UPDATE ... WHERE workflow_state = ... AND row_version = ...`; a stale caller receives `PERSISTENCE_CONFLICT`. The in-memory adapter applies the same check for deterministic tests. Generic project state updates are not exposed by the repository boundary.

Released versions are marked immutable. Release creation validates quality gates and known errors through the existing release contract and workflow guard before marking both the version and project ready.
