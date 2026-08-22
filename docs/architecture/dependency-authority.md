# Generated-project Dependency Authority

The Factory owns generated-project direct dependency policy in `src/dependencies/authority.ts`. This is a host policy boundary, not an AI-generated catalog and not the Factory root `package.json` dependency manifest.

The authority chain is:

`Dependency Catalog -> current Planning intent -> current TaskGraph/task capability -> package.json validation -> npm-owned package-lock.json -> deterministic runtime/build/test/audit gates`

The catalog currently contains the 15 direct baseline packages emitted by the generated foundation. It contains zero optional entries because the repository does not currently contain Factory-owned direct version specifications for its documented optional Supabase, React Hook Form, Motion, or `@playwright/test` capability surfaces. Those candidates therefore fail closed until a deliberate catalog-maintenance change supplies approved specs.

| Question | Canonical authority | AI authority? |
| --- | --- | --- |
| Package permitted globally? | `DEPENDENCY_CATALOG` | No |
| Package needed by this project? | Current accepted Planning dependency intent | Planner may request; host decides |
| Task may use it? | Current TaskGraph/task capability and plan | No self-declaration |
| Version spec? | Catalog-owned exact approved spec | No |
| Manifest valid? | `validateGeneratedPackageManifest` | No |
| Lockfile? | Controlled npm materialization and root-direct validation | No AI-authored lockfile |
| Transitives? | npm lockfile resolution under authorized direct packages | No direct-catalog requirement |
| Security? | `npm audit` plus deterministic runtime gates | No absolute security claim |

The LLM, Planner alone, Implementation Agent, approved skills, skills.sh, Context7, Codebase Memory, shadcn Registry, and admin reports are non-authorities. Context7 and shadcn remain read-only advisory integrations; neither can expand the catalog or mutate package files. Implementation ChangeProposals may touch `package.json` only after host validation, while `package-lock.json` is outside AI mutation scope. The only allowed npm dependency materialization commands are the fixed package-lock-only command and `npm ci`; arbitrary package arguments are not exposed.

Planner `DependencyPlan` and technical-architecture references represent a direct package as one `name` string, using `package@versionSpec` when a version is present. The host parses the package identity and version at the Dependency Authority boundary, including scoped npm names, and validates both against the catalog. Architecture references must also match the current project DependencyPlan. Deterministic planning admission runs this validation, together with structure, traceability, package-manager, and fixed-stack checks, before any planning package persistence. User-resolution and publication blockers remain persisted as an unaccepted planning draft and are evaluated during Planning Acceptance.

These invariants are executable in `src/dependencies/authority.test.ts`, `src/agents/planner/planner.test.ts`, and `src/agents/planner/admission.test.ts`.

The Factory root manifest remains separate. Factory-only packages such as `openai`, `pg`, `@types/pg`, and `tsx` were not copied into the generated-project catalog.

Phase 7A evidence is recorded in [dependency-authority-result-2026-08-11.json](../admin/post-phase-6/dependency-authority-result-2026-08-11.json) and [dependency-authority-result-2026-08-11.md](../admin/post-phase-6/dependency-authority-result-2026-08-11.md).
