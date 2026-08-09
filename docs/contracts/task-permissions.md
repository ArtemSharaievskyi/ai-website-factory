# Task permissions

Tool permissions are resolved by task type. Implementation tasks may read/write the generated workspace and later read versioned documentation or approved component registries. Database tasks additionally receive database read/write categories. Functional QA alone may receive `Playwright-functional`. `Magic-Patterns-design` and `git-write` are rejected in implementation graphs. Context7 remains read-only. No shell runner is exposed.

Skills are selected only from the approved registry snapshot, filtered by role, task type, required tools, forbidden tools, approval status, and context budget. An empty registry is valid; no skill is imported or approved automatically.
