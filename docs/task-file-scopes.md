# Task file scopes

Write-capable tasks declare relative, controlled path patterns. Unrestricted workspace scopes, absolute paths, traversal, `.env`, `.git`, and writes to Factory metadata are rejected. Parallel-safe tasks are allowed only when dependency order and write scopes are disjoint; parent-directory overlap is a conflict. Factory metadata is written through Factory services.
