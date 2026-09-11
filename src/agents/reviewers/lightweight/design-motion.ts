import { createHash } from "node:crypto";
import { z } from "zod";
import { runDesignSystemChecklist } from "@/agents/implementation/design-quality";
import {
  AgentReviewResultSchema,
  AnimationOpportunityResultSchema,
  MotionImprovementResultSchema,
  MotionReviewCategorySchema,
  ReviewFindingSchema,
  type AgentReviewResult,
  type AnimationOpportunity,
  type DesignReviewCategory,
  type MotionImprovementPlan,
  type ReviewFinding,
  type ReviewSnapshot,
} from "@/domain/review/lightweight";
import {
  EMIL_ANIMATION_IMPROVEMENT_SKILL_ID,
  EMIL_ANIMATION_OPPORTUNITY_SKILL_ID,
  EMIL_ANIMATION_REVIEW_SKILL_ID,
  EMIL_DESIGN_ENGINEERING_SKILL_ID,
  EMIL_ANIMATION_RULES,
  EMIL_SKILL_PROVENANCE,
} from "@/integrations/design/emil";
import type { LightweightReviewInput, LightweightReviewRunner } from "./orchestrator";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const approvedSkillChecksum = (skillId: string) => EMIL_SKILL_PROVENANCE.find((item) => item.registrySkillId === skillId)?.approvedContentChecksum ?? sha(skillId);
const sourceText = (snapshot: ReviewSnapshot) => snapshot.evidencePack.sourceFiles.map((file) => ({ file, content: file.content ?? "" }));
const evidence = (snapshot: ReviewSnapshot, extra: string[] = []) => [...new Set([...snapshot.evidencePack.evidenceRefs, ...snapshot.approvedRoutes, ...extra])].slice(0, 100);
const lineFor = (content: string, expression: RegExp) => {
  const match = expression.exec(content);
  return match?.index === undefined ? 1 : content.slice(0, match.index).split(/\r?\n/).length;
};
const artifactRef = (path: string, line: number) => `${path}:${line}`;
const finding = (agent: "design-review" | "animation-review", input: Omit<ReviewFinding, "agent">) => ReviewFindingSchema.parse({ ...input, agent });
const result = (snapshot: ReviewSnapshot, agent: "design-review" | "animation-review", findings: ReviewFinding[], checksExecuted: string[], extraEvidence: string[] = []) => AgentReviewResultSchema.parse({ agent, status: findings.some((item) => item.blocking) ? "BLOCK" : findings.length ? "WARN" : "PASS", findings, checksExecuted, evidenceRefs: evidence(snapshot, extraEvidence), artifactFingerprint: snapshot.implementationChecksum });

const designRefs = (snapshot: ReviewSnapshot) => snapshot.designChecksum ? [snapshot.designChecksum] : undefined;
const designFinding = (snapshot: ReviewSnapshot, input: { id: string; category: DesignReviewCategory; severity: ReviewFinding["severity"]; blocking: boolean; title: string; summary: string; file: string; line: number; repairRequired?: boolean }) => finding("design-review", {
  id: input.id,
  category: input.category,
  severity: input.severity,
  confidence: "HIGH",
  title: input.title,
  safeSummary: input.summary,
  affectedArtifacts: [input.file],
  affectedFiles: [input.file],
  evidence: evidence(snapshot, [artifactRef(input.file, input.line)]),
  blocking: input.blocking,
  repairRequired: input.repairRequired ?? input.blocking,
  designRefs: designRefs(snapshot),
  invariant: "independent-design-craft",
});

export class DesignReviewAgent implements LightweightReviewRunner {
  readonly agent = "design-review" as const;
  readonly readOnly = true as const;
  readonly sourceWriteAuthority = "NONE" as const;
  readonly canonicalMutationAuthority = "NONE" as const;
  readonly checksExecuted = [
    "design.hierarchy",
    "design.typography",
    "design.spacing",
    "design.layout",
    "design.surfaces",
    "design.color",
    "design.iconography",
    "design.component-consistency",
    "design.interaction-polish",
    "design.responsive-craft",
    "design.distinctiveness",
    "design.ai-slop",
    "design.motion-cohesion",
    "design-system-checklist.evidence",
    "anti-ai-slop.evidence",
    "impeccable.evidence",
    "emil-design-eng",
  ];

