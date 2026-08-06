# Workspace Manager

`WorkspaceManager` owns only controlled project/version filesystem operations. It never exposes arbitrary filesystem paths. The configured root is `GENERATED_PROJECTS_ROOT`; tests inject temporary roots and cannot use the configured production root in test mode.

The layout is:

```text
D:\Visual Studio Code\save\<project-slug>\
  project.json
  .staging\
  v1\.factory\
  v2\.factory\
```

Version numbers come from `WorkspaceVersionPort`, backed by the existing Supabase project-version repository. A version is reserved transactionally before staging. Staging remains under the project root, then is promoted with same-filesystem rename. The root metadata is updated atomically; failed metadata updates remove the newly promoted final version and preserve the prior metadata.

Initial versions initialize only the available Project Memory documents: `project.json`, `original-prompt.md`, `manifest.json`, plus explicitly supplied validated documents. No fake customer source files, Next.js app, npm install, or generated website is created.

Revisions require an immutable source version. They copy source files into a new staging version, exclude transient/build/secret files, rebuild `.factory` metadata for the new version, and append a revision decision. Released versions are never modified by Factory operations.
