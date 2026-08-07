# Tool policy

AI provider calls are server-only structured requests; provider output has no tool, filesystem, approval, or workflow-transition authority.

- **Context7** is a read-only, optional source for bounded version-specific library documentation; it requires explicit `Context7-read` permission and does not make architecture decisions.
- **Magic Patterns** is limited to the design stage and exactly three directions; its output requires adaptation before production use.
- **Motion** is optional and purposeful, not automatic.
- **ESLint** is a mandatory quality gate.
- **Playwright MCP** later supports functional browser QA and does not replace committed Playwright tests.
- **shadcn/ui** may use only official and explicitly approved registries. It is a customizable technical base, not a fixed visual template.

The Context7 and shadcn Registry ports are server-only and injectable; neither is a generic MCP executor. shadcn Registry access is read-only and limited to relevant implementation tasks.

The Orchestrator resolves task-specific permissions for future execution. Magic Patterns is rejected for implementation tasks; Playwright is limited to functional QA; Context7 remains read-only; Git write and unrestricted shell execution are not granted.

Codebase Memory is a separate, optional read-only structural source. Only implementation, targeted repair, and reconciliation tasks may receive `codebase-memory-read`; it never grants filesystem scope or write authority.

Playwright-functional exposes only approved route, form, assertion, and error-capture operations; it has no arbitrary evaluator, MCP executor, screenshot review, or external URL access.

The Implementation Agent foundation connects only internal filesystem-read and filesystem-write capabilities. npm, database, browser, image, and shell capabilities remain disconnected; documentation and Registry references are optional advisory inputs.

Backend task handlers do not execute customer SQL, npm, builds, or network operations. Context7 remains optional documentation enrichment; shadcn Registry remains limited to relevant form UI tasks.

Imported skills do not select or install tools. Tool permissions are explicit approval fields and are checked together with role, task type, checksum, and context limits. The registry currently contains no approved external skills.
# Runtime command boundary

Generated runtime validation has its own npm-only allowlist and does not expose a generic command tool.
