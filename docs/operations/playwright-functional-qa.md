# Playwright Functional QA

Playwright is restricted to functional behavior in a mutable generated staging workspace. QA starts only after the allowlisted runtime validation sequence passes, then derives sequential scenarios from approved requirements and planning documents. It checks routes, navigation, forms, approved auth/authorization behavior, and runtime/browser errors.

There is no screenshot review, visual regression, pixel comparison, accessibility stage, deployment, production browsing, customer Git automation, or full TaskGraph execution.

Full execution may invoke this QA service only after the build/runtime prerequisites and QA readiness checks pass.
# Production composition

In `REAL_E2E`, `FunctionalQaService` is composed with `NodeLocalTestServer` and `PlaywrightBrowserRunner`. No screenshot or visual-QA path is enabled.

The production TaskGraph adapter derives the QA plan from approved sitemap/forms/user-flow documents and delegates readiness and browser execution to `FunctionalQaService`.
