# Workspace reconciliation

`WorkspaceManager.reconcile(projectId, slug)` compares persisted version records, final `vN` directories, staging entries, and root `project.json` metadata. It reports safe issue codes including:

- `DATABASE_VERSION_DIRECTORY_MISSING`
- `DIRECTORY_DATABASE_VERSION_MISSING`
- `WORKSPACE_STAGING_INTERRUPTED`
- `PROJECT_METADATA_STALE`
- `WORKSPACE_PROJECT_NOT_FOUND`

Every report includes a safe description, a recommended controlled action, and whether automatic repair is allowed. Current ambiguous-state repairs are never automatic. Checksum mismatches are handled through the Project Memory sync boundary and do not overwrite either side silently.

The Workspace Manager does not create generated source, run npm, build customer projects, initialize Git, publish GitHub repositories, run Preview, or deploy.
