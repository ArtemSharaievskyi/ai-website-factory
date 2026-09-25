import { createHash } from "node:crypto";
import { ImpeccableDetectorResultSchema, type ImpeccableDetectorResult, type ImpeccableFinding } from "./contracts";

const sourceChecksum = (files: ReadonlyArray<{ path: string; content: string }>) => createHash("sha256").update(JSON.stringify(files.map((file) => ({ path: file.path, content: file.content })))).digest("hex");

const perpetualMotionPattern = /(?:animation|transition)[^;]*(?:infinite|marquee|parallax)/gi;
const negatedMotionPattern = /\b(?:do\s+not|does\s+not|should\s+not|must\s+not|never|avoid|without|no|prohibit(?:ed)?|disable(?:d)?|remove)\b[^.;]{0,96}\b(?:infinite|marquee|parallax)\b/i;
const containsUnqualifiedPerpetualMotion = (content: string) => {
  for (const match of content.matchAll(perpetualMotionPattern)) {
    const end = (match.index ?? 0) + match[0].length;
    const context = content.slice(Math.max(0, (match.index ?? 0) - 96), end);
    if (!negatedMotionPattern.test(context)) return true;
  }
  return false;
};

export function detectImpeccableAntiPatterns(files: ReadonlyArray<{ path: string; content: string }>): ImpeccableDetectorResult {
  const findings: ImpeccableFinding[] = [];
  for (const file of files) {
    if (/cream|beige|warm-neutral/i.test(file.content)) findings.push({ ruleId: "cream-palette", severity: "warning", path: file.path, summary: "Warm-neutral AI-default palette requires explicit product rationale." });
    if (/<h1[^>]*className[^>]*text-(?:7|8|9)xl/i.test(file.content) || /font-size:\s*(?:6|7|8)rem/i.test(file.content)) findings.push({ ruleId: "oversized-h1", severity: "warning", path: file.path, summary: "Hero heading is oversized for a bounded interface." });
    if (/linear-gradient|radial-gradient/i.test(file.content) && /purple|violet|fuchsia/i.test(file.content)) findings.push({ ruleId: "generic-purple-gradient", severity: "warning", path: file.path, summary: "Generic purple gradient requires an approved visual rationale." });
    if (/animation\s*:[^;]*(?:margin|padding|width|height)/i.test(file.content)) findings.push({ ruleId: "layout-property-animation", severity: "error", path: file.path, summary: "Animate transform or opacity instead of layout properties." });
    if (containsUnqualifiedPerpetualMotion(file.content)) findings.push({ ruleId: "decorative-perpetual-motion", severity: "error", path: file.path, summary: "Perpetual decorative motion is not allowed by the design contract." });
  }
  return ImpeccableDetectorResultSchema.parse({ toolId: "impeccable", status: findings.some((finding) => finding.severity === "error") ? "FAIL" : "PASS", findings, sourceChecksum: sourceChecksum(files), detectorVersion: "impeccable-host-detector-v1" });
}
