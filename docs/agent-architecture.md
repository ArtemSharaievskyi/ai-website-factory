# Agent architecture

This is planned architecture, not implemented code. The lightweight role structure is:

1. **Lead Agent** communicates with the user, extracts requirements, asks every unresolved question, creates the final brief, and requests approval. It does not write production code.
2. **Planner / Architect Agent** creates product, UX, technical, content, and asset plans within the fixed stack. It does not add infrastructure without requirements.
3. **Design Agent** prepares exactly three structured visual directions, may later use approved Magic Patterns integration, does not design backend architecture, and waits for selection before production implementation.
4. **Implementation Agent** works in the generated project workspace using approved skills and tools, implementing only the approved specification.
5. **QA / Release Agent** runs deterministic validation and targeted repairs, later using Playwright and Playwright MCP for functional checks. It creates the local version, Git repository, and GitHub repository, but never deploys.

Skills provide reviewed specialization to roles; they do not replace the Orchestrator. Agents must not install arbitrary skills, change requirements, invent facts, or broaden infrastructure.
