# Repository codemap

This is a navigation aid, not runtime authority. Source contracts, services,
repositories, and validators remain canonical.

## Factory shell and Workbench

- `src/app/page.tsx` is the Workbench UI.
- `src/app/api/workbench/route.ts` validates the Workbench POST boundary and
  returns safe response envelopes.
- `src/app/api/workbench/assets/route.ts` exposes the project-scoped asset
  intake boundary.
- `src/runtime/workbench/contracts.ts` defines request and projection DTOs.
- `src/runtime/workbench/application.ts` maps actions to the canonical entry,
  planning, design, orchestration, persistence, and asset services.
- `src/runtime/workbench/production.ts` composes the server-only production
  runtime and the generated-project scope.
- `src/runtime/workbench/diagnostics.ts` owns safe Workbench diagnostics.
- `src/runtime/workbench/operation-ledger.ts` and
  `src/runtime/workbench/architecture-operation-ledger.ts` own bounded attempt
  timelines, provider counters, and terminal readback evidence.
- `src/runtime/workbench/observability.ts` defines response origin and runtime
  provenance metadata; `scripts/workbench-server.ts` writes build provenance
  and guards the npm/Next workspace root.

## Trial Entry and Lead

- `src/runtime/trial-entry/service.ts` is the shared create, clarification,
  status, Brief approval, and Brief-change application service.
- `src/runtime/trial-entry/idempotency.ts` defines operation identities.
- `src/runtime/trial-entry/node.ts` and `production.ts` compose CLI and server
  entry points; `cli.ts` only parses and renders command-line I/O.
- `src/agents/lead/service.ts` owns Lead orchestration through typed ports.
- `src/agents/lead/contracts.ts` defines Lead input/output contracts.
- `src/agents/lead/deterministic.ts` and `clarification-policy.ts` contain
  deterministic extraction and clarification rules.
- `src/agents/lead/errors.ts`, `ports.ts`, and `memory.ts` define local error,
  dependency, and persistence seams.

## OpenAI integration

- `src/integrations/openai/client.ts` owns the provider transport seam.
- `src/integrations/openai/adapters.ts` maps provider transport to typed role
  ports and host-owned metadata.
- `src/integrations/openai/production.ts` composes the server provider.
- `src/integrations/openai/prompts.ts` owns prompt text and prompt versions.
- `src/integrations/openai/config.ts`, `errors.ts`, `limiter.ts`, and `usage.ts`
  cover configuration, safe failures, rate limiting, and usage accounting.
- `src/integrations/openai/provider.test.ts` and
  `src/integrations/openai-v3/brief-v3-provider-contract.test.ts` cover provider
  boundaries and strict structured output behavior.

## Brief and canonical requirements

- `src/domain/requirements/schema.ts` is the typed requirements contract.
- `src/domain/requirements/brief.ts` contains Brief construction and related
  canonical transformations.
- `src/domain/requirements/v3/` owns the active ChangeSet reducer, effective
  delta, history, migration, and serialization boundaries.
- `src/domain/requirements/effective.ts` separates current effective
  requirements from retained historical requirements.
- `src/domain/requirements/brief-validation.ts` detects contradictions and
  computes approval blockers.
- `src/domain/project/initial-request.ts` and
  `src/domain/project/canonical-input.ts` preserve the initial request at the
  project boundary.

## Context and assets

- `src/runtime/context/assembler.ts` assembles role context.
- `src/runtime/context/bridge.ts` bridges canonical documents and provider-safe
  context; `slicing.ts` is for bounded supporting context only.
- `src/runtime/context/contracts.ts`, `source.ts`, and `telemetry.ts` define
  provenance and safe metadata.
- `src/runtime/context/lossless-context.test.ts` protects canonical
  requirement completeness.
- `src/runtime/assets/service.ts` owns server-side asset intake, deduplication,
  readiness, and project-scoped references.
- `src/domain/assets/schema.ts` and `project.ts` define asset contracts.

## Persistence

- `src/persistence/database/types.ts` defines the transaction and database
  ports.
- `src/persistence/database/repositories.ts` owns repository operations,
  document parsing, currentness, idempotency, and workflow transitions.
- `src/persistence/database/postgres.ts` is the Postgres adapter.
- `src/persistence/database/fake.ts` is the deterministic test database.
- `src/persistence/database/mapping.ts` maps domain documents and database
  rows; `serialization.ts` computes document hashes/checksums.
- `src/persistence/database/server.ts` composes server persistence.
- `src/persistence/project-memory/` stores versioned `.factory` workflow
  documents and memory snapshots.
- `supabase/migrations/` is the schema source; `scripts/validate-migrations.mjs`
  validates migration structure.

## Planner, Design, Orchestration, and Implementation

