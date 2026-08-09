export type SkillFile = { relativePath: string; sha256: string; byteSize: number; kind: "entry" | "reference" | "script" | "template" | "other"; executable: boolean; text?: string };
