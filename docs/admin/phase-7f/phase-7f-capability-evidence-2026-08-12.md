# Phase 7F — Professional Design Capability Layer

Status: **BLOCKED — external evidence required**

Baseline: `9e911d6b8314b4074abc30190372f325574c4ff2` (Phase 7E administrative head).

Implemented in this worktree:

- strict visual-system, typography, motion, interaction, provenance, pass-evidence, selection-binding, and dependency-amendment contracts;
- bounded Magic Patterns, Fontpair, host-controlled Impeccable, approved-skill evidence, and typed orchestration adapters;
- exact three-direction professional package binding;
- Motion `12.43.0` through Dependency Authority only;
- implementation and `START_IMPLEMENTATION` gates for current selected design contracts;
- deterministic F1–F64 matrix and focused adapter/pipeline tests.

Deterministic and repository validation is passing: 82 test files / 1,016 tests, typecheck, lint (0 errors and the two existing warnings), production build, Docker Compose config, migration validation, migration integrity, TaskGraph smoke, generated-runtime smoke, backend smoke, and `git diff --check`. The focused adapter/pipeline tests and F1–F64 matrix also pass. Live verification is not complete:

1. `MAGIC_PATTERNS_CREDENTIAL_REQUIRED` — the required environment variable is `MAGIC_PATTERNS_API_KEY`. No secret was requested, printed, or persisted.
2. `FONTPAIR_SOURCE_INTEGRATION_UNRESOLVED` — the current `https://fontpair.co/` response is client-rendered and contains no curated pair records in the bounded HTML response.
3. `DESIGN_SKILL_NOT_AVAILABLE_THROUGH_APPROVED_SOURCE` — 0/8 required official Impeccable, Emil, and transitions.dev skills are immutable approved registry records.

The live command is `npm run phase7f:live-check`. Phase 7F is not marked complete. Final Hardening Audit, clean customer E2E, and deployment remain deferred.
