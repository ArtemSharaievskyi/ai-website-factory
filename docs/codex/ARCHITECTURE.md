# Current architecture for Codex

The Factory is a local-first Next.js application with typed domain contracts,
server-side application services, injected provider adapters, transactional
persistence, and bounded generated-project execution.

## Authority boundaries

| Boundary | Owns | Does not own |
| --- | --- | --- |
| Workbench UI/API | transport, projections, safe user actions | canonical state, provider calls, SQL |
| Trial Entry | project intake, clarification rounds, status, Brief approval/change requests | provider transport, browser authority |
| Lead | extraction, clarification, Brief proposal through typed contracts | source code, approval authority, workflow mutation outside its service |
| Domain requirements | canonical schema, effective requirements, V3 reducer semantics, contradictions | HTTP, persistence, provider transport |
| OpenAI adapter | transport, prompt assembly, strict provider parsing, role-port mapping | identity, checksums, approval, currentness, history |
| Persistence | transactions, repositories, row versions, idempotency, document validation, events | UI decisions, prompt wording, architectural policy |
| Orchestration | TaskGraph lifecycle, retries, repair, reconciliation | arbitrary model/tool access, unapproved scope |
| Implementation | one authorized task, bounded context, proposal/apply validation | deployment, unrestricted shell/npm/network/Git |
| QA/validation | deterministic generated-runtime evidence and functional QA | changing requirements or silently fixing source |

Canonical requirements are lossless and checksum-bound. Supporting technical
context can be selected, sliced, or reduced with provenance. Provider results
are proposals and must be validated before host-owned metadata is attached.

Brief mutation has exactly one authority: `BriefV3TransactionService` with the
V3 reducer and atomic persistence transaction. Legacy V1/V2 Briefs remain
readable and migrate deterministically in memory; compatibility is not a legacy
write path. Providers and future agents may propose bounded typed intent or
review findings, but may not own canonical currentness, persistence identity,
workflow state, idempotency, or mutation commit.

## Workflow shape

The current high-level lifecycle is:

`DRAFT -> CLARIFYING -> AWAITING_BRIEF_APPROVAL -> AWAITING_DESIGN_SELECTION -> READY_FOR_IMPLEMENTATION -> IMPLEMENTING -> VALIDATING -> PROJECT_READY`

`FAILED` is a safe failure state from operational phases. The domain workflow
engine and persistence service enforce state, row-version, checksum, approval,
currentness, and dependency guards.

Lead is the first semantic owner. Brief approval precedes planning; planning
acceptance and architecture review precede Design; exactly three Design
Directions precede explicit selection; a current accepted package, contract
audit, and TaskGraph precede implementation start. Implementation executes one
ready task at a time. Validation and review gates remain separate from AI role
services.

## Data and runtime shape

The browser sends a validated action to the Workbench route. The server
application service reconstructs current project documents and calls the
canonical service for that action. Repository operations occur through a
transaction. Generated customer output is a separate versioned workspace, not
an embedded Preview and not a mutable source subtree of the Factory.

The Factory uses one configured OpenAI provider/model through role-specific
ports. Deterministic providers remain useful for offline tests. Generated
projects may opt into database, Auth, Storage, or external APIs only through
approved planning and implementation contracts.

## Machine-enforced boundaries

config/codex/architecture.json is the registered boundary policy and
scripts/codex/check-architecture.ts inspects actual TypeScript imports. It
handles relative and tsconfig-alias imports, nested index modules, Windows and
POSIX separators, and TS/TSX sources. The current rules prevent UI/app direct
persistence or OpenAI imports, domain dependencies on Workbench/UI or provider
implementations, OpenAI integration dependencies on Workbench/UI, persistence
dependencies on UI, direct OpenAI client imports outside the approved
integration boundary, and production Brief-mutation imports of obsolete V2
mutation modules.

Existing violations are captured by the execution-derived baseline at
codex:start. They are reported as baseline debt; touching their source or
trigger path, changing their fingerprint, or introducing a new violation
blocks codex:verify.

## Not architecture

The following are intentionally not current architecture and must not be added
by implication:

- an event bus, worker queue, microservice split, or LangGraph runtime;
- a Deployment Agent or automatic deployment integration;
- an embedded customer Preview, iframe, wildcard localhost routing, reverse
  proxy, or Preview container;
- unrestricted shell, npm, network, model, MCP, or Git capability for the
  Implementation Agent;
- arbitrary dynamic skills or tool permissions.

For placement and source navigation, use `docs/codex/CODEMAP.md`. For durable
decisions, consult `docs/adr/` and the existing architecture documents.
