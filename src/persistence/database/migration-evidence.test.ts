import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrationHistoryMatches, readMigrationManifest } from "../../../scripts/migration-evidence.mjs";

describe("Factory migration evidence identity", () => {
  it("binds execution history to the ordered migration content set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "factory-migration-evidence-"));
    try {
      await writeFile(path.join(root, "202601020002_second.sql"), "select 2;\n");
      await writeFile(path.join(root, "202601020001_first.sql"), "select 1;\n");
      const first = await readMigrationManifest(root);
      expect(first.entries.map((entry) => entry.filename)).toEqual(["202601020001_first.sql", "202601020002_second.sql"]);
      expect(migrationHistoryMatches(first, first.entries)).toBe(true);

      await writeFile(path.join(root, "202601020001_first.sql"), "select 99;\n");
      const changed = await readMigrationManifest(root);
      expect(changed.migrationSetChecksum).not.toBe(first.migrationSetChecksum);
      expect(migrationHistoryMatches(changed, first.entries)).toBe(false);

      await writeFile(path.join(root, "202601020003_third.sql"), "select 3;\n");
      const extended = await readMigrationManifest(root);
      expect(extended.migrationSetChecksum).not.toBe(changed.migrationSetChecksum);
      expect(migrationHistoryMatches(extended, changed.entries)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
