import { z } from "zod";

const ServerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
}).strict();

export type ServerEnvironment = z.infer<typeof ServerEnvironmentSchema>;

export function readServerEnvironment(input: Record<string, string | undefined> = process.env): ServerEnvironment {
  const parsed = ServerEnvironmentSchema.safeParse(input);
  if (!parsed.success) throw new Error("Server persistence environment is invalid.");
  if (parsed.data.NODE_ENV === "production" && !parsed.data.DATABASE_URL) throw new Error("DATABASE_URL is required for production persistence.");
  return parsed.data;
}
