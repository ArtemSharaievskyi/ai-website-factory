import { createHash, randomUUID } from "node:crypto";
import type { DocumentationExcerpt } from "@/integrations/context7/contracts";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";
import type { ContextCandidate } from "./assembler";
import type { ContextItemKind } from "./contracts";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const normalize = (value: string) => value.replace(/\r\n?/g, "\n");

export type SkillSlice = { skillId: string; approvedChecksum: string; sliceId: string; selectedSections: string[]; sourceRange: string; content: string; checksum: string; fullBytes: number; selectedBytes: number; semanticRewrite: false };
const sectionize = (markdown: string) => {
  const lines = normalize(markdown).split("\n");
  const sections: Array<{ heading: string; start: number; end: number; content: string }> = [];
  let current: { heading: string; start: number } | undefined;
  for (let index = 0; index < lines.length; index++) {
    const heading = lines[index]?.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (heading) {
      if (current) sections.push({ heading: current.heading, start: current.start, end: index, content: lines.slice(current.start, index).join("\n").trim() });
      current = { heading: heading[2]!, start: index };
    }
  }
  if (current) sections.push({ heading: current.heading, start: current.start, end: lines.length, content: lines.slice(current.start).join("\n").trim() });
  return sections.length ? sections : [{ heading: "SKILL.md", start: 0, end: lines.length, content: normalize(markdown).trim() }];
};

export function sliceApprovedSkill(input: { skill: ApprovedProceduralSkillContext; taskType?: string; agentRole?: string; requestedCoverage?: readonly string[]; maxBytes?: number }): SkillSlice {
  const markdown = normalize(input.skill.skillMarkdown);
  const fullBytes = bytes(markdown);
  const maxBytes = input.maxBytes ?? 24_000;
  const requested = [...(input.requestedCoverage ?? []), input.taskType ?? "", input.agentRole ?? ""].map((value) => value.toLowerCase()).filter(Boolean);
  const sections = sectionize(markdown);
  const relevant = sections.filter((section) => requested.some((term) => section.heading.toLowerCase().includes(term) || section.content.toLowerCase().includes(term)));
  const selected = (relevant.length ? relevant : sections.slice(0, 1));
  let content = selected.map((section) => markdown.split("\n").slice(section.start, section.end).join("\n").trim()).filter(Boolean).join("\n\n");
  if (fullBytes <= maxBytes) content = markdown;
  if (bytes(content) > maxBytes) {
    const lines = content.split("\n");
    while (lines.length > 1 && bytes(lines.join("\n")) > maxBytes) lines.pop();
    content = lines.join("\n").trim();
  }
  const selectedSections = selected.map((section) => section.heading);
  const sourceRange = selected.length === 1 ? `${selected[0]!.start + 1}-${selected[0]!.end}` : selectedSections.join(",");
  return { skillId: input.skill.skillId, approvedChecksum: input.skill.approvedChecksum, sliceId: digest(`${input.skill.skillId}:${input.skill.approvedChecksum}:${sourceRange}:${digest(content)}`).slice(0, 32), selectedSections, sourceRange, content, checksum: digest(content), fullBytes, selectedBytes: bytes(content), semanticRewrite: false };
}

export function skillContextCandidate(input: { skill: ApprovedProceduralSkillContext; taskType?: string; agentRole?: string; requestedCoverage?: readonly string[]; required?: boolean; maxBytes?: number }): { slice: SkillSlice; candidate: ContextCandidate } {
  const slice = sliceApprovedSkill(input);
  return { slice, candidate: { kind: "SKILL_SLICE", sourceRef: `skill:${slice.skillId}:${slice.sliceId}`, sourceChecksum: slice.approvedChecksum, selectionReason: `Exact approved skill sections selected for ${input.taskType ?? input.agentRole ?? "the task"}.`, priority: input.required ? "HIGH" : "MEDIUM", required: input.required, content: slice.content } };
}

