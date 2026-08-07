# Runtime Quality Checks

The runtime validator maps npm-ci, lint, typecheck, tests, and build to the existing `QualityCheck` contract. Required skipped checks carry an explicit cancellation reason. A failed command maps to a stable repair category: dependency, source/style, TypeScript/API, implementation/test, or integration/runtime-build repair.
