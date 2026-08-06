# Workflow state machine

The deterministic engine implements:

```text
DRAFT → CLARIFYING → AWAITING_BRIEF_APPROVAL → AWAITING_DESIGN_SELECTION
  → READY_FOR_IMPLEMENTATION → IMPLEMENTING → VALIDATING
  → REPAIRING → VALIDATING → PROJECT_READY
```

`FAILED` is reachable from implementation and validation. It can only recover through an explicit recovery operation to an earlier operational state. `PROJECT_READY` is terminal for that version.

Guards include unresolved blocking clarifications, approved requirements and matching checksums, exactly three unique directions, current selected-design membership and checksum, accepted architecture, pending image/authentication decisions, unapproved requirement changes, required quality checks, known errors, and release validity. Rejected operations return stable `DomainError` codes rather than raw Zod errors.

The engine is a pure domain module. It does not run agents, call models, create projects, or expose an API. The server-only `WorkflowPersistenceService` now invokes this engine inside a database transaction and records the resulting workflow event.
