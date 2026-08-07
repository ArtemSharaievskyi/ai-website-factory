# Codebase Memory integration

Project Memory and Codebase Memory are distinct. Project Memory records the approved workflow and decisions. Codebase Memory is an optional, read-only structural index of one generated project version.

The Factory adapter uses the upstream `codebase-memory-mcp` stdio server through a dedicated port. The selected upstream operations are `index_repository`, `index_status`, `search_graph`, `trace_path`, `query_graph`, `get_code_snippet`, and `get_architecture`. Application code receives named port methods, never a generic tool executor.

Codebase Memory is disabled by default and is attached to Implementation, targeted repair, and reconciliation boundaries only.
