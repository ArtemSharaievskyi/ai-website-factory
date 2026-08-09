# Change proposals

Providers return strict structured proposals containing UTF-8 `create-file`, `replace-file`, `patch-text`, or `delete-file` operations. Each operation carries a relative path, prior/result checksums where applicable, reason, and requirement/planning/design references. Providers cannot write files, execute commands, grant tools, change requirements, transition tasks, or persist results.
