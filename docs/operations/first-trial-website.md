# First Trial Website - operator entry

The Factory Web Workbench is the primary local entry point. It keeps the full project request, Lead clarification, typed approvals, and workflow state on the server side. The browser never calls the model provider directly and never displays generated source or a website preview.

This guide describes the normal trial procedure. It does not submit the real Haus & Garten request and does not generate customer-facing source during preparation.

## 1. Start the Factory Web Workbench

From `D:\Visual Studio Code\save\ai-website-factory`, start the configured local server:

```powershell
npm run dev
```

Open the local URL printed by Next.js, normally `http://localhost:3000`.

The CLI remains available as a fallback:

```powershell
npm run factory:new -- --prompt-file ".\trial-site-prompt.txt"
```

## 2. Submit the full English project request

In the Workbench composer, paste the complete English project request and choose **Create project**. Use the real approved request only during the authorized trial. Do not commit the request text, and do not submit it through a URL or shell argument.

The request may ask for a German customer-facing website. Keep the instruction language and the requested customer-facing locale explicit; internal IDs and contracts remain English and host-owned.

The CLI also accepts a local file or stdin for long requests:

```powershell
npm run factory:new -- --prompt-file ".\trial-site-prompt.txt"
Get-Content .\trial-site-prompt.txt -Raw | npm run factory:new -- --stdin
```

## 3. Answer Lead clarification in the same project

After submission, the Workbench shows the project identity, current stage, conversation, and Lead questions. Answer the required fields in the clarification card and choose **Send answers to Lead**. The same project is resumed; a second project is not created.

At this point the project is normally `CLARIFYING`. Planner, Design, Orchestrator, Implementation, source generation, and QA do not start merely because the request was submitted.

## 4. Review and approve the Project Brief

When Lead has enough information, the Workbench shows the bounded Project Brief. Review the goals, audience, pages, features, forms, and image strategy.

- Choose **Approve Brief** when the requirements are correct.
- Choose **Request changes**, describe the correction in the composer, and submit it when the Brief needs revision.

Approval remains an explicit typed workflow action. Silence is never approval.

## 5. Approve Planning and governed decisions

After Brief approval, choose **Prepare planning**. The canonical Planner and Architecture Reviewer then produce the current planning package. Review and explicitly approve it, request planning changes when needed, approve the database recommendation, and approve the optional dependency set when shown.

The Workbench does not bypass currentness, checksums, row versions, reviewer verdicts, or the existing Phase 7C contract authority.

## 6. Choose one of exactly three Design Directions

When the current design set is available, the Workbench shows exactly three Design Direction cards. No direction is preselected. Review the typography, layout, imagery, component character, motion policy, and trade-offs, then choose **Use this direction** on exactly one card.

## 7. Start implementation explicitly

Only after the current Brief, Planning, database and dependency decisions, selected Design Direction, Contract Audit approval, and task graph gates are current does the Workbench show **Start implementation**. Choose it deliberately. The existing Orchestrator remains the implementation authority; the Workbench does not execute source generation itself.

## 8. CLI fallback and status inspection

The CLI can resume the same canonical workflow when the web UI is unavailable:

```powershell
npm run factory:respond -- --project <PROJECT_ID> --answers-file ".\trial-site-answers.json"
npm run factory:status -- --project <PROJECT_ID>
npm run factory:status -- --project <PROJECT_ID> --json
```

The status output reports the workflow state, revision/row version, pending user action, blocking reasons, and next allowed actions. It does not dump the raw request, Project Memory, or secrets.

## 9. Preparation stopping point

For a preparation run, use synthetic local test data only and stop after Lead returns clarification/questions or a Brief proposal. Do not continue into Planner, Design, Implementation, hardening, QA, or deployment until the real trial is authorized.
