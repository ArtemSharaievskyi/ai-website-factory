# Codebase Memory impact analysis

Impact analysis is advisory. It can identify callers, references, importers, routes, and components related to a target, but it never expands a task's authorized write scope. If affected files are outside the task scope, the repair workflow receives `CODEBASE_MEMORY_SCOPE_EXPANSION_REQUIRED` and must create or revise an authorized task.

SitemapPlan and Project Memory remain authoritative for intended routes and workflow state. Codebase Memory only describes code that currently exists.
