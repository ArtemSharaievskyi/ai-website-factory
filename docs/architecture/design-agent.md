# Design Agent

The production `design.v1` provider returns only the existing strict three-direction contract and cannot select or persist a direction.

The Design Agent begins only after the Brief is approved, the Planner / Architect package is accepted, and the workflow is `AWAITING_DESIGN_SELECTION`. It creates exactly three structured visual directions for explicit user selection.

The supported Workbench entry point is `action: "generate-design"` when the
current state has an approved Architecture Review and no current direction
set. The Workbench reserves one idempotent operation for the Brief/Planning/
Review frontier and the Design Agent owns candidate validation and atomic
canonical persistence. A successful generation leaves the lifecycle at
`AWAITING_DESIGN_SELECTION`; selection is a separate explicit action.

It does not write customer source, generate images or logos, browse design references, call Magic Patterns, install Motion or shadcn components, create screenshots, or select a direction autonomously.
