# Developer Tooling & Capability Layer

> Status: CURRENT_ARCHITECTURE
> Policy: `developer-tooling-policy-v1`
> Authority: `src/domain/tooling/schema.ts`, `src/orchestration/tooling/registry.ts`, and `src/orchestration/tooling/authority.ts` are runtime sources of truth. This document is descriptive.

Phase 7B adds a small host-controlled boundary for developer operations. It does not create a second agent framework, an external tool marketplace, an MCP server, or a new persistence model.

## Authority hierarchy

```text
current TaskGraph task and derived required capability
        + AgentDefinition.allowedTools
        + immutable Tool Registry / ToolDefinition operation
        + host-resolved current project, version, task, workspace, and executor binding
        + task file-scope ∩ host file-scope
        -> typed bounded ToolResult with content-trust metadata
```

The agent can request a registered operation. It cannot register a tool, grant itself a capability, override project or workspace identity, choose an executor, expand file scope, authorize a dependency, or approve a mutation. `authorizeToolRequest` canonicalizes legacy request IDs, binds the request to a host-resolved `ToolHostContext`, and fails closed on any missing or mismatched fact.

`AgentDefinition.capabilities` is the agent-role capability namespace (for example, `implementation.code`). Tool-operation capabilities are a separate task/registry namespace (for example, `validation.typecheck`) and are authorized only from the current task's derived capability set. Agent-role capability labels are not treated as tool permissions.

| Decision | Canonical authority | Agent override? |
| --- | --- | --- |
| Task needs a capability | current TaskGraph task and deterministic task-type mapping | No |
| Agent may invoke a tool | `AgentDefinition.allowedTools` in `src/agents/catalog.ts` | No |
| Tool exists | `TOOL_REGISTRY` | No |
| Operation is supported | the registered `ToolDefinition` | No |
| Project/workspace is current | host `ToolProjectScope` and task identity | No |
| Dependency change is allowed | `src/dependencies/authority.ts` | No |
| Source mutation is allowed | `ImplementationChangeProposal` validation and atomic apply | No |
| Command execution is allowed | generated runtime policy and `GeneratedProjectRuntimeValidator` | No |

## Concepts

- A capability is a task obligation such as `docs.library-read`, `source.inspect`, or `validation.typecheck`.
- A tool is a host-controlled integration such as Context7, Codebase Memory, or generated runtime validation.
- An operation is one bounded action on a tool, such as `query-documentation`, `get-relevant-source`, or `typecheck`.
- An executor is trusted Factory code or an existing adapter. It is never supplied by the model.
- A `ToolRequest` contains only current identity, a registered tool/operation ID, and typed operation input. It contains no shell string, filesystem root, network URL, permission override, or executor path.
- A `ToolResult` contains operation-policy-bounded structured data, bounded summaries, evidence identity, content-trust metadata, redaction/truncation metadata, and retry classification.

## Active inventory

| Tool | Operations | Mutation | Network | Required capability | Executor |
| --- | --- | --- | --- | --- | --- |
| `openai-generation` | `generate-structured-output` | read-only transport | current existing integration | none | strict OpenAI structured-output provider |
| `context7-read` | `resolve-library`, `query-documentation` | read-only | approved external read-only | `docs.library-read` | Context7 documentation service |
| `shadcn-registry-read` | `resolve-component`, `fetch-component-reference` | read-only | current approved integration | `ui.registry-read` | official shadcn Registry service |
| `codebase-memory-read` | `ensure-index`, `find-symbol`, `get-relevant-source` | read-only | none | `codebase.structure-read`, and `source.inspect` for relevant source | Codebase Memory service |
| `generated-runtime-validation` | `install-locked`, `npm-ci`, `lint`, `typecheck`, `unit-test`, `build` | validation execution | current existing integration for dependency materialization; none for validation | `dependency.materialize` or the corresponding validation capability | existing generated runtime validator |
| `playwright-functional-qa` | `run-functional-flow` | validation execution | none | `validation.functional` | existing Functional QA service |

Runtime validation and Playwright operations are host-executor operations. They remain unavailable to the current AI agent definitions unless an explicit catalog permission is later granted. Registering them does not grant that permission.

The two dependency-materialization operations use the current existing npm/runtime integration under the host's Dependency Authority; lint, typecheck, unit-test, and build are no-network validation operations. The registry records this distinction per operation.

## Source inspection

