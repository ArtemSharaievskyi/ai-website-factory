import "server-only";
import { SkillRegistry } from "./registry";

export function createConfiguredSkillRegistry() {
  const root = process.env.SKILLS_REGISTRY_ROOT ?? `${process.cwd()}\\skills`;
  return new SkillRegistry(root);
}
