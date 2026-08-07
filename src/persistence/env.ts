import { z } from "zod";

export type PersistenceConfigurationErrorCode =
  | "PERSISTENCE_DATABASE_URL_MISSING"
  | "PERSISTENCE_DATABASE_URL_INVALID"
  | "PERSISTENCE_CONFIGURATION_INVALID";

export class PersistenceConfigurationError extends Error {
  readonly code: PersistenceConfigurationErrorCode;

  constructor(code: PersistenceConfigurationErrorCode, message: string) {
    super(message);
    this.name = "PersistenceConfigurationError";
    this.code = code;
  }
}

const PostgreSqlUrl = z.string().min(1).refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") && Boolean(url.hostname) && Boolean(url.pathname && url.pathname !== "/") && !/replace-me|example\.com/i.test(value);
  } catch {
    return false;
  }
}, "DATABASE_URL must be a PostgreSQL connection URL.");

const ServerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: PostgreSqlUrl.optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
}).strict();

export type ServerEnvironment = z.infer<typeof ServerEnvironmentSchema>;

export function requireDatabaseSsl(connectionString: string) {
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("uselibpqcompat");
  return url.toString();
}

export function readServerEnvironment(input: Record<string, string | undefined> = process.env): ServerEnvironment {
  const parsed = ServerEnvironmentSchema.safeParse({
    NODE_ENV: input.NODE_ENV,
    DATABASE_URL: input.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: input.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!parsed.success) {
    if (input.DATABASE_URL) throw new PersistenceConfigurationError("PERSISTENCE_DATABASE_URL_INVALID", "The persistence database URL is invalid.");
    throw new PersistenceConfigurationError("PERSISTENCE_CONFIGURATION_INVALID", "The persistence environment is invalid.");
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.DATABASE_URL) throw new PersistenceConfigurationError("PERSISTENCE_DATABASE_URL_MISSING", "A database URL is required for production persistence.");
  return parsed.data;
}
