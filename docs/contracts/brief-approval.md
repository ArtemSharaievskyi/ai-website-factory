# Brief approval boundary

The provider may analyze, plan questions, and assemble a draft. It may not approve, mark requirements approved, or transition the workflow. Those actions are performed by `LeadAgentService.approveBrief` after validating the draft checksum, readiness, workflow state, and expected project row version.

Approval persists the approved requirements document, mirrors it to Project Memory, appends a `brief-approval` DecisionRecord, and transitions to `AWAITING_DESIGN_SELECTION`. The Design Agent is out of scope for this milestone; no design directions or implementation tasks are created here.
