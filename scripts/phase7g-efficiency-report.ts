import { createHash } from "node:crypto";
import { astPatchEfficiencyMetric, designCandidateContextCandidates, sliceApprovedSkill, sliceDiagnostics, sourceContextCandidates } from "../src/runtime/context";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const percent = (before: number, after: number) => Number(((1 - after / Math.max(1, before)) * 100).toFixed(2));
const narrowTsx = ["import type { Props } from './props';", "export function Target(props: Props) {", "  return <main>{props.title}</main>;", "}", ...Array.from({ length: 700 }, (_, index) => `export const unrelated${index} = ${JSON.stringify(`unrelated-${index}-fixture`)};`)].join("\n");
const skill = { skillId: "phase7g-fixture-skill", approvedChecksum: "a".repeat(64), coverageKeys: ["motion"], skillMarkdown: "# Fixture Skill\n\n## Motion\nUse opacity and transform for restrained motion.\n\n## Unrelated\n" + "unrelated procedure ".repeat(700), references: [] };
const diagnosticRaw = ["src/app/page.tsx(12,4): error TS2322: Type 'x' is not assignable", ...Array.from({ length: 80 }, (_, index) => `verbose build framework noise ${index}`)].join("\n");
const designCandidates = Array.from({ length: 36 }, (_, index) => ({ id: `candidate-${index % 12}`, source: index % 5 === 0 ? "paid" : "free", description: `Candidate ${index}`, paid: index % 5 === 0, compatible: index % 7 !== 0 }));
const patch = astPatchEfficiencyMetric({ relativePath: "src/app/page.tsx", patchKind: "REPLACE_NODE_BODY", sourceFile: narrowTsx, patchPayload: { body: "{ return <main />; }" }, result: "APPLIED" });
const sourceItems = sourceContextCandidates({ file: { relativePath: "src/app/page.tsx", content: narrowTsx, sha256: digest(narrowTsx), priority: "HIGH", selectionReason: "fixture target", dependencyDepth: 0 }, symbols: ["Target"] });
const skillSlice = sliceApprovedSkill({ skill, requestedCoverage: ["motion"], maxBytes: 2_000 });
const diagnostic = sliceDiagnostics({ tool: "typescript", stdout: diagnosticRaw, taskFiles: ["src/app/page.tsx"], maxDiagnostics: 4 });
const design = designCandidateContextCandidates(designCandidates, { category: "page", framework: "next", maxCandidates: 8 });
const result = {
  phaseId: "7G",
  reportType: "deterministic-efficiency-fixtures",
  providerUsageLiveVerified: false,
  providerUsageReason: "No provider credential was used; actual usage parsing is covered by injected current-SDK-shaped tests.",
  fixtures: {
    narrowTsx: { naiveContextBytes: Buffer.byteLength(narrowTsx), optimizedContextBytes: Buffer.byteLength(sourceItems.map((item) => item.content).join("\n\n")), contextReductionPercent: percent(Buffer.byteLength(narrowTsx), Buffer.byteLength(sourceItems.map((item) => item.content).join("\n\n"))), semanticSufficiency: sourceItems.some((item) => item.content.includes("Target")) && sourceItems.some((item) => item.content.includes("Props")) },
    diagnostic: { rawDiagnosticBytes: diagnostic.rawBytes, slicedDiagnosticBytes: diagnostic.slicedBytes, diagnosticReductionPercent: percent(diagnostic.rawBytes, diagnostic.slicedBytes), causalDiagnosticsPreserved: diagnostic.causalDiagnosticsPreserved },
    skills: { candidateSkillBytes: skillSlice.fullBytes, selectedSkillBytes: skillSlice.selectedBytes, skillReductionPercent: percent(skillSlice.fullBytes, skillSlice.selectedBytes), approvedChecksum: skillSlice.approvedChecksum },
    designCandidates: { before: designCandidates.length, after: design.selected.length, excluded: design.excludedCount },
    astPatch: patch,
  },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
