import { createHash } from "node:crypto";
import { z } from "zod";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export const DIALKIT_AUTHORING_CAPABILITY_ID = "dialkit-authoring" as const;

export const DialKitParameterSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/),
  value: z.union([z.string().max(200), z.number().finite(), z.boolean()]),
  tokenPath: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/),
}).strict();
export type DialKitParameter = z.infer<typeof DialKitParameterSchema>;

export const DialKitAuthoringSessionSchema = z.object({
  sessionId: z.string().min(1).max(160),
  parameters: z.array(DialKitParameterSchema).max(100),
  canonicalTokenChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  authoringOnly: z.literal(true),
  productionDependency: z.literal("NONE"),
}).strict();
export type DialKitAuthoringSession = z.infer<typeof DialKitAuthoringSessionSchema>;

export const DialKitLeakFindingSchema = z.object({
  ruleId: z.enum(["dialkit-runtime-dependency", "dialkit-ui-exposed"]),
  path: z.string().min(1).max(240),
  summary: z.string().min(1).max(500),
}).strict();
export type DialKitLeakFinding = z.infer<typeof DialKitLeakFindingSchema>;

export const DialKitProductionCheckSchema = z.object({
  status: z.enum(["PASS", "BLOCK"]),
  productionRuntimeDependency: z.boolean(),
  findings: z.array(DialKitLeakFindingSchema).max(50),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  authoringOnly: z.literal(true),
}).strict();
export type DialKitProductionCheck = z.infer<typeof DialKitProductionCheckSchema>;

export function createDialKitAuthoringSession(input: Omit<DialKitAuthoringSession, "canonicalTokenChecksum" | "authoringOnly" | "productionDependency">) {
  const parameters = input.parameters.map((parameter) => DialKitParameterSchema.parse(parameter)).sort((left, right) => left.name.localeCompare(right.name));
  return DialKitAuthoringSessionSchema.parse({
    ...input,
    parameters,
    canonicalTokenChecksum: sha(JSON.stringify(parameters)),
    authoringOnly: true,
    productionDependency: "NONE",
  });
}

const sourceChecksum = (files: ReadonlyArray<{ path: string; content: string }>) =>
  sha(JSON.stringify(files.map((file) => ({ path: file.path, content: file.content }))));

const stripComments = (content: string) => content
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/[^\r\n]*/g, "$1");

/**
 * DialKit is intentionally represented as a design-time authoring boundary.
 * This check is read-only and is suitable for a release candidate; it never
 * executes DialKit or changes the candidate workspace.
 */
export function validateNoDialKitProductionLeak(files: ReadonlyArray<{ path: string; content: string }>): DialKitProductionCheck {
  const findings: DialKitLeakFinding[] = [];
  let productionRuntimeDependency = false;
  for (const file of files) {
    if (file.path === "package.json") {
      try {
        const packageJson = JSON.parse(file.content) as { dependencies?: Record<string, unknown> };
        if (Object.keys(packageJson.dependencies ?? {}).some((name) => /dialkit/i.test(name))) {
          productionRuntimeDependency = true;
          findings.push({ ruleId: "dialkit-runtime-dependency", path: file.path, summary: "DialKit is present in production dependencies; keep authoring tooling out of the shipped runtime." });
        }
      } catch {
        // package.json validity belongs to the runtime validator; this check only
        // reports a DialKit leak when the dependency object can be read safely.
      }
    }
    const source = stripComments(file.content);
    if (/(?:from\s*["'][^"']*dialkit|import\s*\(\s*["'][^"']*dialkit|<\s*DialKit(?:Panel|Controls|Provider)?\b|\buseDialKit\s*\(|\bDialKit(?:Panel|Controls)\b)/i.test(source)) {
      findings.push({ ruleId: "dialkit-ui-exposed", path: file.path, summary: "A DialKit import or authoring control is exposed in the production candidate." });
    }
  }
  return DialKitProductionCheckSchema.parse({
    status: findings.length ? "BLOCK" : "PASS",
    productionRuntimeDependency,
    findings,
    sourceChecksum: sourceChecksum(files),
    authoringOnly: true,
  });
}

export const DialKitAuthoringCapability = Object.freeze({
  id: DIALKIT_AUTHORING_CAPABILITY_ID,
  productionDependency: "NONE" as const,
  authoringOnly: true as const,
  validateProductionCandidate: validateNoDialKitProductionLeak,
});
