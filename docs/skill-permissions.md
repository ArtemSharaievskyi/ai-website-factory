# Skill permissions

Loading requires all of: approved status, intact source checksum and file manifest, non-revoked approval, unexpired approval, permitted role, permitted task type, and permitted requested tools. The loader returns stable denial codes and records the denial in the append-only audit log.

Supported roles are lead, planner-architect, design, implementation, and qa-release. Supported task types cover requirements, design, architecture, planning, implementation, validation, testing, and release preparation. Approval records carry the final role/task/tool allowlists; imported text cannot change them.

Scripts are never executed by import or load. The loader returns approved script metadata only, including checksum, declared interpreter placeholder, risk, and the requirement for separate explicit execution approval.
