# Production task input builders

Implementation inputs are assembled from the current TaskGraph, approved requirements, accepted planning package, selected design, architecture/content/assets, current checksums, task scopes, approved tool policy, workspace reservation, and cancellation signal. Runtime inputs use the generated workspace and the allowlisted validator operations. Functional QA uses `deriveFunctionalQaPlan` from the approved Brief and accepted planning package, then invokes the existing readiness checks inside `FunctionalQaService`.

No builder copies raw Project Memory, provider responses, logs, source output, browser artifacts, or secrets into executor outcomes.

