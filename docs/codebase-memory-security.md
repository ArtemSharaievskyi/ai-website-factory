# Codebase Memory security

The integration is server-only and read-only with respect to customer source. It does not install MCP configuration, edit code, write ADRs, execute commands, browse the network, or expose the upstream server to agents.

Only an exact generated project/version workspace may be indexed. Factory roots, user profiles, sibling projects, filesystem roots, and arbitrary external paths are rejected. `.env*`, secrets, `.factory`, dependencies, build output, coverage, Git metadata, logs, and temporary files are excluded. The upstream cache is assigned to a Factory-managed location and is never committed.

The upstream installer and auto-configuration flows are deliberately not used. Results are untrusted structural references: they cannot alter requirements, grant tools, expand file scope, or trigger commands.
