# Frontend capabilities integration

Status: CURRENT implementation evidence for the frontend integration milestone.
The dated skill-portfolio snapshots under `docs/admin/` remain historical
evidence and are not the runtime assignment authority.

## Scope and boundary

The Factory Design and FrontendImplementation paths now consume five
checksum-bound, Factory-owned normalized skill artifacts through the existing
`SkillRegistry` lifecycle. The normalized artifacts preserve the useful
procedures from the selected upstream resources without importing their
scripts, installers, agents, MCP servers, or foreign workflow authority.

The runtime still owns identity, planning, dependency decisions, currentness,
approval, source edits, and validation. Skill approvals grant zero tools. The
integration does not call an external AI provider, mutate customer projects,
launch Planning, or add database/deployment behavior.

## Selected resources and provenance

| Resource | Selected version or ref | License | Factory artifact | Actual consumer |
|---|---|---|---|---|
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 2.13.0; upstream main evidence `7f69fed` | MIT | `ui-ux-pro-max-frontend` | Design direction skill selection |
| [Taste Skill](https://github.com/Leonxlnx/taste-skill) | v2 experimental; upstream main evidence `ccbc156` | MIT | `taste-frontend-direction` | Design direction skill selection |
| [Design Motion Principles](https://github.com/kylezantos/design-motion-principles) | v2.1.1; upstream main evidence `4a9ca87` | MIT | `design-motion-principles` | Frontend motion tasks and Animation Review |
| [daisyUI](https://daisyui.com/docs/install/) | npm `5.7.42` as recorded by the current official docs | MIT | `daisyui-tailwind-v4` | Optional generated design-system task |
| [Magic UI](https://github.com/magicuidesign/magicui) | read-only `registry.json` on `main`; runtime response checksum is retained in Design evidence | MIT | `magic-ui-adaptation` | Selected Design candidate adaptation |
| [Context7 MCP](https://github.com/upstash/context7) | hosted MCP server 4.1.1; live protocol verified 2026-09-20 | MIT | Factory-owned typed MCP transport and adapter | Planner and frontend implementation documentation dispatch |
| [Codebase Memory](https://github.com/DeusData/codebase-memory-mcp) | DeusData release `v0.11.0`; Windows archive SHA-256 `6eb6beaf261b19e419766e78baf93cbc3cf1c6338cff8fb7c0234859f96d1685` | MIT | Factory-owned typed read-only process adapter | Frontend source reconnaissance |

The upstream resources are provenance, not canonical authority. The Factory
loads only the approved local copies under `skills/approved/`; those copies are
reproducible with `npm run skills:activate-frontend` from the tracked
`skills/internal/**` sources. `skills/registry/*.json` and `skills/approved/**`
are local runtime state by repository policy and are intentionally ignored.

## Runtime wiring

| Factory boundary | Integration | Selection guard |
|---|---|---|
| Design Agent | UI UX Pro Max and Taste guidance; existing Impeccable, Emil, ColorHunt, Google Fonts, Magic UI, 21st.dev, React Bits, and shadcn paths remain available | Design runtime supplies `design`, `typography`, `palette`, `ux`, and `frontend` surfaces; form guidance is still conditional |
| FrontendImplementationAgent | daisyUI, Magic UI adaptation, Design Motion Principles, Context7, shadcn, Codebase Memory, existing Emil/Impeccable/DialKit/anti-slop/checklist skills | daisyUI requires planned `daisyui`; Magic UI requires selected Design evidence; motion requires the existing motion signal; Context7 and Codebase Memory remain host-configured read-only ports |
| Animation Review | Design Motion Principles complements the existing Emil review/opportunity skills | Review task type and `review.animation` capability |
| Generated project foundation | Dependency Authority permits `daisyui@5.7.42` only as a planned `devDependency`; the deterministic foundation provider carries approved optional dependencies into `package.json` | Phase 7C dependency approval and exact version/section checks |
| CSS implementation | normalized guidance targets Tailwind v4 `@import "tailwindcss";` plus opt-in `@plugin "daisyui";` in the generated global stylesheet | Only when the selected plan includes daisyUI; no default theme or all-theme activation |

Magic UI remains a read-only source adapter. The existing adapter filters free
public registry UI candidates, marks them adaptation-required, and preserves
source checksums; it does not write source or install a remote component.
ColorHunt remains unchanged as an inspiration-only, read-only palette source
and remains in the Design resource contract. Neither design-source adapter
performs provider generation or source installation.

## Context7 and Codebase Memory verification model

These are two separate environments:

1. The development smoke commands exercise each typed adapter boundary with
   an explicit live opt-in and bounded local fixtures.
2. The Factory runtime constructs its server-only adapters from its own
   configuration and exposes `ProductionAdapterIdentity` status. Browser state,
   generated projects, and skill text cannot enable either adapter.

Context7 is disabled unless `CONTEXT7_ENABLED=true`; when enabled, the
server-only transport uses the official hosted MCP endpoint
(`CONTEXT7_ENDPOINT`, default `https://mcp.context7.com/mcp`) and optional
server-only `CONTEXT7_API_KEY`. Codebase Memory is disabled unless
`CODEBASE_MEMORY_ENABLED=true` and a usable `CODEBASE_MEMORY_EXECUTABLE` is
present; its child process receives only the bounded runtime environment,
including optional local `CBM_CACHE_DIR` and `CBM_ALLOWED_ROOT`. No client-side
environment variable can enable either adapter.

Recorded local verification on 2026-09-20:

- Context7 hosted MCP: bounded `initialize` and `tools/list` requests returned
  HTTP 200/SSE, server version `4.1.1`, and the live read-only tools
  `resolve-library-id` and `query-docs`. A generic query for the repository
  library `next@16.2.12` resolved `/vercel/next.js` and returned relevant App
  Router Metadata API excerpts. The live catalog exposed `v16.2.9` as the
  closest indexed Next.js version, so the evidence records the requested
  version separately from the documented version.
- `npm run context7:smoke` with explicit opt-in: **passed** through the live
  Context7 MCP HTTP transport and the Factory planner helper
  `requestPlannerDocumentation`; no OpenAI/model call was made.
- DeusData Codebase Memory `v0.11.0`: the official Windows archive was
  checksum-verified, activated in a user-local directory with agent config
  skipped, and started successfully. Real MCP stdio `initialize` returned
  protocol `2025-06-18`; `tools/list` returned the upstream tool catalog.
- Official CLI verification indexed the repository root in fast mode into an
  isolated derived cache: project `ai-website-factory-live-verification`, root
  `D:/Visual Studio Code/save/ai-website-factory`, status `ready`, `7,252`
  nodes and `29,766` edges. CLI and MCP `search_graph` both returned
  `TaskContextAssembler` in `src/agents/implementation/policy.ts` at lines
  `73-683`. The existing Factory process adapter also passed its real-binary
  synthetic fixture smoke with one normalized symbol result.
- `npm run codebase-memory:smoke` with explicit executable/cache opt-in:
  **passed** at the Factory `CodebaseMemoryService` boundary. The index and
  query remain derived, read-only projection state; no canonical or customer
  state was written.

## Agent alternative assessment

The current custom agents remain the correct execution boundary. Agency Agents
and Awesome Claude Code Subagents are useful prompt/persona references, but a
ready-made markdown agent cannot own the Factory's typed contracts, selected
Design and canonical requirements, dependency authority, task graph, approval,
currentness, or controlled-edit executor. Wholesale replacement would create a
second authority model. This milestone adopts only bounded frontend guidance
and keeps the existing Design and Frontend agents, tool allowlists, and host
validators intact.

## Acceptance evidence

- `src/agents/catalog.ts` assigns the new capabilities to the existing Design,
  FrontendImplementation, and Animation Review agents.
- `src/runtime/production-factory-runtime-core.ts` computes host-owned
  daisyUI/Magic UI/motion selection guards before skill resolution.
- `src/dependencies/authority.ts` and `src/agents/implementation/foundation-policy.ts`
  keep daisyUI optional, exact, npm-only, and plan-bound.
- `src/agents/implementation/policy.ts` can request Context7 guidance for
  daisyUI when the task and plan authorize it.
- `src/integrations/context7/transport.ts` performs bounded live MCP
  `resolve-library-id`/`query-docs` calls, maps SSE/JSON results into the
  existing normalized excerpt contract, and is injected into both planner and
  frontend implementation runtime consumers. Frontend implementation queries
  use fixed package topics rather than customer task prose.
- `src/integrations/codebase-memory/transport.ts` forwards only the explicit
  Codebase Memory cache/root controls needed for local activation while
  retaining the existing read-only tool allowlist and bounded child
  environment.
- `npm run skills:activate-frontend` stages, approves, and promotes the five
  local artifacts with exact normalized checksums and zero tool permissions.
- ColorHunt and the existing read-only Magic UI design-source adapter remain
  available; no external provider call is part of this integration.
- The isolated Tailwind v4 compile produced `564,741` bytes from
  `daisyui@5.7.42` and emitted both `.btn` and `btn-primary`; no generated
  project or repository dependency manifest was changed.
