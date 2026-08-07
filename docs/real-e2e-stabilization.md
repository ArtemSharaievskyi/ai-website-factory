# Real E2E stabilization

Stabilize failures in this order: reproduce with the bounded report, classify the first failing stage, make the smallest Factory fix, add a network-free regression test, rerun deterministic validation, then rerun the explicitly opted-in smoke. Do not hide failures by enabling synthetic providers, skipping mandatory stages, widening timeouts without evidence, or deleting the disposable project before its evidence is recorded.

