# First Trial Website — entry-point readiness

Status: **READY**

The repository had no usable normal user entry. The existing page is a foundation placeholder, the health route is not a project API, and the Lead server composition had no caller. The smallest safe implementation is now available as three local commands over the existing Lead, persistence, workflow, Project Memory, ContextAssembler, and OpenAI telemetry authorities.

## Frozen source snapshot

- Initial Phase 7G baseline: `85497297ad8dd69b18c581ab96f732d84f6308c8`
- Implementation commit: `7db318bde6a4948b62623bed581a2bb7605f83e9` (`feat: add canonical trial project entry point`)
- Admin result JSON: `first-trial-entry-point-readiness-2026-08-12.json`
- No real trial prompt was submitted.

## User commands

```powershell
npm run factory:new -- --prompt-file ".\trial-site-prompt.txt"
npm run factory:respond -- --project <PROJECT_ID> --answers-file ".\trial-site-answers.json"
npm run factory:status -- --project <PROJECT_ID>
```

Interactive input and redirected stdin are also supported. The request is validated as strict `InitialProjectRequest` input with a 128 KiB UTF-8 bound. The host owns request/project IDs. The request reaches Lead first; no direct Planner, Design, Implementation, Orchestrator, filesystem, or Codex path exists.

## Evidence

- T1–T30: **30/30 PASS** in `src/runtime/trial-entry/service.test.ts`.
- Full suite: **85 files, 1,133 tests PASS**.
- Reviewer suite: **7 files, 77 tests PASS**.
- Typecheck, build, audit, database validation/status/verify/integrity, Docker config, TaskGraph, backend smoke, generated-runtime smoke, and `git diff --check`: **PASS**.
- Lint: **PASS** with the two pre-existing implementation unused-variable warnings.
- Factory-owned stale QA workspaces: **0**; active: **0**. The unverified historical `.qa-foundation-TtJjjb` was preserved.

## Scope boundary

No customer project, customer source, Haus & Garten request, Planner run, Design Directions, implementation, hardening, final audit, Codex integration, migration, or deployment was performed. Later typed approvals remain explicit: `LeadAgentService.approveBrief`, Planner acceptance, `Phase7CContractService` database/dependency/planning approvals, `DesignAgentService.selectDesignDirection`, and `OrchestratorService.startImplementation`.

Next step: save the approved English request as `trial-site-prompt.txt`, run `factory:new`, and stop after Lead returns clarification/questions or a Brief proposal.
