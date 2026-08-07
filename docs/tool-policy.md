# Tool policy

AI provider calls are server-only structured requests; provider output has no tool, filesystem, approval, or workflow-transition authority.

- **Context7** is a read-only, optional source for bounded version-specific library documentation; it requires explicit `Context7-read` permission and does not make architecture decisions.
- **Magic Patterns** is limited to the design stage and exactly three directions; its output requires adaptation before production use.
- **Motion** is optional and purposeful, not automatic.
- **ESLint** is a mandatory quality gate.
- **Playwright MCP** later supports functional browser QA and does not replace committed Playwright tests.
- **shadcn/ui** may use only official and explicitly approved registries. It is a customizable technical base, not a fixed visual template.

The Context7 port is server-only and injectable; no general MCP executor or shadcn registry is integrated.

The Orchestrator resolves task-specific permissions for future execution. Magic Patterns is rejected for implementation tasks; Playwright is limited to functional QA; Context7 remains read-only; Git write and unrestricted shell execution are not granted.

The Implementation Agent foundation connects only internal filesystem-read and filesystem-write capabilities. npm, database, browser, image, documentation, registry, and shell capabilities remain disconnected.

Imported skills do not select or install tools. Tool permissions are explicit approval fields and are checked together with role, task type, checksum, and context limits. The registry currently contains no approved external skills.
