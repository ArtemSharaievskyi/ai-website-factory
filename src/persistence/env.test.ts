import { describe, expect, it, vi } from "vitest";
import { createPostgresPool } from "./postgres";
import { PersistenceConfigurationError, readServerEnvironment } from "./env";

const validDatabaseUrl = "postgresql://factory_user:fixture-secret@db.fixture.test:5432/postgres";

describe("production persistence environment", () => {
  it("parses only persistence-owned variables", () => {
    expect(readServerEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: validDatabaseUrl,
      OPENAI_API_KEY: "unrelated-openai-value",
      CONTEXT7_API_KEY: "unrelated-context7-value",
      SHADCN_REGISTRY_ENABLED: "false",
      Path: "C:\\Windows\\System32",
    })).toMatchObject({ NODE_ENV: "production", DATABASE_URL: validDatabaseUrl });
  });

  it("requires DATABASE_URL only for production", () => {
    expect(() => readServerEnvironment({ NODE_ENV: "production" })).toThrowError(PersistenceConfigurationError);
    try { readServerEnvironment({ NODE_ENV: "production" }); } catch (error) { expect(error).toMatchObject({ code: "PERSISTENCE_DATABASE_URL_MISSING" }); }
    expect(readServerEnvironment({ NODE_ENV: "test" }).DATABASE_URL).toBeUndefined();
  });

  it.each([
    "https://db.fixture.test/postgres",
    "postgresql://db.fixture.test",
    "postgresql://db.fixture.test:bad/postgres",
    "postgresql://factory_user:replace-me@db.example.com:5432/postgres",
  ])("rejects an invalid database URL safely: %s", (databaseUrl) => {
    expect(() => readServerEnvironment({ NODE_ENV: "production", DATABASE_URL: databaseUrl })).toThrowError("database URL is invalid");
    try { readServerEnvironment({ NODE_ENV: "production", DATABASE_URL: databaseUrl }); } catch (error) {
      expect(error).toMatchObject({ code: "PERSISTENCE_DATABASE_URL_INVALID" });
      expect((error as Error).message).not.toContain(databaseUrl);
    }
  });

  it("does not require or parse DIRECT_URL for application persistence", () => {
    expect(readServerEnvironment({ NODE_ENV: "production", DATABASE_URL: validDatabaseUrl, DIRECT_URL: "not-a-database-url" })).toMatchObject({ DATABASE_URL: validDatabaseUrl });
  });

  it("constructs the production Postgres client without contacting the database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", validDatabaseUrl);
    const pool = createPostgresPool();
    expect(pool.options.connectionString).toContain("postgresql://");
    await pool.end();
    vi.unstubAllEnvs();
  });
});
