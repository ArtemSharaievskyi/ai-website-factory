# Execution Scheduler

Scheduling is iterative and bounded. Dependencies must be PASSED, file scopes cannot overlap, parallel-safe work is capped by policy, npm/build/browser work remains conservative, and newly unlocked tasks wait for the next iteration. Unsupported task types fail safely.
