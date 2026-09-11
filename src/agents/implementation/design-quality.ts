import { createHash } from "node:crypto";
import { z } from "zod";
import { detectImpeccableAntiPatterns } from "@/integrations/design/impeccable";
import { validateNoDialKitProductionLeak } from "@/integrations/design/dialkit";
import { evaluatePaletteSelection, validateGoogleFontRuntimePrivacy, validateTypographySelection } from "@/domain/design/resources";
import {
  DesignFindingSchema,
  DesignSystemChecklistInputSchema,
  DesignSystemChecklistResultSchema,
  FACTORY_ANTI_AI_SLOP_HEURISTIC_IDS,
  type DesignFinding,
  type DesignFindingCategory,
  type DesignFindingSeverity,
  type DesignSystemChecklistInput,
  type DesignSystemChecklistResult,
  type FactoryAntiAiSlopHeuristicId,
} from "@/domain/design/quality-contract";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const sourceChecksum = (files: ReadonlyArray<{ path: string; content: string }>) => sha(JSON.stringify(files.map((file) => ({ path: file.path, content: file.content }))));

const categoryForRule: Record<string, DesignFindingCategory> = {
  "generic-gradient": "COLOR",
  "lucide-saturation": "ICONOGRAPHY",
  "pure-white-everywhere": "COLOR",
  "rainbow-color-assignment": "COLOR",
  "shadows-under-everything": "SURFACES",
  "generic-three-card-row": "COMPONENTS",
  "decorative-emoji": "ICONOGRAPHY",
  "generic-glassmorphism": "SURFACES",
  "excessive-em-dashes": "CONTENT",
  "default-ai-font": "TYPOGRAPHY",
  "colored-left-border": "SURFACES",
  "invented-testimonial": "CONTENT",
  "generic-bento-grid": "COMPONENTS",
  "fake-terminal-window": "COMPONENTS",
  "not-x-but-y-copy": "CONTENT",
  "repetitive-checkmark-list": "CONTENT",
  "automatic-pricing-tiers": "CONTENT",
  "missing-real-demo": "DESIGN_FIDELITY",
  "universal-rounded-corners": "SURFACES",
  "purple-black-ai-palette": "COLOR",
  "missing-loading-state": "UX_STATES",
  "glowing-blurred-spheres": "COLOR",
  "dot-grid-background": "COLOR",
  "sparkle-icon-decoration": "ICONOGRAPHY",
  "animated-arrow-decoration": "MOTION",
  "missing-terms-requirement": "CONTENT",
  "missing-privacy-requirement": "CONTENT",
  "animation-on-every-hover": "MOTION",
  "default-neon-palette": "COLOR",
  "generic-pastel-palette": "COLOR",
};

