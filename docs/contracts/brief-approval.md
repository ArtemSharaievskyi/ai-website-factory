# Brief approval boundary

The provider and Lead agent may analyze, plan questions, and assemble a draft.
Neither may approve, mark a Brief approved, or transition the approval workflow.
For a current `brief-v3` document, those actions are performed by the
host-owned `BriefApprovalService` after consuming `evaluateBriefReadiness`,
validating exact currentness/CAS, and receiving explicit user approval.

Approval persists only host-owned lifecycle metadata around the unchanged
CanonicalBriefV3, mirrors the current V3 document to derived Project Memory,
appends a separate `brief-approval` DecisionRecord, and transitions once to
`AWAITING_DESIGN_SELECTION`. It does not create a V3 ChangeSet, effective
delta, or revision-history entry; it does not write a legacy requirements
approval or assert publication readiness. The Design Agent is out of scope for
this milestone; no design directions or implementation tasks are created here.

Approval readiness and public publication readiness are separate host-owned
decisions. A current Brief may be approved and used for Planning while safe
explicit publication placeholders remain. Publication/deployment stays
fail-closed until required address and contact-review inputs are resolved;
conditional legal fields may be explicitly marked not applicable. Planning,
Implementation, Preview, and Deployment must preserve placeholders and may not
invent legal, tax, register, authority, phone, or WhatsApp facts.
