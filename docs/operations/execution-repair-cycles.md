# Execution Repair Cycles

Repairable failures create one targeted `repair-targeted-failure` task with the originating task, safe failure code, diagnostic summary, requirements, planning references, affected scopes, and cycle number. Only affected validation is rerun. Per-task and total repair limits stop infinite loops.
# Structural repair context

Targeted repair may query current callers, callees, imports, references, and impact before proposing a repair. Findings outside the authorized scope produce `CODEBASE_MEMORY_SCOPE_EXPANSION_REQUIRED`; the repairer does not silently edit those files.
