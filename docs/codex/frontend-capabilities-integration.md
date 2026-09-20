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
| [Context7 MCP](https://github.com/upstash/context7) | upstream `@upstash/context7-mcp` 4.1.1 evidence | MIT | existing typed Context7 adapter | Frontend implementation policy and tool registry |
| [Codebase Memory](https://github.com/PrimeIntellect-ai/codebase-memory) | local executable; no Factory-pinned binary commit | MIT | existing typed process adapter | Frontend source reconnaissance |

The upstream resources are provenance, not canonical authority. The Factory
loads only the approved local copies under `skills/approved/`; those copies are
reproducible with `npm run skills:activate-frontend` from the tracked
`skills/internal/**` sources. `skills/registry/*.json` and `skills/approved/**`
are local runtime state by repository policy and are intentionally ignored.

## Runtime wiring

| Factory boundary | Integration | Selection guard |
|---|---|---|
| Design Agent | UI UX Pro Max and Taste guidance; existing Impeccable, Emil, ColorHunt, Google Fonts, Magic UI, 21st.dev, React Bits, and shadcn paths remain available | Design runtime supplies `design`, `typography`, `palette`, `ux`, and `frontend` surfaces; form guidance is still conditional |
| FrontendImplementationAgent | daisyUI, Magic UI adaptation, Design Motion Principles, Context7, shadcn, Codebase Memory, existing Emil/Impeccable/DialKit/anti-slop/checklist skills | daisyUI requires planned `daisyui`; Magic UI requires selected Design evidence; motion requires the existing motion signal |
| Animation Review | Design Motion Principles complements the existing Emil review/opportunity skills | Review task type and `review.animation` capability |
| Generated project foundation | Dependency Authority permits `daisyui@5.7.42` only as a planned `devDependency`; the deterministic foundation provider carries approved optional dependencies into `package.json` | Phase 7C dependency approval and exact version/section checks |
| CSS implementation | normalized guidance targets Tailwind v4 `@import "tailwindcss";` plus opt-in `@plugin "daisyui";` in the generated global stylesheet | Only when the selected plan includes daisyUI; no default theme or all-theme activation |

Magic UI remains a read-only source adapter. The existing adapter filters free
public registry UI candidates, marks them adaptation-required, and preserves
source checksums; it does not write source or install a remote component.
ColorHunt remains unchanged as an inspiration-only, read-only palette source
and remains in the Design resource contract.

## Context7 and Codebase Memory verification model

These are two separate environments:

1. The development smoke commands exercise each typed adapter boundary with
   synthetic or explicit local fixtures and require explicit real-smoke opt-in.
2. The Factory runtime constructs its server-only adapters from its own
   configuration and exposes `ProductionAdapterIdentity` status. Browser state,
   generated projects, and skill text cannot enable either adapter.

Context7 is disabled unless `CONTEXT7_ENABLED=true`; the current smoke command
uses a bounded synthetic transport unless real smoke is explicitly opted in.
Codebase Memory is disabled unless `CODEBASE_MEMORY_ENABLED=true` and a usable
`CODEBASE_MEMORY_EXECUTABLE` is present; its smoke command creates only a
synthetic temporary workspace. No API key or client-side environment variable
is accepted by either adapter.

Recorded local verification on 2026-09-20:

- `npm run context7:smoke`: **passed** at the typed synthetic transport boundary
  for Next.js 16.2.12; this is not release evidence for a live Context7 service.
- `npm run codebase-memory:smoke`: **NOT_CONFIGURED** because the explicit real
  smoke opt-in and executable were absent; no process was started.
- The local environment contained none of `CONTEXT7_ENABLED`,
  `ALLOW_REAL_CONTEXT7_SMOKE`, `CODEBASE_MEMORY_ENABLED`,
  `ALLOW_REAL_CODEBASE_MEMORY_SMOKE`, or `CODEBASE_MEMORY_EXECUTABLE`.
- Factory runtime identity tests report both optional adapters as
  `not-needed` under that environment. The production composition still owns
  their server-only construction and separate status reporting.

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
- `npm run skills:activate-frontend` stages, approves, and promotes the five
  local artifacts with exact normalized checksums and zero tool permissions.
- ColorHunt and the existing read-only Magic UI design-source adapter remain
  available; no external provider call is part of this integration.