  async review(input: LightweightReviewInput): Promise<AgentReviewResult> {
    const snapshot = input.snapshot;
    const files = sourceText(snapshot);
    const allText = files.map((item) => item.content).join("\n");
    const findings: ReviewFinding[] = [];
    const approvedDesignText = snapshot.designChecksum ? `Approved Design checksum: ${snapshot.designChecksum}` : "";
    const checklist = runDesignSystemChecklist({
      files: files.map(({ file, content }) => ({ path: file.relativePath, content })),
      designChecksum: snapshot.designChecksum ?? sha("missing-design"),
      approvedDesignText,
    });
    const firstFile = files[0]?.file.relativePath ?? snapshot.snapshotId;
    const firstContent = files[0]?.content ?? "";
    const add = (value: Parameters<typeof designFinding>[1]) => findings.push(designFinding(snapshot, value));

    if (!snapshot.designChecksum) add({ id: "design-review-approved-design-missing", category: "LAYOUT", severity: "HIGH", blocking: true, title: "Approved Design reference is missing", summary: "Independent design review cannot judge professional craft without an approved Design reference bound to the implementation snapshot.", file: firstFile, line: 1 });
    if (files.some(({ file }) => file.markers.includes("weak-hierarchy")) || (allText.match(/<h[1-6]\b/gi)?.length ?? 0) >= 5 && !/<h1\b/i.test(allText)) add({ id: "design-review-weak-hierarchy", category: "VISUAL_HIERARCHY", severity: "HIGH", blocking: true, title: "Visual hierarchy is not intentional", summary: "The implementation evidence shows a weak or missing primary hierarchy; technical validity does not establish a professional reading order.", file: firstFile, line: lineFor(firstContent, /<h[1-6]\b/i) });
    if (files.some(({ file }) => file.markers.includes("weak-typography")) || /font-size:\s*(?:12|13)px[\s\S]{0,300}font-weight:\s*400/i.test(allText) && !/font-family|typography|font-weight:\s*[5-9]00/i.test(allText)) add({ id: "design-review-weak-typography", category: "TYPOGRAPHY", severity: "HIGH", blocking: true, title: "Typography lacks a clear system", summary: "Typography evidence does not establish a deliberate hierarchy of display, body, and supporting text roles.", file: firstFile, line: lineFor(firstContent, /font-size:\s*(?:12|13)px/i) });
    if (files.some(({ file }) => file.markers.includes("inconsistent-spacing")) || /(?:p-1|p-2|p-10|p-12|m-1|m-2|m-10|gap-1|gap-2|gap-10)\b/g.test(allText) && /(?:space-y|gap-|padding|margin)/i.test(allText) && /(?:p-1|p-2|p-10|p-12)\b/g.test(allText)) add({ id: "design-review-inconsistent-spacing", category: "SPACING", severity: "HIGH", blocking: true, title: "Spacing rhythm is inconsistent", summary: "The implementation evidence mixes unrelated spacing extremes without a visible coherent rhythm.", file: firstFile, line: lineFor(firstContent, /(?:p-1|p-2|p-10|p-12|gap-10)\b/i) });
    if (files.some(({ file }) => file.markers.includes("generic-card")) || (/grid-cols-3|grid-template-columns\s*:\s*repeat\(\s*3/i.test(allText) && (allText.match(/card/gi)?.length ?? 0) >= 3)) add({ id: "design-review-generic-components", category: "COMPONENT_CONSISTENCY", severity: "HIGH", blocking: true, title: "Components read as generic repeated cards", summary: "The interface relies on repeated card surfaces without enough evidence of content-specific composition or hierarchy.", file: firstFile, line: lineFor(firstContent, /card|grid-cols-3/i) });
    if (files.some(({ file }) => ["weak-layout", "layout-failure", "layout-break", "unbalanced-layout"].some((marker) => file.markers.includes(marker)))) add({ id: "design-review-layout", category: "LAYOUT", severity: "HIGH", blocking: true, title: "Layout does not preserve the approved composition", summary: "The bounded evidence marks a layout composition or alignment defect that weakens hierarchy, proportion, or reading flow.", file: firstFile, line: 1 });
    if (files.some(({ file }) => file.markers.includes("weak-color") || file.markers.includes("unreadable-color"))) add({ id: "design-review-weak-color", category: "COLOR", severity: "HIGH", blocking: true, title: "Color roles are not sufficiently intentional", summary: "The bounded design evidence marks a weak or unreadable palette relationship; color should carry hierarchy and semantic meaning without sacrificing contrast.", file: firstFile, line: 1 });
    if (files.some(({ file }) => file.markers.includes("weak-iconography") || file.markers.includes("inconsistent-iconography"))) add({ id: "design-review-weak-iconography", category: "ICONOGRAPHY", severity: "MEDIUM", blocking: false, title: "Iconography lacks a coherent visual language", summary: "The bounded evidence marks inconsistent or decorative icon usage that weakens recognition and component cohesion.", file: firstFile, line: 1, repairRequired: true });
    if (files.some(({ file }) => file.markers.includes("interaction-rough") || file.markers.includes("interaction-polish"))) add({ id: "design-review-interaction-polish", category: "INTERACTION_POLISH", severity: "MEDIUM", blocking: false, title: "Interaction details need polish", summary: "The implementation evidence marks rough feedback, focus, pressed, or state-transition details that should be resolved within the approved interaction vocabulary.", file: firstFile, line: 1, repairRequired: true });
    if (files.some(({ file }) => file.markers.includes("responsive-overflow") || file.markers.includes("responsive-failure")) || (snapshot.evidencePack.browser?.responsiveFailures.length ?? 0) > 0) add({ id: "design-review-responsive-craft", category: "RESPONSIVE_CRAFT", severity: "HIGH", blocking: true, title: "Responsive craft is not preserved", summary: "Responsive evidence shows overflow or a failed narrow-viewport composition; the approved visual hierarchy must remain usable across captured widths.", file: firstFile, line: 1 });
    if (files.some(({ file }) => file.markers.includes("surface-inconsistency"))) add({ id: "design-review-surface-inconsistency", category: "SURFACES", severity: "MEDIUM", blocking: false, title: "Surface language is inconsistent", summary: "Panels, borders, elevation, and canvas relationships are not expressed as one intentional surface system.", file: firstFile, line: 1, repairRequired: true });
    if (files.some(({ file }) => file.markers.includes("design-generic"))) add({ id: "design-review-generic-appearance", category: "DESIGN_DISTINCTIVENESS", severity: "HIGH", blocking: true, title: "The design appears generic", summary: "The implementation evidence does not communicate a distinctive product-specific visual language.", file: firstFile, line: 1 });
    if (files.some(({ file }) => file.markers.includes("motion-incohesive"))) add({ id: "design-review-motion-incohesive", category: "MOTION", severity: "MEDIUM", blocking: false, title: "Motion is not cohesive with the design", summary: "Motion evidence does not match the approved visual personality or interaction hierarchy.", file: firstFile, line: 1, repairRequired: true });

    const antiAiSlop = checklist.findings.filter((item) => item.source === "FACTORY_ANTI_AI_SLOP" && item.disposition === "OPEN");
    const impeccable = checklist.findings.filter((item) => item.source === "IMPECCABLE" && item.disposition === "OPEN");
    if (antiAiSlop.length || files.some(({ file }) => file.markers.includes("ai-slop") || file.markers.includes("anti-ai-slop"))) add({ id: "design-review-ai-slop", category: "AI_SLOP", severity: antiAiSlop.some((item) => item.severity === "BLOCKING") ? "HIGH" : "MEDIUM", blocking: antiAiSlop.some((item) => item.severity === "BLOCKING"), title: "Anti-AI-slop evidence remains unresolved", summary: "The existing DesignSystemChecklist and AntiAISlopDesignGuard reported open design concerns; Design Review carries that evidence forward without replacing the owning guard.", file: firstFile, line: 1, repairRequired: true });
    const evidenceRefs = [
      `design-system-checklist:${checklist.implementationChecksum}`,
      `anti-ai-slop:${antiAiSlop.length}`,
      `impeccable:${impeccable.length}`,
      ...(snapshot.evidencePack.browser?.screenshots ?? []).slice(0, 10),
    ];
    return result(snapshot, this.agent, findings, this.checksExecuted, evidenceRefs);
  }
}

const motionFinding = (snapshot: ReviewSnapshot, input: { id: string; category: z.infer<typeof MotionReviewCategorySchema>; severity: ReviewFinding["severity"]; blocking: boolean; title: string; summary: string; file: string; line: number; invariant: string }) => finding("animation-review", {
  id: input.id,
  category: input.category,
  severity: input.severity,
  confidence: "HIGH",
  title: input.title,
  safeSummary: input.summary,
  affectedArtifacts: [input.file],
  affectedFiles: [input.file],
  evidence: evidence(snapshot, [artifactRef(input.file, input.line)]),
  blocking: input.blocking,
  repairRequired: input.blocking,
  designRefs: designRefs(snapshot),
  invariant: input.invariant,
});

function motionEvidence(snapshot: ReviewSnapshot) {
  return sourceText(snapshot).filter(({ file, content }) =>
    file.markers.some((marker) => marker.includes("motion") || marker.includes("animation")) ||
    /animation|transition|@keyframes|motion\./i.test(content) ||
    /(?:hover:|:hover\b)[^\n{}]*(?:scale|translate|transform|shadow|glow|rotate|filter)/i.test(content),
  );
}

export class AnimationReviewAgent implements LightweightReviewRunner {
  readonly agent = "animation-review" as const;
  readonly readOnly = true as const;
  readonly sourceWriteAuthority = "NONE" as const;
  readonly canonicalMutationAuthority = "NONE" as const;
  readonly checksExecuted = [
    "motion.justification",
    "motion.frequency",
    "motion.duration",
    "motion.easing",
    "motion.origin",
    "motion.scale",
    "motion.interruptibility",
    "motion.performance",
    "motion.enter-exit",
    "motion.reduced-motion",
    "motion.hover-gating",
    "motion.tokens",
    "review-animations",
  ];

