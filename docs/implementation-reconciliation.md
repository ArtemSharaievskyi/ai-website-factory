# Implementation reconciliation

Reconciliation reports interrupted RUNNING tasks, missing execution results, and other safe execution-state discrepancies. Ambiguous workspace, checksum, skill, selected-design, and transaction conditions require explicit inspection; the service does not silently rewrite the TaskGraph or delete workspace output.
