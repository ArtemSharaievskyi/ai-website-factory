# Tool policy

- **Context7** is a read-only source for verified version-specific library documentation; it does not make architecture decisions.
- **Magic Patterns** is limited to the design stage and exactly three directions; its output requires adaptation before production use.
- **Motion** is optional and purposeful, not automatic.
- **ESLint** is a mandatory quality gate.
- **Playwright MCP** later supports functional browser QA and does not replace committed Playwright tests.
- **shadcn/ui** may use only official and explicitly approved registries. It is a customizable technical base, not a fixed visual template.

No tool is installed or integrated by this task.

The Orchestrator resolves task-specific permissions for future execution. Magic Patterns is rejected for implementation tasks; Playwright is limited to functional QA; Context7 remains read-only; Git write and unrestricted shell execution are not granted.

Imported skills do not select or install tools. Tool permissions are explicit approval fields and are checked together with role, task type, checksum, and context limits. The registry currently contains no approved external skills.
