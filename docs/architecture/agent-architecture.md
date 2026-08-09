# Agent architecture

Production provider calls are server-only adapters behind the existing role ports; deterministic providers remain available for offline tests. Prompt text and prompt versions remain owned by `src/integrations/openai/prompts.ts`; the catalog records that ownership and the provider adapter owns transport and normalization.

The current typed flow is:

`user/workflow requirement -> capability -> AgentDefinition -> bounded context/tools/approved skills -> typed result`

The catalog currently contains exactly these seven definitions:

| Agent | Role | Current capabilities | Write authority |
| --- | --- | --- | --- |
| Lead | generation | `requirements.clarify`, `requirements.brief` | requirements and workflow documents through its service |
| Planner | generation | `planning.architecture`, `planning.content`, `planning.assets` | planning package through its service |
| Design | generation | `design.directions`, `design.selection` | design documents and selection through its service |
| Implementation | implementation | `implementation.code`, `implementation.backend` | one reservation-owned implementation task at a time |
| Architecture Reviewer | review | `review.architecture` | read-only review result only |
| Contract Auditor | review | `review.contracts` | read-only review result only |
| Code / Integration Reviewer | review | `review.integration` | read-only review result only |

The role boundaries are:

1. **Lead Agent** communicates with the user, extracts requirements, asks every unresolved question, creates the final brief, and requests approval. It does not write production code.
2. **Planner / Architect Agent** creates product, UX, technical, content, and asset plans within the fixed stack. It does not add infrastructure without requirements.
3. **Design Agent** prepares exactly three structured visual directions, may later use approved Magic Patterns integration, does not design backend architecture, and waits for selection before production implementation.
4. **Implementation Agent** executes one READY implementation task at a time in a reservation-owned staging workspace using bounded context, approved skills, and task-specific internal filesystem capabilities. It applies deterministic structured proposals only; full autonomous generation remains future work.
5. **Architecture Reviewer** reviews an approved Brief and accepted PlanningPackage before Design. It combines deterministic prechecks with bounded AI architectural reasoning, returns an evidence-backed `ReviewResult`, and cannot modify project artifacts.
6. **Contract Auditor** reviews the final Brief → Planning → approved Architecture Review → selected Design → TaskGraph chain before implementation. It checks traceability, ownership, capabilities, executors, dependencies, and mandatory quality responsibilities; it does not re-review architecture taste or mutate any artifact.

The workflow gates are `Planning Acceptance -> ARCHITECTURE_REVIEW -> Design -> Design Selection -> Orchestrator/TaskGraph -> CONTRACT_AUDIT -> START_IMPLEMENTATION`. An approved Architecture Review unlocks Design; an approved current Contract Audit, checksum-consistent with all upstream artifacts, unlocks implementation. Reviewers return findings and correction targets; orchestration owns transitions and remediation.

## Permissions and policy

Agent tools are explicit integration IDs: `openai-generation`, `context7-read`, `shadcn-registry-read`, and `codebase-memory-read`. Agent definitions do not inherit wildcard tools or capabilities. Skills are empty for the current catalog and there is no `skills.sh` or external skill installation path in this milestone.

Each definition declares a versioned context policy with allowed categories, item and byte limits, plus an execution policy covering AI-generation permission, retry class, cancellation, concurrency, approval gates, and read-only status. Input and output contracts reference the existing typed agent schemas, while prompt versioning is tracked independently from context and execution policy versions. The Architecture Reviewer receives only the approved Brief, accepted PlanningPackage, fixed architecture policy, and bounded constraints.

The current review capabilities are `review.architecture`, `review.contracts`, and `review.integration`; Security and Test/Quality capabilities remain intentionally absent.

Skills provide reviewed specialization to roles; they do not replace the Orchestrator. In the current milestone no external skill is required. Agents must not install arbitrary skills, change requirements, invent facts, or broaden infrastructure.
Context7 is a replaceable documentation port at the Planner and Implementation context seams, not an Orchestrator or general MCP layer.

The Code / Integration Reviewer is a read-only semantic gate after implementation structural validation, lint, and typecheck. It receives only bounded source manifests/slices and canonical contract checksums, persists evidence-backed findings, and never writes source or invokes Implementation.

The shadcn Registry is a replaceable implementation-reference port, not a Design Agent, Orchestrator, installer, or general remote executor.
