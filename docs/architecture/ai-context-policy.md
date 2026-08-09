# AI context policy

Role prompts are versioned (`lead.v1`, `planner.v1`, `design.v1`, `implementation.v1`, `orchestrator-planning.v1`) and share an immutable no-invention policy. Implementation context continues to be assembled by the existing bounded `TaskContextAssembler`; the provider receives only task-relevant artifacts, approved skills, allowed tools, conventions, and checksums.
