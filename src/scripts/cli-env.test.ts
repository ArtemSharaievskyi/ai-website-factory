import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetEnv } from "@next/env";
import { afterEach, describe, expect, it } from "vitest";
import { loadFactoryCliEnv } from "../../scripts/cli-env";

const roots: string[] = [];

afterEach(async () => {
  resetEnv();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("standalone curation environment loading", () => {
  it("loads .env.local over .env without overwriting process.env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "factory-cli-env-"));
    roots.push(root);
    const processKey = "SKILLS_SH_TEST_PROCESS_PRIORITY";
    const fileKey = "SKILLS_SH_TEST_FILE_PRIORITY";
    const previousNodeEnv = process.env.NODE_ENV;
    const previousProcessValue = process.env[processKey];
    const previousFileValue = process.env[fileKey];
    const mutableEnv = process.env as Record<string, string | undefined>;
    mutableEnv.NODE_ENV = "development";
    process.env[processKey] = "process-value";
    delete process.env[fileKey];
    await writeFile(
      path.join(root, ".env"),
      processKey + "=base-value\n" + fileKey + "=base-value\n",
      { mode: 0o600 },
    );
    await writeFile(
      path.join(root, ".env.local"),
      processKey + "=local-value\n" + fileKey + "=local-value\n",
      { mode: 0o600 },
    );
    try {
      loadFactoryCliEnv(root);
      expect(process.env[processKey]).toBe("process-value");
      expect(process.env[fileKey]).toBe("local-value");
      expect(await readFile(path.join(root, ".env.local"), "utf8")).toContain(
        "local-value",
      );
      expect(await readFile(path.join(process.cwd(), ".gitignore"), "utf8")).toMatch(
        /(^|\r?\n)\.env\*/,
      );
    } finally {
      if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = previousNodeEnv;
      if (previousProcessValue === undefined) delete process.env[processKey];
      else process.env[processKey] = previousProcessValue;
      if (previousFileValue === undefined) delete process.env[fileKey];
      else process.env[fileKey] = previousFileValue;
    }
  });
});
