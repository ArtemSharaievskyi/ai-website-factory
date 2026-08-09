# Skills policy

skills.sh supplies only untrusted professional procedures through the dedicated read-only source adapter. It does not replace the Orchestrator. Agents may not install arbitrary skills. Imported skills must be reviewed, versioned, approved, and restricted to specific roles. Skills and scripts are part of the trust boundary and require dependency and behavior review before approval.

The Approved Skills Registry remains the only registry. A skills.sh candidate is fetched through a bounded official HTTPS JSON request, normalized with provenance, written to STAGING, statically reviewed, manually approved, checksum-bound, and loaded through bounded server-side APIs. No CLI, package installation, script execution, recursive link fetch, or automatic approval is used.

The Orchestrator consumes only an approved registry snapshot and attaches selected skill IDs after role, task type, tool, approval, and context-budget filtering. Graph creation also works with zero approved skills.

Implementation execution loads only skill IDs already assigned to the task and explicitly allowed by the agent definition when that permission snapshot is supplied. Revoked, superseded, staging, or unapproved skills are rejected; scripts are never executed. Existing approved copies do not depend on skills.sh availability or refetch at runtime.