export type DocumentationSlice = { sourceIdentity: string; library: string; version?: string; section: string; sourceChecksum: string; content: string; checksum: string; candidateBytes: number; selectedBytes: number };
export function sliceDocumentationExcerpt(excerpt: DocumentationExcerpt, queryTerms: readonly string[], maxBytes = 8_000): DocumentationSlice {
  const content = normalize(excerpt.content);
  const paragraphs = content.split(/\n\s*\n/).filter(Boolean);
  const terms = queryTerms.map((term) => term.toLowerCase());
  const relevant = paragraphs.filter((paragraph) => terms.some((term) => paragraph.toLowerCase().includes(term)));
  const selected = relevant.length ? relevant : paragraphs.slice(0, 1);
  let sliced = selected.join("\n\n");
  if (bytes(sliced) > maxBytes) sliced = sliced.split("\n").reduce((acc, line) => bytes(`${acc}${acc ? "\n" : ""}${line}`) <= maxBytes ? `${acc}${acc ? "\n" : ""}${line}` : acc, "");
  return { sourceIdentity: excerpt.sourceReference, library: excerpt.library, ...(excerpt.documentedVersion ?? excerpt.requestedVersion ? { version: excerpt.documentedVersion ?? excerpt.requestedVersion } : {}), section: excerpt.title, sourceChecksum: excerpt.checksum, content: sliced, checksum: digest(sliced), candidateBytes: bytes(content), selectedBytes: bytes(sliced) };
}
export function documentationContextCandidate(excerpt: DocumentationExcerpt, queryTerms: readonly string[], maxBytes = 8_000): { slice: DocumentationSlice; candidate: ContextCandidate } {
  const slice = sliceDocumentationExcerpt(excerpt, queryTerms, maxBytes);
  return { slice, candidate: { kind: "DOCUMENTATION_SLICE", sourceRef: `context7:${slice.library}:${slice.section}`, sourceChecksum: slice.sourceChecksum, selectionReason: `Context7 excerpt narrowed to relevant paragraphs for ${queryTerms.join(", ") || "the task"}.`, priority: "MEDIUM", content: slice.content } };
}

export type NormalizedDiagnostic = { diagnosticId: string; tool: "typescript" | "eslint" | "vitest" | "next-build" | "runtime"; severity: "error" | "warning" | "info"; code?: string; message: string; file?: string; line?: number; column?: number; taskRelevant: boolean; sourceSnippetRef?: string; relatedDiagnosticRefs: string[] };
export type DiagnosticSlice = { tool: NormalizedDiagnostic["tool"]; rawBytes: number; slicedBytes: number; diagnostics: NormalizedDiagnostic[]; causalDiagnosticsPreserved: boolean; content: string };
export class DiagnosticSlicer {
  constructor(private readonly maxDiagnostics = 12) {}
  slice(input: Omit<Parameters<typeof sliceDiagnostics>[0], "maxDiagnostics">) {
    return sliceDiagnostics({ ...input, maxDiagnostics: this.maxDiagnostics });
  }
}
const addDiagnostic = (list: NormalizedDiagnostic[], value: Omit<NormalizedDiagnostic, "diagnosticId" | "relatedDiagnosticRefs">) => list.push({ ...value, diagnosticId: digest(JSON.stringify(value)).slice(0, 32), relatedDiagnosticRefs: [] });
const taskRelevant = (file: string | undefined, taskFiles: readonly string[]) => !file || taskFiles.some((candidate) => file.replaceAll("\\", "/").includes(candidate.replaceAll("\\", "/")));

