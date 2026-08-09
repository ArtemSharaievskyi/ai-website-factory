# Test / Quality Reviewer

The Test / Quality Reviewer is the final semantic quality gate. It asks whether the available verification evidence meaningfully validates approved behavior; deterministic runtime reports remain authoritative for whether lint, TypeScript, Vitest, build, and Functional QA commands passed.

It receives a bounded `QualityEvidenceSummary`, requirement-to-validation trace edges, relevant test slices, implementation contract references, and current upstream review checksums. It never receives raw full logs, the entire repository, secrets, `.env` values, or provider conversations.

Deterministic prerequisites require current source and test checksums, passing lint, typecheck, required unit tests, build, Functional QA, Code / Integration Review, and Security Review evidence. Only then may semantic review consider whether important flows, forms, authentication, persistence, success/error paths, and meaningful assertions are present. Low-complexity projects are not forced into duplicate unit and browser coverage; expectations scale with approved risk.

The reviewer is read-only. It cannot write tests, run Vitest or Playwright, edit source or TaskGraph, create ChangeProposal, or invoke Implementation. Findings identify concrete evidence and bounded correction targets (`TEST_TASK`, `FUNCTIONAL_QA_TASK`, `IMPLEMENTATION_TASK`, or `UPSTREAM_TEST_CONTRACT`). Existing implementation execution owns corrections, targeted deterministic validation provides fast feedback, and final full gates remain mandatory. Test / Quality corrections are capped at two cycles.

Reviews persist immutable records and history bound to all upstream artifact checksums, application source, test source, quality evidence, agent version, prompt version, and policy version. Any changed source or quality evidence makes a prior approval stale; test-only changes do not invalidate unrelated application reviews when their checksums remain unchanged. Idempotency uses canonical inputs and versions.

The reviewer uses only `openai-generation`, has no approved skills, and does not expand the factory quality stack beyond ESLint, TypeScript, Vitest, Next build, and Playwright. QA temporary workspaces use the existing `.qa-foundation-*` gitignore boundary; this phase does not add broad cleanup behavior or delete generated project output.
