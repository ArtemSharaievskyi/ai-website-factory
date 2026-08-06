# Project Memory

The `ProjectMemoryStore` in `src/project-memory/` supports the future `.factory/` document set:

```text
project.json
original-prompt.md
clarification-log.json
requirements.json
design-directions.json
selected-design.json
architecture.json
content-plan.json
asset-manifest.json
task-graph.json
decisions.jsonl
quality-report.json
release-report.json
manifest.json
```

Structured JSON is parsed by its strict Zod schema. The original prompt is stored as human-readable UTF-8 text with safe newline normalization. Decisions are validated one record per JSONL line. The manifest records relative path, document type, schema version, SHA-256 checksum, byte size, and update time for every canonical document except the manifest itself.

Writes validate first, serialize with recursively stable key ordering, write a same-directory temporary file, sync where supported, and rename atomically. Manifest updates are part of the replacement operation; if they fail, the previous document and manifest are restored. Invalid data is never written. Paths are canonical-name restricted, traversal and absolute paths are rejected, and existing symbolic-link targets are refused. Integrity verification compares manifest checksums without exposing file contents.

Before `PROJECT_READY`, documents are replaceable through the store. Once the project document is released, ordinary writes and decision appends fail with `PROJECT_VERSION_IMMUTABLE`. A new version is future Workspace Manager work; this store does not create version directories.
# Lead Agent memory writes

Lead intake and clarification writes are incremental and preserve `original-prompt.md`, `clarification-log.json`, and `requirements.json` under the active version's `.factory` directory. Planner acceptance additionally mirrors `planning-package.json`, `architecture.json`, `content-plan.json`, and `asset-manifest.json`, then appends a structured `decisions.jsonl` record. The manifest remains the integrity source for filesystem checksums.
