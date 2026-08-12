import { rm } from "node:fs/promises";
import path from "node:path";

// Next's server trace may materialize a symlinked dependency tree on Windows.
// The Factory runs from the project root's validated node_modules, so the
// generated trace directory is not needed by `next start` or the local QA
// launcher and is removed to keep QA workspace copies portable.
await rm(path.join(process.cwd(), ".next", "node_modules"), { recursive: true, force: true });
await rm(path.join(process.cwd(), ".next", "standalone", ".next", "node_modules"), { recursive: true, force: true });
