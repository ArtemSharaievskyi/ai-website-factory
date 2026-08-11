import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function readMigrationManifest(directory = path.resolve("supabase/migrations")) {
  const files = (await readdir(directory)).filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file)).sort();
  const entries = await Promise.all(files.map(async (filename) => ({ filename, checksum: createHash("sha256").update(await readFile(path.join(directory, filename))).digest("hex") })));
  const migrationSetChecksum = createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
  return { entries, migrationSetChecksum };
}

export function migrationHistoryMatches(manifest, history) {
  return manifest.entries.length === history.length && manifest.entries.every((entry, index) => entry.filename === history[index]?.filename && entry.checksum === history[index]?.checksum);
}
