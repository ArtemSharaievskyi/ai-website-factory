# File-operation security

Every operation is validated before application. Absolute paths, traversal, encoded path tricks, reserved Windows names, symlinks, `.git`, `.factory`, environment secrets, dependency/build output directories, archives, binary content, duplicate operations, and out-of-scope paths are rejected. npm policy permits only approved `package.json`/`package-lock.json` scopes and rejects pnpm, Yarn, and Bun lockfiles.

Changes are applied through a task-specific transaction directory under staging. Existing files are backed up, operations are applied, result checksums are verified, and any failure restores the prior files and removes partial outputs.
