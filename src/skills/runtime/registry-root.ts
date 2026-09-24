import path from "node:path";
import { resolveSourceWorkspaceRoot } from "@/runtime/source-head";

export const SKILLS_REGISTRY_ROOT_ENV = "SKILLS_REGISTRY_ROOT" as const;

/** Resolve approved skill content from the launcher-verified source workspace. */
export function resolveSkillRegistryRoot(input: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  const env = input.env ?? process.env;
  const configuredRoot = env[SKILLS_REGISTRY_ROOT_ENV]?.trim();
  return path.resolve(configuredRoot || path.join(resolveSourceWorkspaceRoot(input), "skills"));
}