const recommendationForRule: Record<string, string> = {
  "generic-gradient": "Use a gradient only when the approved visual system gives it a specific role and palette.",
  "lucide-saturation": "Use a constrained icon subset or a product-specific visual language; keep labels primary.",
  "pure-white-everywhere": "Establish intentional canvas, surface, border, and text relationships from the approved Design.",
  "rainbow-color-assignment": "Map color to semantic meaning instead of assigning an unrelated accent to every item.",
  "shadows-under-everything": "Reserve elevation for hierarchy and use flat separation where a shadow adds no meaning.",
  "generic-three-card-row": "Choose a composition that reflects the information hierarchy instead of repeating identical cards.",
  "decorative-emoji": "Use approved iconography, illustration, or text rather than emoji as a visual primitive.",
  "generic-glassmorphism": "Use blur and transparency only when they clarify layering or are explicit in the approved Design.",
  "excessive-em-dashes": "Rewrite copy in a natural product voice and vary sentence structure.",
  "default-ai-font": "Record a deliberate typographic rationale or use the approved typography contract.",
  "colored-left-border": "Use component hierarchy and spacing instead of repeated accent-border decoration.",
  "invented-testimonial": "Remove unsupplied testimonials, names, claims, and social proof; request approved content.",
  "generic-bento-grid": "Use a bento layout only when the content relationships require it.",
  "fake-terminal-window": "Reserve terminal presentation for a genuine developer or command-line product surface.",
  "not-x-but-y-copy": "Use direct, specific product language instead of a stock contrast cliché.",
  "repetitive-checkmark-list": "Use the content structure that best communicates the benefit; do not decorate every item with checks.",
  "automatic-pricing-tiers": "Use only approved pricing and plan names; do not invent a Basic/Pro/Enterprise model.",
  "missing-real-demo": "Provide the approved interactive evidence or surface the missing product requirement.",
  "universal-rounded-corners": "Use a small intentional shape scale and distinguish regions, panels, rows, and controls.",
  "purple-black-ai-palette": "Tie the palette to brand character and semantic roles rather than a generic AI/SaaS default.",
  "missing-loading-state": "Provide an intentional loading, pending, skeleton, or progress state for the data-driven surface.",
  "glowing-blurred-spheres": "Remove decorative glow filler unless it has a specific approved art-direction role.",
  "dot-grid-background": "Remove stock background decoration unless the approved Design gives it a product-specific purpose.",
  "sparkle-icon-decoration": "Use iconography that communicates the product domain; do not use sparkle symbols as generic AI decoration.",
  "animated-arrow-decoration": "Animate an arrow only when its movement communicates a real navigation or state change.",
  "missing-terms-requirement": "Surface the need for approved legal terms or user agreement content; do not fabricate it.",
  "missing-privacy-requirement": "Surface the need for approved privacy and consent content; do not fabricate legal copy.",
  "animation-on-every-hover": "Keep a small set of meaningful interaction motifs and remove attention-seeking hover motion.",
  "default-neon-palette": "Use neon only when the approved brand system assigns it a deliberate semantic role.",
  "generic-pastel-palette": "Use a committed, product-specific palette instead of low-commitment pastel decoration.",
};

const justificationPatterns: Partial<Record<FactoryAntiAiSlopHeuristicId, RegExp>> = {
  "generic-gradient": /approved|brand|art.direction|specific.{0,30}gradient/i,
  "lucide-saturation": /lucide.{0,80}(restrained|subset|selected|coherent|approved)/i,
  "pure-white-everywhere": /white.{0,80}editorial|editorial.{0,80}white|white.{0,80}canvas/i,
  "rainbow-color-assignment": /rainbow.{0,40}(semantic|approved|brand)/i,
  "generic-three-card-row": /(?:three|3).{0,20}column.{0,40}(data|layout)|three.{0,20}card/i,
  "generic-glassmorphism": /glass|blur.{0,40}(layer|overlay).{0,40}(approved|intent)/i,
  "default-ai-font": /(?:inter|geist|space grotesk).{0,100}(brand|system|approved|intent|deliberate|specified|justif)/i,
  "generic-bento-grid": /bento.{0,80}(approved|information architecture|content relationship)/i,
  "missing-real-demo": /(?:real|interactive|product).{0,30}(demo|evidence|preview)/i,
  "purple-black-ai-palette": /purple.{0,80}(brand|approved|specific)|black.{0,80}(brand|approved|specific)/i,
  "default-neon-palette": /neon.{0,80}(brand|approved|semantic|specific)/i,
  "generic-pastel-palette": /pastel.{0,80}(brand|approved|specific)/i,
};

const pathFor = (files: ReadonlyArray<{ path: string; content: string }>) => files[0]?.path ?? "<implementation>";
const justificationRuleFor = (ruleId: string): FactoryAntiAiSlopHeuristicId | undefined => ruleId === "generic-purple-gradient" ? "generic-gradient" : (FACTORY_ANTI_AI_SLOP_HEURISTIC_IDS as readonly string[]).includes(ruleId) ? ruleId as FactoryAntiAiSlopHeuristicId : undefined;
const count = (value: string, expression: RegExp) => value.match(expression)?.length ?? 0;
const distinctMatches = (value: string, expression: RegExp) => new Set([...value.matchAll(expression)].map((match) => match[0]!.toLowerCase())).size;

function designJustification(input: z.infer<typeof DesignSystemChecklistInputSchema>, ruleId: string) {
  const mappedRule = justificationRuleFor(ruleId);
  const explicit = input.approvedDesignJustifications[ruleId] ?? (mappedRule ? input.approvedDesignJustifications[mappedRule] : undefined);
  if (explicit?.trim()) return explicit.trim();
  return mappedRule && input.approvedDesignText && justificationPatterns[mappedRule]?.test(input.approvedDesignText) ? `approved-design:${mappedRule}` : undefined;
}

