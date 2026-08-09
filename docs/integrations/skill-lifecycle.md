# Skill lifecycle

1. A user or trusted administrator supplies an existing local directory.
2. The import service copies it into a unique staging directory after safe scanning.
3. `SKILL.md` is parsed conservatively and the source/file manifest is hashed.
4. Deterministic static review classifies findings and risk.
5. A human creates an approval record bound to the exact source checksum and manifest checksum.
6. Only explicitly approved files are copied to `skills/approved/<slug>/<version>-<checksum>/`.
7. The registry record is updated atomically and the copy is never overwritten through Factory APIs.
8. Loading verifies every approved file, permissions, and context limits.
9. Revocation prevents future loads while preserving the approved copy, registry record, and audit history.

Changed content requires a new import, review, approval, and approved directory. Approval never applies automatically to future versions.
