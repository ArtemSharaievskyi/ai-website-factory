# Implementation task graph

Every implementation task carries requirement references, planning references, selected-design references when visual behavior is affected, acceptance criteria, bounded attempts, expected artifacts, file scopes, and task-specific tools. The existing domain graph schema remains the source of truth for dependency existence and cycle detection.

The graph uses deterministic IDs and checksums. Dependencies are ordered from workspace and foundation through selected design system, conditional backend foundations, shared layout, navigation, pages/forms, content/assets, SEO/motion, tests, validation, repair, and release preparation. Validation and release tasks cannot become ready before their prerequisites.

The graph is execution-ready only when validation succeeds, workspace reservation is available, source checksums are current, no blocking decisions remain, and a release quality path exists.