The Implementation Agent already receives bounded task-scoped source context through `src/agents/implementation/policy.ts` and may use current Codebase Memory structural context when the TaskGraph grants its legacy integration permission. Phase 7B documents that path as `source.inspect`; it does not add a generic filesystem-read operation.

Codebase Memory remains read-only and identity-bound to project, version, workspace, and source manifest. Any explicit source selector must be repository-relative, inside the intersection of the current host scope and the task's `fileScopes`, and bounded. Absolute paths, traversal, `.env` files, secret-bearing files, `node_modules`, `.next`, `.qa-foundation-*`, and `.context7-cache` are denied. There is no directory dump operation.

## Typed operation contracts

`CAPABILITY_REGISTRY` is the single registry-owned source for operation eligibility and task-type capability obligations. `deriveTaskCapabilities` matches the registry's task-type patterns; `AgentDefinition.allowedTools` intersects with those task capabilities but never creates them. Registry validation rejects unknown input/output schema references and capability-to-operation drift. Existing Context7, shadcn, Codebase Memory, runtime, and Functional QA schemas are used at the output boundary; external/integration results are marked `UNTRUSTED_EXTERNAL` in `ToolResult` and remain advisory data.

`src/orchestration/tooling/adapters.ts` binds each registered executor identity to an existing typed integration port or service. Runtime operations dispatch through `executeControlledRuntimeOperation`; other adapters retain their existing Context7, shadcn, Codebase Memory, and Functional QA service contracts and use `registeredOutputToToolResult` for the bounded untrusted result envelope.

## Controlled commands

`src/orchestration/tooling/executors.ts` dispatches typed runtime operation IDs to the existing `GeneratedProjectRuntimeValidator`. It never accepts a raw command string or package arguments. The existing runtime policy owns exact npm executable/argument arrays, staging-workspace checks, restricted environment construction, timeouts, diagnostic normalization, output limits, and cancellation.

`install-locked` is the fixed lockfile materialization command. It does not mean `npm install <package>`. Manifest changes must first pass the Phase 7A Dependency Authority and ChangeProposal gates. `npm-ci`, lint, typecheck, unit tests, and build consume only the current generated-project workspace. The operation's registered `resultPolicy` supplies the byte, line, and redaction bounds used by the result converter.

There is no `shell`, `terminal`, `execute-command`, `powershell`, `cmd`, or arbitrary npm operation.

## Mutation and integration boundaries

The registry contains no generic write, edit, delete, rename, or move operation. The Implementation Agent still emits a structured `ImplementationChangeProposal`; existing scope, dependency, checksum, and atomic-apply validators remain the sole normal source mutation path. AST-aware patching is deferred to Phase 7D.

Context7 remains allowlisted, version-aware, bounded, retry-limited, optionally unavailable, and advisory. It cannot install a package or expand architecture. The official shadcn Registry remains read-only, approved-source-only, bounded, and non-installing. Codebase Memory remains durable, read-only, currentness-bound structural context. Playwright remains controlled functional QA; no screenshots, visual regression, arbitrary evaluate, video, or trace tooling was added.

TaskGraph `allowedTools` still contains legacy execution-policy identifiers such as `filesystem-read`, `filesystem-write`, `Context7-read`, and `Playwright-functional` for compatibility with the existing orchestrator and QA contracts. The generated foundation and validation tasks also carry the host-controlled `generated-runtime-validation` permission; functional validation carries the host-controlled Playwright identity. `canonicalToolId` is the single Phase 7B normalization boundary for legacy Context7, Playwright, and incoming ToolRequest names; filesystem read/write permissions are not developer-tool registry entries and do not become generic tool authority.

Skills remain checksum-bound procedural context. Skills do not grant tools, and tools do not grant skills or dependencies. The current OpenAI provider remains strict structured output; Phase 7B does not add an iterative agent-tool loop. Tool selection is host-derived and may be zero, one, or several relevant operations.

No Factory-owned deterministic image optimizer or approved font catalog/source is currently available. Image optimization is `DEFERRED_TOOL_NOT_CURRENTLY_AVAILABLE`; font catalog access is `DEFERRED_NOT_CURRENTLY_AVAILABLE`. No dependency, download service, or arbitrary URL tool was added.

## Explicitly deferred

- Phase 7C: broader typed Planner Task/Data Contracts.
- Phase 7D: AST-aware patching.
- Phase 7E: QA temporary-workspace lifecycle and historical `.qa-foundation-*` cleanup.
- Final hardening audit and customer website-generation E2E.
