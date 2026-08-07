# Production execution state adapter

`ProductionExecutionStateAdapter` implements the existing `ExecutionStatePort` for `FullTaskGraphExecutor`. It reads the canonical TaskGraph, project workflow, and version immutability through existing repositories, persists graph checkpoints through `DocumentRepository`, persists the bounded `ExecutionSummary`, and synchronizes `full-execution.json` through Project Memory. It does not implement scheduling or last-write-wins state transitions.

Quality checks are carried with execution checkpoints and are supplied to the executor’s existing release boundary. Persistence and schema conflicts remain failures; no synthetic quality success is created.

