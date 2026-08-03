# Workflow

## Planned state machine

`DRAFT → CLARIFYING → AWAITING_BRIEF_APPROVAL → AWAITING_DESIGN_SELECTION → READY_FOR_IMPLEMENTATION → IMPLEMENTING → VALIDATING → REPAIRING → PROJECT_READY`

`FAILED` is a terminal failure state from any operational phase.

Implementation is forbidden until clarification is complete, business facts are complete or explicitly marked as user-provided later, the final brief is approved, one of three designs is selected, and architecture is accepted by the configured workflow. The state machine and transition guards are now implemented as pure TypeScript domain contracts under `src/domain/workflow/`. Persistence, agents, orchestration, and UI are still not implemented.
