# OpenAI Provider Diagnostic — 2026-08-10

- Root cause: **AI_REQUEST_SCHEMA_INVALID** (baseline `.optional()` field rejected locally by `zodResponseFormat` before dispatch)
- Original failing stage: **request_construction**; controlled call stage: **api_response**
- SDK: `7.4.0`; model: `gpt-5.6-luna`
- Reviewer scope: `architecture-reviewer/architecture-module-boundaries`; request attempted: yes; API response received: yes
- HTTP status: not available; request ID retained: yes
- OpenAI error type/code/param: not available / not available / not available
- Choices: 1; finish reason: stop; refusal: no; parsed: yes; content present: yes
- Schema `architecture-review-result`: generated schema PASS; transport validation PASS; domain validation PASS; normalization PASS
- Evidence snapshot: `96d9ebc25c09fe1fb83338e8c7a1fa989fc3d9f4` / `427863061b650425431f5538b130e513e049a931eb44c29ed12c0dad36a38c08`; manifest reused: yes
- Fix applied: Required nullable transport fields for strict Structured Outputs; added allowlisted provider diagnostics.

No API key, authorization header, prompt, evidence pack, completion content, or private reasoning was persisted.

| Stage | Result | Evidence |
|---|---|---|
| Env loading | PASS | Existing CLI loader selected local .env without logging values. |
| Provider construction | PASS | gpt-5.6-luna configuration instantiated. |
| API request | ATTEMPTED | Safe request metadata only. |
| API response | RECEIVED | No safe HTTP status. |
| Refusal handling | NO_REFUSAL | Boolean metadata only. |
| Structured parse | PARSED | Schema architecture-review-result. |
| Domain validation | PASS | Zod issue paths only. |
| Provider normalization | PASS | Existing reviewer adapter path. |

The controlled reviewer scope returned a structured result.