function addFinding(findings: DesignFinding[], input: z.infer<typeof DesignSystemChecklistInputSchema>, ruleId: string, severity: DesignFindingSeverity, summary: string, category: DesignFindingCategory = categoryForRule[ruleId] ?? "ANTI_AI_SLOP", source: DesignFinding["source"] = "FACTORY_ANTI_AI_SLOP") {
  const isFactoryHeuristic = (FACTORY_ANTI_AI_SLOP_HEURISTIC_IDS as readonly string[]).includes(ruleId);
  const justificationReference = isFactoryHeuristic || source === "IMPECCABLE" ? designJustification(input, ruleId) : undefined;
  const disposition = justificationReference ? "JUSTIFIED_BY_DESIGN" : "OPEN";
  findings.push(DesignFindingSchema.parse({ id: `${source.toLowerCase().replaceAll("_", "-")}:${ruleId}:${findings.length + 1}`, ruleId, category, severity, source, confidence: source === "DIALKIT" || source === "DESIGN_SYSTEM" ? "HIGH" : source === "IMPECCABLE" ? "MEDIUM" : "LOW", disposition, ...(justificationReference ? { justificationReference } : {}), path: pathFor(input.files), summary, recommendation: recommendationForRule[ruleId] ?? "Resolve the finding within the bounded implementation scope.", justified: disposition === "JUSTIFIED_BY_DESIGN" }));
}

