# Implementation roadmap

1. Foundation: this single application, npm, Docker, hygiene, and decisions.
2. Durable workflow state: define approved Supabase schema, repositories, state transitions, and versioned Workspace Manager output.
3. Approved skills: implement isolated import, static review, manual approval, immutable copies, permissions, and bounded loading. The registry is currently empty.
4. Requirements: implement Lead Agent clarification and brief approval.
5. Design: implement three-direction proposal and selection freeze.
6. Generation: add project workspace, planning, implementation, and approved integrations.
7. Validation and release: add deterministic checks, functional browser tests, repair loops, versioning, local Git, and optional GitHub creation.

Deployment, Preview, arbitrary tool installation, and unapproved infrastructure remain excluded.
# Planner / Architect milestone

The Planner / Architect foundation now consumes only approved Briefs, produces deterministic traceable planning documents, and accepts them without advancing beyond `AWAITING_DESIGN_SELECTION`. Design directions, implementation, source generation, and release remain future work.
