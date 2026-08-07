# Real E2E failure classification

Preflight failures use `REAL_E2E_*` codes. Provider failures remain provider-safe summaries; generated-file failures are Factory defects until reproduced by a deterministic regression test; npm failures identify the bounded command; and browser failures identify the QA category without page payloads, cookies, or screenshots.

`releaseEligible` is true only when every mandatory stage passes, the TaskGraph has no failed task, checksums are verified, npm validation passes, Playwright reports no unexpected external request, and no prohibited action occurred.