function evaluateFactoryHeuristics(input: z.infer<typeof DesignSystemChecklistInputSchema>, text: string, findings: DesignFinding[]) {
  if (/linear-gradient|radial-gradient|bg-gradient-to-/i.test(text)) addFinding(findings, input, "generic-gradient", "WARNING", "A generic gradient-like treatment was found.");
  if (/(?:lucide-react|Lucide[A-Z][A-Za-z]*Icon)/i.test(text) && (count(text, /\b[A-Z][A-Za-z]*(?:Icon|Lucide[A-Z][A-Za-z]*)\b/g) >= 3 || count(text, /lucide-react/gi) >= 3)) addFinding(findings, input, "lucide-saturation", "WARNING", "The source uses a high density of generic Lucide-style icons.");
  if (count(text, /(?:bg-white|background(?:-color)?\s*:\s*#(?:fff|ffffff)\b|--[\w-]+\s*:\s*#(?:fff|ffffff)\b)/gi) >= 3) addFinding(findings, input, "pure-white-everywhere", "WARNING", "White canvas/surface treatments appear to be the unexamined default.");
  if (distinctMatches(text, /\b(?:red|orange|yellow|green|blue|purple|pink|indigo|cyan|teal)\b/gi) >= 5) addFinding(findings, input, "rainbow-color-assignment", "WARNING", "Many unrelated named colors are assigned in the same interface.");
  if (count(text, /\bshadow(?:-[a-z0-9[].]+)?\b/gi) >= 4) addFinding(findings, input, "shadows-under-everything", "WARNING", "Shadows are applied repeatedly across the interface.");
  if (/grid-cols-3|grid-template-columns\s*:\s*repeat\(\s*3/i.test(text) && count(text, /(?:feature|<Card\b|card)/gi) >= 3) addFinding(findings, input, "generic-three-card-row", "WARNING", "A repeated three-card feature row is used without visible information-architecture differentiation.");
  if (/[\u{1F300}-\u{1FAFF}]/u.test(text)) addFinding(findings, input, "decorative-emoji", "WARNING", "Emoji appears to be used as decorative interface iconography.");
  if (/backdrop-filter|backdrop-blur|glassmorphism|bg-white\/(?:10|20|30|40|50)/i.test(text)) addFinding(findings, input, "generic-glassmorphism", "WARNING", "Blur/transparency appears as a generic surface treatment.");
  if (count(text, /—/g) >= 3) addFinding(findings, input, "excessive-em-dashes", "WARNING", "Copy contains an unusually repetitive em-dash cadence.");
  if (/\b(?:Inter|Geist|Space Grotesk)\b/i.test(text)) addFinding(findings, input, "default-ai-font", "WARNING", "A commonly defaulted AI-interface font is used without a detectable local rationale.");
  if (count(text, /border-l(?:-[a-z0-9[].]+)?\b|border-left\s*:/gi) >= 2) addFinding(findings, input, "colored-left-border", "WARNING", "Repeated colored left borders are used as generic content decoration.");
  if (/testimonial|customer quote|what (?:our|customers) say|trusted by/i.test(text)) addFinding(findings, input, "invented-testimonial", "BLOCKING", "The implementation contains testimonial or social-proof content that must be supplied or approved.", "CONTENT");
  if (/\bbento\b/i.test(text) || /grid-cols-[4-9]/i.test(text) && /bento|asymmetric/i.test(text)) addFinding(findings, input, "generic-bento-grid", "WARNING", "A bento-style grid is present without a detectable content-specific rationale.");
  if (/terminal|command-line|shell prompt|fake console/i.test(text) || />\s*(?:npm|git|pnpm|yarn)\s+/i.test(text)) addFinding(findings, input, "fake-terminal-window", "WARNING", "Terminal presentation appears to be decorative rather than product evidence.");
  if (/(?:it['’]s|it is)\s+not\s+[^.]{1,80}[,.]\s*(?:it['’]s|it is)\s+/i.test(text) || /not\s+[^.]{1,80}\s+but\s+/i.test(text)) addFinding(findings, input, "not-x-but-y-copy", "WARNING", "Stock contrast-copy construction was detected.");
  if (count(text, /(?:✅|checkmark|CheckCircle|CheckIcon|\bcheck\b)/gi) >= 4) addFinding(findings, input, "repetitive-checkmark-list", "WARNING", "Repeated checkmark treatment is used for benefits or feature content.");
  if (/\b(?:basic|pro|enterprise)\b[\s\S]{0,300}\b(?:basic|pro|enterprise)\b/i.test(text) || /pricing.{0,50}(?:tier|plan)/i.test(text)) addFinding(findings, input, "automatic-pricing-tiers", "WARNING", "A default pricing-tier pattern appears without an approved pricing requirement.");
  if (input.productSignals.requiresInteractiveDemo && !/demo|interactive|playground|try it|preview/i.test(text)) addFinding(findings, input, "missing-real-demo", "BLOCKING", "The product signal requires interactive evidence, but no demo or equivalent surface is present.", "DESIGN_FIDELITY");
  if (count(text, /\brounded(?:-[a-z0-9[].]+)?\b/gi) >= 5) addFinding(findings, input, "universal-rounded-corners", "WARNING", "Rounded-corner treatment is repeated across nearly every surface.");
  if (/(?:purple|violet).{0,100}(?:black|#000|#0b0b0b)|(?:black|#000|#0b0b0b).{0,100}(?:purple|violet)/i.test(text)) addFinding(findings, input, "purple-black-ai-palette", "WARNING", "The default purple-and-black AI/SaaS palette pattern was detected.");
  if ((input.productSignals.dataDriven || /\bfetch\s*\(|useSWR|useQuery|queryClient|server action/i.test(text)) && !/loading|skeleton|pending|progress/i.test(text)) addFinding(findings, input, "missing-loading-state", "WARNING", "A data-driven surface has no detectable loading or pending state.");
  if (/(?:glow|orb|sphere).{0,80}(?:blur|gradient)|(?:blur|gradient).{0,80}(?:glow|orb|sphere)/i.test(text)) addFinding(findings, input, "glowing-blurred-spheres", "WARNING", "A decorative glowing or blurred sphere appears as background filler.");
  if (/dot[- ]grid|background[^;]*(?:radial-gradient|dots?)/i.test(text)) addFinding(findings, input, "dot-grid-background", "WARNING", "A generic dot-grid background treatment was detected.");
  if (/sparkle|sparkles|✨|stars? icon/i.test(text)) addFinding(findings, input, "sparkle-icon-decoration", "WARNING", "Sparkle/star iconography appears to be used as generic decoration.");
  if (/(?:arrow|Arrow)[^\n]{0,80}(?:animate|bounce|translate|slide)|(?:animate|bounce)[^\n]{0,80}(?:arrow|Arrow)/i.test(text)) addFinding(findings, input, "animated-arrow-decoration", "WARNING", "An animated arrow appears without a clear navigation or state purpose.");
  if (input.productSignals.requiresTerms && !/\bterms?\b|user agreement|conditions/i.test(text)) addFinding(findings, input, "missing-terms-requirement", "WARNING", "The product signal requires terms or agreement content, but none is present.", "CONTENT");
  if ((input.productSignals.requiresPrivacy || input.productSignals.collectsPersonalData) && !/privacy|consent|cookie/i.test(text)) addFinding(findings, input, "missing-privacy-requirement", "WARNING", "Personal-data or tracking behavior is present without an approved privacy/consent surface.", "CONTENT");
  if (count(text, /(?:hover:|group-hover:)/gi) >= 3 || count(text, /(?:hover:|:hover\b|group-hover:)[^\n]{0,100}(?:scale|translate|shadow|glow|animate|rotate)/gi) >= 3 || count(text, /:hover\s*\{[^}]*\b(?:transform|filter|box-shadow)/gi) >= 3) addFinding(findings, input, "animation-on-every-hover", "BLOCKING", "Motion is applied to many hover targets instead of a small coherent interaction vocabulary.", "MOTION");
  if (/\bneon\b|#(?:0ff|f0f|39ff14)\b|text-cyan-[4-9]00|bg-fuchsia-[4-9]00/i.test(text)) addFinding(findings, input, "default-neon-palette", "WARNING", "A generic neon accent treatment was detected.");
  if (/\bpastel\b|bg-(?:pink|rose|lavender|sky|yellow)-50|#(?:fce7f3|fef3c7|dbeafe)\b/i.test(text) && count(text, /(?:pastel|bg-(?:pink|rose|lavender|sky|yellow)-50|#(?:fce7f3|fef3c7|dbeafe)\b)/gi) >= 2) addFinding(findings, input, "generic-pastel-palette", "WARNING", "A generic pastel palette appears without a product-specific rationale.");
}

function categoryStatus(findings: readonly DesignFinding[], category: DesignFindingCategory): "PASS" | "WARN" | "FAIL" {
  const matches = findings.filter((finding) => finding.category === category && finding.disposition === "OPEN");
  return matches.some((finding) => finding.severity === "BLOCKING") ? "FAIL" : matches.some((finding) => finding.severity === "WARNING") ? "WARN" : "PASS";
}

export function runDesignSystemChecklist(raw: DesignSystemChecklistInput): DesignSystemChecklistResult {
  const input = DesignSystemChecklistInputSchema.parse(raw);
  const findings: DesignFinding[] = [];
  const text = input.files.map((file) => file.content).join("\n");
  evaluateFactoryHeuristics(input, text, findings);

  if (input.typographySelection) {
    const typography = validateTypographySelection(input.typographySelection, undefined, input.approvedDesignText);
    for (const item of typography.findings) addFinding(findings, input, item.code === "TYPOGRAPHY_RATIONALE_REQUIRED" ? "default-ai-font" : "typography-resource-contract", item.severity, item.summary, "TYPOGRAPHY", "DESIGN_SYSTEM");
  }
  if (input.paletteEvidence) {
    const palette = evaluatePaletteSelection({ candidate: input.paletteEvidence.candidate, semanticTokens: input.paletteEvidence.selection.semanticTokens, rationale: input.paletteEvidence.selection.rationale, adjustments: input.paletteEvidence.selection.adjustments, approvedByDesign: input.paletteEvidence.selection.approvedByDesign, approvedBrandMatch: input.paletteEvidence.selection.approvedBrandMatch });
    for (const item of palette.findings) addFinding(findings, input, item.code === "PALETTE_CONTRAST_FAILED" ? "palette-contrast" : item.code === "PALETTE_BLIND_COPY" ? "palette-blind-copy" : "palette-rationale", item.severity, item.summary, item.code === "PALETTE_CONTRAST_FAILED" ? "ACCESSIBILITY" : "COLOR", "DESIGN_SYSTEM");
  }
  const fontPrivacy = validateGoogleFontRuntimePrivacy(input.files);
  for (const item of fontPrivacy.findings) addFinding(findings, input, "runtime-google-font-request", "BLOCKING", item.summary, "ACCESSIBILITY", "DESIGN_SYSTEM");

  const impeccable = detectImpeccableAntiPatterns(input.files);
  for (const finding of impeccable.findings) {
    const category: DesignFindingCategory = finding.ruleId === "oversized-h1" ? "TYPOGRAPHY" : finding.ruleId === "generic-purple-gradient" || finding.ruleId === "cream-palette" ? "COLOR" : "MOTION";
    addFinding(findings, input, finding.ruleId, finding.severity === "error" ? "BLOCKING" : finding.severity === "warning" ? "WARNING" : "INFO", finding.summary, category, "IMPECCABLE");
  }

  const dialKit = validateNoDialKitProductionLeak(input.files);
  for (const finding of dialKit.findings) addFinding(findings, input, finding.ruleId, "BLOCKING", finding.summary, "ANTI_AI_SLOP", "DIALKIT");

  const hasMotion = /animation|transition|@keyframes|:hover\b|hover:/i.test(text);
  if (hasMotion && !/prefers-reduced-motion|motion-reduce|reducedMotion|reduced-motion/i.test(text)) addFinding(findings, input, "reduced-motion-support", "BLOCKING", "Motion is present without an explicit reduced-motion fallback.", "ACCESSIBILITY", "DESIGN_SYSTEM");
  if (/\b(?:w|width)\s*[:=\[]\s*(?:1200|1440)px|w-\[(?:1000|1200|1440)px\]|min-width\s*:\s*\d{4,}px/i.test(text)) addFinding(findings, input, "fixed-wide-layout", "WARNING", "A fixed wide layout risks overflow at mobile widths.", "RESPONSIVE", "DESIGN_SYSTEM");

  const effectiveFindings = findings.filter((finding) => finding.disposition === "OPEN");
  const hasWarnings = effectiveFindings.some((finding) => finding.severity === "WARNING");
  const hasBlocking = effectiveFindings.some((finding) => finding.severity === "BLOCKING");
  const antiAiFindings = effectiveFindings.filter((finding) => finding.source === "FACTORY_ANTI_AI_SLOP" || finding.source === "IMPECCABLE" || finding.source === "DIALKIT");
  return DesignSystemChecklistResultSchema.parse({
    implementationChecksum: sourceChecksum(input.files),
    designChecksum: input.designChecksum,
    designFidelity: categoryStatus(findings, "DESIGN_FIDELITY"),
    typography: categoryStatus(findings, "TYPOGRAPHY"),
    color: categoryStatus(findings, "COLOR"),
    spacing: categoryStatus(findings, "SPACING"),
    surfaces: categoryStatus(findings, "SURFACES"),
    components: categoryStatus(findings, "COMPONENTS"),
    iconography: categoryStatus(findings, "ICONOGRAPHY"),
    motion: categoryStatus(findings, "MOTION"),
    responsive: categoryStatus(findings, "RESPONSIVE"),
    accessibility: categoryStatus(findings, "ACCESSIBILITY"),
    uxStates: categoryStatus(findings, "UX_STATES"),
    content: categoryStatus(findings, "CONTENT"),
    antiAiSlop: antiAiFindings.some((finding) => finding.severity === "BLOCKING") ? "FAIL" : antiAiFindings.length ? "WARN" : "PASS",
    findings,
    verdict: hasBlocking ? "BLOCK" : hasWarnings ? "PASS_WITH_WARNINGS" : "PASS",
  });
}

export const DesignSystemChecklist = Object.freeze({
  run: runDesignSystemChecklist,
  heuristicCount: FACTORY_ANTI_AI_SLOP_HEURISTIC_IDS.length,
});

export const AntiAISlopDesignGuard = Object.freeze({
  evaluate: (input: DesignSystemChecklistInput) => runDesignSystemChecklist(input).findings.filter((finding) => finding.source === "FACTORY_ANTI_AI_SLOP"),
  heuristicCount: FACTORY_ANTI_AI_SLOP_HEURISTIC_IDS.length,
});

export const detectAntiAISlopDesignGuard = AntiAISlopDesignGuard.evaluate;
