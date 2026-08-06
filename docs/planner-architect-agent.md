# Planner / Architect Agent

The Planner / Architect Agent starts only from an approved Project Brief while the workflow is `AWAITING_DESIGN_SELECTION`. It converts approved requirements into product scope, UX structure, content, assets, and fixed-stack technical planning. It cannot modify requirements, create visual directions, write source, install packages, run migrations for customer projects, or advance the workflow to implementation.

The default implementation is deterministic and network-free. The production GPT-5.6 Luna provider implements the narrow planner provider port, while provider output remains strictly validated and has no persistence, file-write, approval, or transition authority.
