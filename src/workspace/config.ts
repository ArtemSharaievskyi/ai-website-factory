import { z } from "zod";
import { normalizeWorkspaceRoot, WorkspaceRootSchema } from "./schemas";

const WorkspaceEnvironmentSchema = z.object({ NODE_ENV: z.enum(["development", "test", "production"]).default("development"), GENERATED_PROJECTS_ROOT: WorkspaceRootSchema.optional() }).strict();
export type WorkspaceEnvironment = z.infer<typeof WorkspaceEnvironmentSchema>;
export function readWorkspaceEnvironment(input: Record<string, string | undefined> = process.env) { const parsed = WorkspaceEnvironmentSchema.safeParse(input); if (!parsed.success) throw new Error("WORKSPACE_ROOT_INVALID"); if (parsed.data.NODE_ENV === "production" && !parsed.data.GENERATED_PROJECTS_ROOT) throw new Error("WORKSPACE_ROOT_INVALID"); return { ...parsed.data, ...(parsed.data.GENERATED_PROJECTS_ROOT ? { GENERATED_PROJECTS_ROOT: normalizeWorkspaceRoot(parsed.data.GENERATED_PROJECTS_ROOT) } : {}) }; }
