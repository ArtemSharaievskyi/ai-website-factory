# First Trial Website — operator entry

The first-trial entry point is ready. This guide prepares the door; it does not submit or generate the real trial website.

## 1. Start the local Factory entry

From `D:\Visual Studio Code\save\ai-website-factory`, use the configured server environment and OpenAI provider, then submit a request with:

```powershell
npm run factory:new -- --prompt-file ".\trial-site-prompt.txt"
```

The command creates the host-owned project identity, stores the original request through the existing Lead/Project Memory authorities, invokes Lead first, and prints either clarification questions or the brief-approval stage.

## 2. Supply the large English trial request

Save the approved English request locally as `trial-site-prompt.txt`. Its contents are the natural-language request only. Do not pass a long request as `--prompt "..." `, and do not commit the file.

For this preparation run, use this placeholder only:

```text
<PROJECT_REQUEST>
```

The instruction language may be English while the requested customer-facing website language is German. Put that German locale requirement in the request; internal IDs and contracts remain English and host-owned.

The entry layer also supports:

```powershell
Get-Content .\trial-site-prompt.txt -Raw | npm run factory:new -- --stdin
```

Interactive mode is available with `npm run factory:new`; paste the request, finish with a line containing `END`, and confirm with `y`.

## 3. Read Lead clarification

The command prints the project slug, host-owned project ID, current stage, and Lead questions. It does not print the full raw request. At this point the project is normally `CLARIFYING`; no Planner, Design Agent, Orchestrator, Implementation Agent, source generation, or QA execution has started.

## 4. Answer Lead and resume the same project

Use an answers file for long answers:

```json
{
  "<QUESTION_ID>": "<ANSWER>"
}
```

Then run:

```powershell
npm run factory:respond -- --project <PROJECT_ID> --answers-file ".\trial-site-answers.json"
```

Without `--answers-file`, the command asks the unresolved questions interactively. The project ID is trusted host state; the prior conversation does not need to be pasted again. Answers are persisted to the existing clarification log, and the same project/version resumes. When all blocking clarification is complete, Lead creates the candidate Project Brief and leaves approval explicit.

## 5. Inspect state

```powershell
npm run factory:status -- --project <PROJECT_ID>
npm run factory:status -- --project <PROJECT_ID> --json
```

Status reports the current workflow state, revision/row version, pending user action, blocking reasons, and next allowed actions. It does not dump Project Memory, the raw request, or secrets.

## 6. Later canonical actions

This preparation adds only the minimum new-user entry, clarification continuation, and status commands. Existing typed workflow authorities remain responsible for later actions:

- Brief approval or revision: `LeadAgentService.approveBrief` / `requestBriefRevision`.
- Planning: `PlannerArchitectService.planApprovedProject`, then `acceptPlanningPackage`.
- Database decision, dependency approval, and planning approval: `Phase7CContractService.approveDatabase`, `approveDependencies`, and `approvePlanning`.
- Design directions and explicit selection: `DesignAgentService.generateDesignDirections`, then `selectDesignDirection`.
- Explicit implementation start: `OrchestratorService.startImplementation`; task execution remains separately gated.

Silence is never approval. Currentness, checksums, row versions, and workflow transitions remain enforced by the existing domain and persistence authorities.

## 7. Required stopping point for this preparation

For the first real trial, save the approved English request to `trial-site-prompt.txt`, run `factory:new`, and stop after Lead returns clarification/questions or a brief proposal. Do not continue into Planner, Design, Implementation, hardening, QA, or deployment during the preparation run.