  async review(input: LightweightReviewInput): Promise<AgentReviewResult> {
    const snapshot = input.snapshot;
    const files = motionEvidence(snapshot);
    if (!files.length) return result(snapshot, this.agent, [], this.checksExecuted, ["motion:none"]);
    const findings: ReviewFinding[] = [];
    for (const { file, content } of files) {
      const ref = file.relativePath;
      const add = (item: Omit<Parameters<typeof motionFinding>[1], "file" | "line">, expression: RegExp) => findings.push(motionFinding(snapshot, { ...item, file: ref, line: lineFor(content, expression) }));
      if (file.markers.includes("motion-unjustified")) add({ id: "animation-review-justification-" + ref.replaceAll(/[^a-z0-9]+/gi, "-"), category: "MOTION_JUSTIFICATION", severity: "HIGH", blocking: true, title: "Motion has no approved purpose", summary: "The motion evidence does not establish a user-facing purpose or meaningful spatial, hierarchical, causal, or feedback relationship.", invariant: "motion-purpose" }, /motion|animation/i);
      if (file.markers.includes("motion-missing-exit")) add({ id: "animation-review-enter-exit-" + ref.replaceAll(/[^a-z0-9]+/gi, "-"), category: "MOTION_ENTER_EXIT", severity: "HIGH", blocking: true, title: "Motion has no coherent exit", summary: "The interaction evidence marks an enter-only transition; reversible UI should explain both entering and leaving without trapping or snapping state.", invariant: "enter-exit-coherence" }, /motion|animation/i);
      if (file.markers.includes("motion-incohesive")) add({ id: "animation-review-cohesion-" + ref.replaceAll(/[^a-z0-9]+/gi, "-"), category: "MOTION_COHESION", severity: "MEDIUM", blocking: false, title: "Motion vocabulary is inconsistent", summary: "The motion evidence does not align with the approved design personality or shared motion-token vocabulary.", invariant: "motion-cohesion" }, /motion|animation/i);
      if (/command\s*palette|keyboard shortcut|onKeyDown|keydown/i.test(content) && /animation|transition|@keyframes|motion\./i.test(content)) add({ id: `animation-review-high-frequency-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_FREQUENCY", severity: "HIGH", blocking: true, title: "High-frequency interaction is animated", summary: "Keyboard-driven or command-palette interactions occur too often to carry distracting motion; the correct outcome is no animation.", invariant: "high-frequency-motion" }, /command\s*palette|keyboard shortcut|onKeyDown|keydown/i);
      if (/scale\(\s*0(?:\.0+)?\s*\)/i.test(content)) add({ id: `animation-review-scale-zero-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_SCALE", severity: "HIGH", blocking: true, title: "Motion starts from scale zero", summary: `Use a physical starting scale between ${EMIL_ANIMATION_RULES.minScale} and ${EMIL_ANIMATION_RULES.maxScale} with opacity; scale zero makes the element appear from nowhere.`, invariant: "scale-zero" }, /scale\(\s*0/i);
      if (/scale\(\s*(?:1\.[1-9]|[2-9])/i.test(content)) add({ id: `animation-review-scale-large-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_SCALE", severity: "HIGH", blocking: true, title: "Motion uses an oversized scale", summary: `Use a subtle scale within the approved ${EMIL_ANIMATION_RULES.minScale}–${EMIL_ANIMATION_RULES.maxScale} vocabulary; oversized scaling makes UI motion feel ornamental and unstable.`, invariant: "scale-budget" }, /scale\(\s*(?:1\.[1-9]|[2-9])/i);
      if (/\bease-in(?!-out)\b/i.test(content)) add({ id: `animation-review-ease-in-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_EASING", severity: "HIGH", blocking: true, title: "UI motion uses ease-in", summary: `Entering and exiting UI should use the approved ease-out curve ${EMIL_ANIMATION_RULES.easeOut}; ease-in delays the moment the user is watching.`, invariant: "ease-in-ui" }, /\bease-in(?!-out)\b/i);
      if (/transition\s*:\s*all|transition-all/i.test(content)) add({ id: `animation-review-transition-all-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_PERFORMANCE", severity: "HIGH", blocking: true, title: "Motion uses an unbounded transition", summary: "transition: all can animate unintended properties and move work off the GPU-only path; name transform and opacity explicitly.", invariant: "transition-all" }, /transition\s*:\s*all|transition-all/i);
      if (/(?:animation|transition)[^;{}]*(?:width|height|margin|padding|top|left)\b/i.test(content) || /@keyframes[\s\S]{0,600}(?:width|height|margin|padding|top|left)\s*:/i.test(content)) add({ id: `animation-review-layout-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_PERFORMANCE", severity: "HIGH", blocking: true, title: "Motion animates layout properties", summary: "Use transform and opacity for GPU-friendly motion; animating layout properties risks repeated layout and paint work.", invariant: "layout-property-animation" }, /width|height|margin|padding|top|left/i);
      if (/(?:popover|dropdown|tooltip)/i.test(content) && /scale|transform/i.test(content) && /transform-origin\s*:\s*center/i.test(content)) add({ id: `animation-review-origin-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_ORIGIN", severity: "HIGH", blocking: true, title: "Trigger-anchored motion scales from center", summary: "Popovers, dropdowns, and tooltips should scale from their trigger origin; centered origin is reserved for centered modals.", invariant: "trigger-origin" }, /transform-origin\s*:\s*center/i);
      if (/(?:toast|toggle|drag|expand|collapse)/i.test(content) && /@keyframes|animation\s*:/i.test(content)) add({ id: `animation-review-restart-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_INTERRUPTIBILITY", severity: "HIGH", blocking: true, title: "Rapidly triggered motion restarts from zero", summary: "Rapid or reversible interactions should retarget from their current state with transitions or springs rather than restarting keyframes.", invariant: "interruptibility" }, /@keyframes|animation\s*:/i);
      if (/animation[^;{}]*(?:infinite|iteration-count\s*:\s*infinite)/i.test(content)) add({ id: `animation-review-perpetual-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_JUSTIFICATION", severity: "HIGH", blocking: true, title: "Motion runs perpetually", summary: "Perpetual motion should be reserved for an explicit progress or status indication; decorative looping distracts from comprehension and task completion.", invariant: "perpetual-motion" }, /infinite|iteration-count/i);
      if (/transition|animation|@keyframes|:hover\b|hover:/i.test(content) && !/prefers-reduced-motion|motion-reduce|useReducedMotion|reduced-motion/i.test(content)) add({ id: `animation-review-reduced-motion-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_REDUCED_MOTION", severity: "HIGH", blocking: true, title: "Motion has no reduced-motion behavior", summary: "Reduced motion must ship with the interaction: remove movement while preserving useful opacity or state feedback.", invariant: "reduced-motion" }, /transition|animation|@keyframes|:hover\b|hover:/i);
      if (/(?:hover:|:hover\b)[^\n{}]*(?:scale|translate|transform|shadow|glow|animation)/i.test(content) && !/hover\s*:\s*hover|@media\s*\([^)]*hover\s*:\s*hover/i.test(content)) add({ id: `animation-review-hover-gating-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MOTION_HOVER_GATING", severity: "HIGH", blocking: true, title: "Hover motion is not pointer-gated", summary: "Hover-specific motion must be gated behind hover-capable fine pointers so touch taps do not trigger false hover behavior.", invariant: "hover-pointer-gating" }, /hover:|:hover\b/i);
      const duration = content.match(/(?:duration\s*[:=]\s*|transition\s*:[^;{}]*?\s)(\d+)\s*ms/i);
      if (duration && Number(duration[1]) > EMIL_ANIMATION_RULES.maxUiDurationMs && !/(?:marketing|explanatory|modal|drawer)/i.test(content)) add({ id: "animation-review-duration-" + ref.replaceAll(/[^a-z0-9]+/gi, "-"), category: "MOTION_DURATION", severity: "HIGH", blocking: true, title: "UI motion is sluggish", summary: "UI motion should stay at or below " + EMIL_ANIMATION_RULES.maxUiDurationMs + "ms unless the component has an explicit longer-motion rationale.", invariant: "ui-duration-budget" }, /(?:duration\s*[:=]\s*|transition\s*:[^;{}]*\s)\d+\s*ms/i);
    }
    return result(snapshot, this.agent, findings, this.checksExecuted, ["motion:meaningful", ...(snapshot.motionTokenChecksum ? [snapshot.motionTokenChecksum] : [])]);
  }
}

const advisoryBinding = (snapshot: ReviewSnapshot, skillId: string, skillChecksum: string) => ({ snapshotId: snapshot.snapshotId, implementationChecksum: snapshot.implementationChecksum, ...(snapshot.designChecksum ? { designChecksum: snapshot.designChecksum } : {}), ...(snapshot.designSystemVersion ? { designSystemVersion: snapshot.designSystemVersion } : {}), ...(snapshot.motionTokenChecksum ? { motionTokenChecksum: snapshot.motionTokenChecksum } : {}), skillId, skillChecksum, sourceWriteAuthority: "NONE" as const, canonicalMutationAuthority: "NONE" as const, advisoryOnly: true as const });

export class MotionImprovementAdvisor {
  readonly readOnly = true as const;
  readonly sourceWriteAuthority = "NONE" as const;
  readonly canonicalMutationAuthority = "NONE" as const;
  async audit(snapshot: ReviewSnapshot, skillChecksum = approvedSkillChecksum(EMIL_ANIMATION_IMPROVEMENT_SKILL_ID)) {
    const review = await new AnimationReviewAgent().review({ snapshot, agent: "animation-review" });
    const binding = advisoryBinding(snapshot, EMIL_ANIMATION_IMPROVEMENT_SKILL_ID, skillChecksum);
    const plans: MotionImprovementPlan[] = review.findings.filter((item) => item.blocking && item.affectedFiles?.length).slice(0, 7).map((item, index) => MotionImprovementResultSchema.shape.plans.element.parse({
      planId: `motion-plan-${index + 1}-${item.id}`,
      severity: item.severity,
      category: MotionReviewCategorySchema.parse(item.category),
      affectedFiles: item.affectedFiles ?? [],
      problem: item.safeSummary,
      target: `Resolve ${item.category.toLowerCase()} using the existing motion-token contract without changing approved Design authority.`,
      steps: [`Inspect ${item.affectedFiles?.join(", ") ?? "the affected source"} at the reviewed snapshot.`, `Apply the smallest bounded motion correction for ${item.category.toLowerCase()}.`, "Re-run the independent AnimationReviewAgent and reduced-motion checks."],
      verification: ["Typecheck and lint the affected project.", "Trigger the interaction repeatedly and confirm it retargets instead of restarting.", "Toggle prefers-reduced-motion and confirm movement is reduced while state feedback remains."],
      binding,
    }));
    return MotionImprovementResultSchema.parse({ binding, plans, verdict: plans.length ? "IMPROVEMENTS_RECOMMENDED" : "NO_IMPROVEMENTS_RECOMMENDED" });
  }
}

export class AnimationOpportunityFinder {
  readonly readOnly = true as const;
  readonly sourceWriteAuthority = "NONE" as const;
  readonly canonicalMutationAuthority = "NONE" as const;
  async find(snapshot: ReviewSnapshot, skillChecksum = approvedSkillChecksum(EMIL_ANIMATION_OPPORTUNITY_SKILL_ID)) {
    const binding = advisoryBinding(snapshot, EMIL_ANIMATION_OPPORTUNITY_SKILL_ID, skillChecksum);
    const suggestions: AnimationOpportunity[] = [];
    const rejectedCandidates: AnimationOpportunity[] = [];
    for (const { file, content } of sourceText(snapshot)) {
      const ref = file.relativePath;
      const stateChange = /(?:popover|dropdown|toast|dialog|drawer|data-state\s*=|aria-expanded)/i.test(content);
      const highFrequency = /command\s*palette|keyboard shortcut|onKeyDown|keydown|core navigation/i.test(content);
      if (stateChange && highFrequency && rejectedCandidates.length < 7) rejectedCandidates.push({ opportunityId: `motion-opportunity-rejected-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, affectedFiles: [ref], frequency: "100_PLUS_PER_DAY", purpose: "Preserve immediate keyboard response.", suggestedMotion: "No animation.", decision: "REJECT", rejectionReason: "The interaction is high-frequency or keyboard-initiated.", evidence: evidence(snapshot, [ref]) });
      else if (stateChange && suggestions.length < 7) suggestions.push({ opportunityId: `motion-opportunity-${ref.replaceAll(/[^a-z0-9]+/gi, "-")}`, affectedFiles: [ref], frequency: "OCCASIONAL", purpose: "Explain the spatial relationship of the state change.", suggestedMotion: `Use transform and opacity with ${EMIL_ANIMATION_RULES.easeOut} and a duration within the existing motion token budget; preserve reduced motion and trigger origin.`, decision: "RECOMMEND", evidence: evidence(snapshot, [ref]) });
    }
    const verdict = suggestions.length ? "OPPORTUNITIES_RECOMMENDED" : "NO_ADDITIONAL_MOTION_RECOMMENDED";
    return AnimationOpportunityResultSchema.parse({ binding, suggestions, rejectedCandidates, verdict });
  }
}

export const emilMotionReviewCapabilities = Object.freeze({
  designReview: DesignReviewAgent,
  animationReview: AnimationReviewAgent,
  improvementAudit: MotionImprovementAdvisor,
  opportunityFinder: AnimationOpportunityFinder,
  skillIds: [EMIL_DESIGN_ENGINEERING_SKILL_ID, EMIL_ANIMATION_REVIEW_SKILL_ID, EMIL_ANIMATION_IMPROVEMENT_SKILL_ID, EMIL_ANIMATION_OPPORTUNITY_SKILL_ID],
});
