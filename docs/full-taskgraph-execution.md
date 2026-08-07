# Controlled Full TaskGraph Execution

The full executor is a deterministic scheduler, not an agent. It loads one accepted mutable project version, validates graph and document checksums, dispatches only READY tasks, and routes work through narrow adapters for the existing Implementation Agent, runtime validator, functional QA, and static validators.

It stops at the pre-release boundary. `releaseEligible` means mandatory technical gates passed; it does not create Git/GitHub repositories, tags, deployments, Preview environments, or customer migrations.

The explicit real-chain smoke is governed by [`real-factory-e2e-smoke.md`](real-factory-e2e-smoke.md) and requires real provider, npm, and Chromium prerequisites.
