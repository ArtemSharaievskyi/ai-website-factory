# Project versioning

Generated projects will be standalone directories:

```text
D:\Visual Studio Code\save\<project-slug>\v1
D:\Visual Studio Code\save\<project-slug>\v2
D:\Visual Studio Code\save\<project-slug>\v3
```

Old versions are immutable. A revision creates a new complete version with no silent overwrite. Each generated project remains independently runnable and contains its source code; the Factory database stores workflow metadata, not the only copy. Each version will later contain `.factory` project memory.

The Project Memory storage layer now validates canonical relative document names, rejects traversal and absolute paths, and uses same-directory atomic file writes. The Workspace Manager creates version directories, supports Windows-compatible paths, and promotes staged version directories atomically.

The Workspace Manager now owns those filesystem operations. It reserves versions through the persistence boundary, stages under the project root, promotes atomically, initializes `.factory`, supports immutable copy-forward revisions, and reports ambiguous database/filesystem states without silent repair. It still does not generate customer source code.
