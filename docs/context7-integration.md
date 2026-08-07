# Read-only Context7 integration

Context7 is an optional, server-only documentation reference boundary. It resolves only approved/planned package identities, creates narrow query plans, normalizes bounded text excerpts, and exposes no URL fetch, write operation, file upload, command execution, or generic MCP executor.

The accepted Brief, DependencyPlan, selected design, architecture, task scopes, and validators remain authoritative. Context7 output is untrusted advisory material. The Planner boundary is explicit (`requestPlannerDocumentation`); the Implementation `TaskContextAssembler` attaches excerpts only for permitted, relevant tasks and within the context budget. Disabled or offline Context7 leaves deterministic workflows unchanged.

Approved targets are the fixed stack (`next`, `react`, `react-dom`, `typescript`, `tailwindcss`, `zod`, `react-hook-form`, Supabase clients, Vitest, Playwright) plus Motion only after design and dependency approval.
