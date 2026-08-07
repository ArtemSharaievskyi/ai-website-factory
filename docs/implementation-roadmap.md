# Implementation roadmap

The production provider foundation is now available behind existing ports; real smoke testing remains explicit opt-in.

1. Foundation: this single application, npm, Docker, hygiene, and decisions.
2. Durable workflow state: define approved Supabase schema, repositories, state transitions, and versioned Workspace Manager output.
3. Approved skills: implement isolated import, static review, manual approval, immutable copies, permissions, and bounded loading. The registry is currently empty.
4. Requirements: implement Lead Agent clarification and brief approval.
5. Design: implement three-direction proposal and selection freeze.
6. Generation: add project workspace, planning, and controlled single-task Implementation Agent execution. The Orchestrator provides deterministic TaskGraph planning; full graph execution and customer website generation remain future work.
7. Validation and release: add deterministic checks, functional browser tests, repair loops, versioning, local Git, and optional GitHub creation.

Deployment, Preview, arbitrary tool installation, and unapproved infrastructure remain excluded.
# Planner / Architect milestone

The Planner / Architect foundation now consumes only approved Briefs, produces deterministic traceable planning documents, and accepts them without advancing beyond `AWAITING_DESIGN_SELECTION`. The Design Agent now creates exactly three deterministic directions and waits for explicit selection before `READY_FOR_IMPLEMENTATION`. Implementation, source generation, and release remain future work.
# Read-only Context7 documentation enrichment is implemented; shadcn Registry, Magic Patterns, Preview, deployment, and customer repository automation remain future work.

Read-only shadcn Registry references are now available for explicitly permitted implementation tasks. Automatic installation and backend task-handler integration remain future work.

Backend task-handler foundation is implemented; customer migration execution, generated-project npm/build/test execution, Playwright, Preview, and deployment remain future work.
# Runtime validation foundation

The runtime-validation module provides the npm-only command policy, deterministic runner contract, quality mapping, and reconciliation boundary.

The Playwright foundation adds controlled functional QA after runtime validation; real browser smoke remains explicit opt-in.