export function sliceDiagnostics(input: { tool: DiagnosticSlice["tool"]; stdout?: string; stderr?: string; taskFiles?: readonly string[]; maxDiagnostics?: number }): DiagnosticSlice {
  const raw = `${input.stdout ?? ""}\n${input.stderr ?? ""}`.trim();
  const rawBytes = bytes(raw);
  const taskFiles = input.taskFiles ?? [];
  const diagnostics: NormalizedDiagnostic[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    if (input.tool === "typescript" || input.tool === "next-build") {
      const match = line.match(/(?:^|\s)([^\s()]+\.(?:tsx?|jsx?))\((\d+),(\d+)\):\s*(error|warning)\s*([A-Z]+\d+)?\s*:??\s*(.*)$/i);
      if (match) addDiagnostic(diagnostics, { tool: input.tool, severity: match[4]!.toLowerCase() as "error" | "warning", ...(match[5] ? { code: match[5] } : {}), message: match[6]!.trim().slice(0, 500), file: match[1], line: Number(match[2]), column: Number(match[3]), taskRelevant: taskRelevant(match[1], taskFiles), ...(taskRelevant(match[1], taskFiles) ? { sourceSnippetRef: `file:${match[1]}:${match[2]}-${match[2]}` } : {}) });
      else if (input.tool === "next-build" && /(?:error|failed|invalid)/i.test(line)) addDiagnostic(diagnostics, { tool: "next-build", severity: "error", message: line.trim().slice(0, 500), taskRelevant: true });
    } else if (input.tool === "eslint") {
      const match = line.match(/^([^\s()]+):(\d+):(\d+)\s+(.+?)\s{2,}(.+)$/);
      if (match) addDiagnostic(diagnostics, { tool: "eslint", severity: "error", code: match[4]!.trim(), message: match[5]!.trim().slice(0, 500), file: match[1], line: Number(match[2]), column: Number(match[3]), taskRelevant: taskRelevant(match[1], taskFiles), ...(taskRelevant(match[1], taskFiles) ? { sourceSnippetRef: `file:${match[1]}:${match[2]}-${match[2]}` } : {}) });
    } else if (input.tool === "vitest") {
      const match = line.match(/^\s*[×x]\s+(.+)$/) || line.match(/^\s*FAIL\s+(.+)$/);
      if (match && !line.includes("node_modules")) addDiagnostic(diagnostics, { tool: "vitest", severity: "error", message: match[1]!.trim().slice(0, 500), taskRelevant: taskRelevant(match[1], taskFiles) });
    } else if (input.tool === "runtime" && /error|failed|exception/i.test(line) && !line.includes("node_modules")) addDiagnostic(diagnostics, { tool: "runtime", severity: "error", message: line.trim().slice(0, 500), taskRelevant: true });
  }
  const limit = input.maxDiagnostics ?? 12;
  const relevant = diagnostics.filter((diagnostic) => diagnostic.taskRelevant);
  const chosen = [...relevant, ...diagnostics.filter((diagnostic) => !diagnostic.taskRelevant)].slice(0, limit);
  const content = chosen.map((diagnostic) => JSON.stringify(diagnostic)).join("\n");
  return { tool: input.tool, rawBytes, slicedBytes: bytes(content), diagnostics: chosen, causalDiagnosticsPreserved: diagnostics.length === 0 || chosen.some((diagnostic) => diagnostic.severity === "error"), content };
}

export function diagnosticContextCandidate(slice: DiagnosticSlice, required = true): ContextCandidate {
  return { kind: "DIAGNOSTIC", sourceRef: `diagnostic:${slice.tool}:${digest(slice.content).slice(0, 16)}`, sourceChecksum: digest(slice.content), selectionReason: "First causal task-relevant diagnostics with safe structured fields; raw execution logs remain host-side only.", priority: "HIGH", required, content: slice.content };
}

export function designCandidateContextCandidates<T extends { id?: string; source?: string; sourceUrl?: string; description?: string; dependencies?: readonly string[]; paid?: boolean; compatible?: boolean }>(candidates: readonly T[], query: { category?: string; framework?: string; maxCandidates: number }): { selected: T[]; excludedCount: number; candidate: ContextCandidate } {
  const seen = new Set<string>();
  const filtered = candidates.filter((candidate) => !candidate.paid && candidate.compatible !== false).filter((candidate) => { const key = `${candidate.source ?? "unknown"}:${candidate.id ?? candidate.sourceUrl ?? "unknown"}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, query.maxCandidates);
  const content = filtered.map((candidate) => JSON.stringify({ id: candidate.id, source: candidate.source, sourceUrl: candidate.sourceUrl, description: candidate.description, dependencies: candidate.dependencies })).join("\n");
  return { selected: filtered, excludedCount: candidates.length - filtered.length, candidate: { kind: "EVIDENCE_SLICE", sourceRef: `design-candidates:${query.category ?? "all"}:${query.framework ?? "unknown"}`, sourceChecksum: digest(content), selectionReason: "Deterministically filtered paid, incompatible, duplicate, and over-limit design candidates before any semantic call.", priority: "MEDIUM", content } };
}

export function createContextExpansionRequest(input: { reason: string; requiredSourceRefs?: string[]; requiredSymbols?: string[]; requiredDiagnosticRefs?: string[]; requestedContextKind: ContextItemKind; taskScope: string[]; currentExpansionCount?: number }) {
  return { requestId: randomUUID(), reason: input.reason, requiredSourceRefs: (input.requiredSourceRefs ?? []).slice(0, 8), requiredSymbols: (input.requiredSymbols ?? []).slice(0, 8), requiredDiagnosticRefs: (input.requiredDiagnosticRefs ?? []).slice(0, 8), requestedContextKind: input.requestedContextKind, taskScope: input.taskScope, maxExpansionCount: 1, currentExpansionCount: input.currentExpansionCount ?? 0 };
}
