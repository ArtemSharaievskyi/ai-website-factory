# Agent architecture

Production provider calls are server-only adapters behind the existing role ports; deterministic providers remain available for offline tests.

The role structure is planned, but the Lead Agent intake/brief boundary, Planner / Architect planning boundary, and Design Agent selection boundary are implemented. The lightweight role structure is:

1. **Lead Agent** communicates with the user, extracts requirements, asks every unresolved question, creates the final brief, and requests approval. It does not write production code.
2. **Planner / Architect Agent** creates product, UX, technical, content, and asset plans within the fixed stack. It does not add infrastructure without requirements.
3. **Design Agent** prepares exactly three structured visual directions, may later use approved Magic Patterns integration, does not design backend architecture, and waits for selection before production implementation.
4. **Implementation Agent** executes one READY implementation task at a time in a reservation-owned staging workspace using bounded context, approved skills, and task-specific internal filesystem capabilities. It applies deterministic structured proposals only; full autonomous generation remains future work.
5. **QA / Release Agent** runs deterministic validation and targeted repairs, later using Playwright and Playwright MCP for functional checks. It creates the local version, Git repository, and GitHub repository, but never deploys.

Skills provide reviewed specialization to roles; they do not replace the Orchestrator. In the current milestone no external skill is required. Agents must not install arbitrary skills, change requirements, invent facts, or broaden infrastructure.
