# Workflow

## Planned state machine

`DRAFT → CLARIFYING → AWAITING_BRIEF_APPROVAL → AWAITING_DESIGN_SELECTION → READY_FOR_IMPLEMENTATION → IMPLEMENTING → VALIDATING → REPAIRING → PROJECT_READY`

`FAILED` is a terminal failure state from any operational phase.

Implementation is forbidden until clarification is complete, business facts are complete or explicitly marked as user-provided later, the final brief is approved, one of three designs is selected, and architecture is accepted by the configured workflow. The Orchestrator may create a graph while the project remains `READY_FOR_IMPLEMENTATION`; only explicit `startImplementation` transitions to `IMPLEMENTING`, and it does not execute tasks.

The Implementation Agent executes one READY task at a time after that transition. Passing a task only unlocks eligible dependents; it never starts the complete graph automatically.

Controlled full execution is an explicit subsequent operation. It transitions to `VALIDATING` only after implementation work completes and stops before `PROJECT_READY` release automation.
# Lead Agent milestone

The implemented workflow begins with prompt intake and clarification. After explicit Brief approval, the Planner / Architect Agent may create and accept a traceable planning package, then the Design Agent creates exactly three directions and waits for explicit user selection. Selection advances to `READY_FOR_IMPLEMENTATION`; no implementation agent is invoked by this milestone.
