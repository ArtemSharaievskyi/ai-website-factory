# Design Agent

The production `design.v1` provider returns only the existing strict three-direction contract and cannot select or persist a direction.

The Design Agent begins only after the Brief is approved, the Planner / Architect package is accepted, and the workflow is `AWAITING_DESIGN_SELECTION`. It creates exactly three structured visual directions for explicit user selection.

It does not write customer source, generate images or logos, browse design references, call Magic Patterns, install Motion or shadcn components, create screenshots, or select a direction autonomously.
