# Read-only shadcn/ui Registry integration

The Registry is an optional, server-only source of approved component definitions and metadata. The only enabled registry is the official shadcn/ui registry. A task-specific implementation query is resolved, normalized, security-scanned, dependency-checked, and attached as advisory context. It never writes files, installs components, mutates package.json, changes Tailwind or globals.css, or executes a CLI.

The selected DesignDirection, accepted DependencyPlan, task file scopes, and existing Implementation validators remain authoritative. Automatic installation, Motion, Magic Patterns, Preview, deployment, and generic MCP are not implemented.
