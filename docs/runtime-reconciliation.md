# Runtime Reconciliation

Before accepting a report, reconciliation verifies the staging workspace, package and lockfile checksums, active-process state, and required command-result completeness. An orphaned `RUNNING` report, changed inputs, or incomplete passed report is rejected and is not silently repaired.
