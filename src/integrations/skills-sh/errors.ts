import { SkillError } from "@/skills/registry/errors";
export class SkillsShError extends SkillError { constructor(code: ConstructorParameters<typeof SkillError>[0], message: string, details?: Record<string, string | number | boolean>, cause?: unknown) { super(code, message, details, cause); this.name = "SkillsShError"; } }