- `src/agents/planner/` defines planning contracts, deterministic/provider
  seams, acceptance, and memory.
- `src/agents/design/` defines the three-direction design contract,
  generation, selection, and memory.
- `src/orchestration/orchestrator/` creates and validates TaskGraphs and owns
  lifecycle operations.
- `src/orchestration/execution/` runs bounded TaskGraph execution, repair, and
  reconciliation.
- `src/agents/implementation/` owns task validation, bounded context,
  proposals, atomic apply, and implementation execution.
- `src/agents/implementation/design-resources.ts` describes the bounded
  typography, palette, and Aceternity discovery capabilities available to the
  existing FrontendImplementationAgent; it is not an Approved Skills Registry
  or installation authority.
- `src/integrations/design/emil.ts` pins the current audited Emil Kowalski
  skill provenance, immutable registry IDs, content checksums, and motion
  token rules; `scripts/phase8-approve-emil-skills.ts` imports a checked-out
  upstream revision through the registry lifecycle.
- `src/agents/reviewers/` contains read-only Architecture, Contract, Code /
  Integration, Security, Test / Quality, and lightweight post-implementation
  review contracts and services. `src/agents/reviewers/lightweight/design-motion.ts`
  owns independent Design Review, Animation Review, motion improvement plans,
  and bounded motion-opportunity advice; all are snapshot-bound and
  source-write-free.
- `src/agents/catalog.ts` is the current agent/capability assignment authority.

- `src/domain/design/resources.ts` owns the checksum-bound Google Fonts,
  Color Hunt, and Aceternity contracts, semantic palette checks, Next font
  implementation plan, privacy checks, and separate task-authorized install
  gate.
- `src/integrations/design/` contains the bounded read-only adapters and
  injected transports for Fontpair, Google Fonts, Color Hunt, Aceternity UI,
  component-source research, host-controlled design quality evidence, and
  current Emil provenance.

## Validation and generated runtime

- `src/runtime/validation/` runs generated-project lint, typecheck, tests,
  build, security, and diagnostic normalization.
- `src/runtime/qa/` owns controlled functional QA and Playwright evidence.
- `src/runtime/e2e/` contains the production smoke harness and lifecycle
  fixtures.
- `src/runtime/workspace/` reserves and synchronizes generated workspaces.
- `src/runtime/production-factory-runtime-core.ts` composes project scopes;
  `production-factory-runtime.ts` exposes the runtime surface.
- `scripts/factory-new.ts`, `factory-respond.ts`, and `factory-status.ts` are
  the CLI entry points.
- `scripts/generated-runtime-smoke.ts`, `playwright-smoke.ts`,
  `factory-e2e-smoke.ts`, and `taskgraph-smoke.ts` exercise larger boundaries.

## Codex Level 2 guards

- config/codex/architecture.json defines the stable UI, domain, provider,
  persistence, and OpenAI client boundaries. scripts/codex/check-architecture.ts
  resolves the real TypeScript import graph and reports baseline debt without
  rewriting production.
- scripts/codex/baseline-failures.ts and registered-guards.ts capture
  execution-derived fingerprints at codex:start. verify.ts blocks new,
  changed, or touched failures and reports exact unchanged failures as
  BASELINE_FAILURE.
- .agents/skills contains the procedural debug-production-bug,
  modify-openai-contract, review-implementation, finish-task,
  canonical-planning-refresh, restore-artifact-currentness,
  architecture-review-run, design-generation-run, and
  provider-failure-forensics skills.
- scripts/codex/review-context.ts emits bounded structural handoff context for
  an independent read-only review.

- `config/codex/check-map.json` maps changed path prefixes to controlled check
  IDs; `regressions.json` activates the executable regression memory from
  `docs/codex/KNOWN_FAILURES.md`.
- `config/codex/provider-contracts.json` records stable production contract
  references; it contains metadata only, not executable commands.
- `scripts/codex/check-affected.ts` resolves changed files against the saved
  `.codex/session.json` baseline and can run the code-owned checks in
  `scripts/codex/checks.ts`.
- `scripts/codex/task-envelope.ts` validates the mode/mutation/budget contract;
  `scripts/codex/task.ts` is its read-only `codex:task` preflight entrypoint.
- `scripts/codex/check-provider-contracts.ts` calls the real structured-output
  builders without constructing an OpenAI client or making a network request.
- `scripts/codex/start.ts`, `protected-state.ts`, and `verify.ts` manage the
  ignored protected-project session and final verification.
- `scripts/codex/production-paths.ts` registers evidence against existing
  high-level tests; `src/runtime/codex/tooling.test.ts` tests the guard logic.

See `docs/codex/WORKFLOWS.md` for paths through these modules and
`docs/codex/ARCHITECTURE.md` for authority boundaries.
