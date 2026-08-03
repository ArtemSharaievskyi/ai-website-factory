# Project versioning

Generated projects will be standalone directories:

```text
D:\Visual Studio Code\save\<project-slug>\v1
D:\Visual Studio Code\save\<project-slug>\v2
D:\Visual Studio Code\save\<project-slug>\v3
```

Old versions are immutable. A revision creates a new complete version with no silent overwrite. Each generated project remains independently runnable and contains its source code; the Factory database stores workflow metadata, not the only copy. Each version will later contain `.factory` project memory.

The future Workspace Manager must prevent traversal, support Windows path behavior, and write through staging plus atomic promotion. It is not implemented here.
