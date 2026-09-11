import { z } from "zod";
import { ColorHuntPaletteSchema, PaletteSelectionSchema, TypographySelectionSchema } from "./resources";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const FACTORY_ANTI_AI_SLOP_HEURISTIC_IDS = [
  "generic-gradient",
  "lucide-saturation",
  "pure-white-everywhere",
  "rainbow-color-assignment",
  "shadows-under-everything",
  "generic-three-card-row",
  "decorative-emoji",
  "generic-glassmorphism",
  "excessive-em-dashes",
  "default-ai-font",
  "colored-left-border",
  "invented-testimonial",
  "generic-bento-grid",
  "fake-terminal-window",
  "not-x-but-y-copy",
  "repetitive-checkmark-list",
  "automatic-pricing-tiers",
  "missing-real-demo",
  "universal-rounded-corners",
  "purple-black-ai-palette",
  "missing-loading-state",
  "glowing-blurred-spheres",
  "dot-grid-background",
  "sparkle-icon-decoration",
  "animated-arrow-decoration",
  "missing-terms-requirement",
  "missing-privacy-requirement",
  "animation-on-every-hover",
  "default-neon-palette",
  "generic-pastel-palette",
] as const;

export const FactoryAntiAiSlopHeuristicIdSchema = z.enum(FACTORY_ANTI_AI_SLOP_HEURISTIC_IDS);
export type FactoryAntiAiSlopHeuristicId = z.infer<typeof FactoryAntiAiSlopHeuristicIdSchema>;

export const DesignFindingCategorySchema = z.enum([
  "DESIGN_FIDELITY",
  "TYPOGRAPHY",
  "COLOR",
  "SPACING",
  "SURFACES",
  "COMPONENTS",
  "ICONOGRAPHY",
  "MOTION",
  "RESPONSIVE",
  "ACCESSIBILITY",
  "UX_STATES",
  "CONTENT",
  "ANTI_AI_SLOP",
]);
export type DesignFindingCategory = z.infer<typeof DesignFindingCategorySchema>;

export const DesignFindingSeveritySchema = z.enum(["INFO", "WARNING", "BLOCKING"]);
export type DesignFindingSeverity = z.infer<typeof DesignFindingSeveritySchema>;

export const DesignFindingSourceSchema = z.enum([
  "FACTORY_ANTI_AI_SLOP",
  "IMPECCABLE",
  "DIALKIT",
  "DESIGN_SYSTEM",
]);
export type DesignFindingSource = z.infer<typeof DesignFindingSourceSchema>;

export const DesignFindingSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9:-]*$/),
  ruleId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  category: DesignFindingCategorySchema,
  severity: DesignFindingSeveritySchema,
  source: DesignFindingSourceSchema,
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  disposition: z.enum(["OPEN", "JUSTIFIED_BY_DESIGN", "CORRECTED", "WAIVED_BY_USER"]),
  justificationReference: z.string().max(500).optional(),
  path: z.string().min(1).max(240),
  summary: z.string().min(1).max(500),
  recommendation: z.string().min(1).max(500),
  justified: z.boolean(),
}).strict();
export type DesignFinding = z.infer<typeof DesignFindingSchema>;

export const DesignSystemChecklistInputSchema = z.object({
  files: z.array(z.object({ path: z.string().min(1).max(240), content: z.string().max(100_000) }).strict()).max(200),
  designChecksum: HashSchema,
  approvedDesignText: z.string().max(200_000).default(""),
  approvedDesignJustifications: z.record(z.string(), z.string().max(500)).default({}),
  taskType: z.string().min(1).optional(),
  productSignals: z.object({
    requiresInteractiveDemo: z.boolean().default(false),
    collectsPersonalData: z.boolean().default(false),
    requiresTerms: z.boolean().default(false),
    requiresPrivacy: z.boolean().default(false),
    dataDriven: z.boolean().default(false),
  }).strict().default({ requiresInteractiveDemo: false, collectsPersonalData: false, requiresTerms: false, requiresPrivacy: false, dataDriven: false }),
  typographySelection: TypographySelectionSchema.optional(),
  paletteEvidence: z.object({ candidate: ColorHuntPaletteSchema, selection: PaletteSelectionSchema }).strict().optional(),
}).strict();
export type DesignSystemChecklistInput = z.input<typeof DesignSystemChecklistInputSchema>;

export const DesignSystemChecklistResultSchema = z.object({
  implementationChecksum: HashSchema,
  designChecksum: HashSchema,
  designFidelity: z.enum(["PASS", "WARN", "FAIL"]),
  typography: z.enum(["PASS", "WARN", "FAIL"]),
  color: z.enum(["PASS", "WARN", "FAIL"]),
  spacing: z.enum(["PASS", "WARN", "FAIL"]),
  surfaces: z.enum(["PASS", "WARN", "FAIL"]),
  components: z.enum(["PASS", "WARN", "FAIL"]),
  iconography: z.enum(["PASS", "WARN", "FAIL"]),
  motion: z.enum(["PASS", "WARN", "FAIL"]),
  responsive: z.enum(["PASS", "WARN", "FAIL"]),
  accessibility: z.enum(["PASS", "WARN", "FAIL"]),
  uxStates: z.enum(["PASS", "WARN", "FAIL"]),
  content: z.enum(["PASS", "WARN", "FAIL"]),
  antiAiSlop: z.enum(["PASS", "WARN", "FAIL"]),
  findings: z.array(DesignFindingSchema).max(200),
  verdict: z.enum(["PASS", "PASS_WITH_WARNINGS", "BLOCK"]),
}).strict();
export type DesignSystemChecklistResult = z.infer<typeof DesignSystemChecklistResultSchema>;
