# Repository Structure

> Status: CURRENT_ARCHITECTURE
> Authority: This document describes current repository placement. Source modules and typed contracts remain canonical, and this Markdown is not runtime configuration.

## High-level tree

```text
src/
  app/                         Next.js routes and UI
  agents/
    lead/                      Lead intake and clarification agent
    planner/                   Planner / Architect agent
    design/                    Design agent
    implementation/            Implementation agent
    reviewers/                 Read-only reviewer implementations
      architecture/            Architecture Reviewer
      contracts/               Contract Auditor
      code-integration/        Code / Integration Reviewer
      security/                Security Reviewer
      test-quality/            Test / Quality Reviewer
  domain/                      Shared workflow and product contracts
  orchestration/
    orchestrator/              TaskGraph planning and lifecycle coordination
    execution/                 Full TaskGraph execution, repair, and reconciliation
  integrations/
    openai/                    OpenAI provider adapter
    context7/                  Context7 documentation adapter
    shadcn/                    shadcn Registry adapter
    codebase-memory/           Optional Codebase Memory adapter
  persistence/
    database/                  PostgreSQL repositories and persistence ports
    project-memory/            Versioned .factory workflow documents
  runtime/
    workspace/                 Workspace lifecycle and synchronization
    validation/                Generated-project runtime validation
    qa/                        Playwright functional QA runtime
    e2e/                       Production smoke harness
  skills/registry/             Approved Skills Registry implementation
  shared/                      Small cross-cutting shared modules
tests/                         Reserved for integration/E2E fixtures when needed
skills/                        Imported skill content and data
docs/                          Architecture, contracts, integrations, operations, and ADRs
scripts/                       Smoke checks and database utilities
supabase/                      Database migrations
public/                        Factory static assets only
```

## Placement rules

- An agent performs one AI role and belongs under `src/agents/<role>/`. Agent-private prompts and structured-output contracts stay with that agent.
- Orchestration coordinates agents, task lifecycle, scheduling, retries, repair, and reconciliation; it does not contain AI-role implementations.
- Contracts consumed across boundaries belong under the relevant `src/domain/` area. Infrastructure-specific schemas stay with their adapter.
- External-system code belongs under `src/integrations/`; pure domain logic does not.
- Database access and repositories belong under `src/persistence/database/`; Project Memory belongs under `src/persistence/project-memory/`.
- Runtime mechanics belong under `src/runtime/`. Customer generated-project output paths and templates are not part of this repository refactor.
- Unit tests stay next to their owning module. Integration and full-system fixtures belong under `tests/` when introduced.
- Factory-internal generated, smoke, QA, and build artifacts are transient and ignored; they must not become source or customer output.
- Documentation is grouped by responsibility. Durable architectural decisions remain under `docs/adr/`.

The current nine-agent catalog includes five read-only reviewers implemented under `src/agents/reviewers/<role>/` as explicit role directories. Future reviewer capabilities, if approved, must first be reflected in the typed catalog and source tree; this document does not create agent eligibility.
