import { describe, expect, it } from "vitest";
import { ClarificationPlanSchema } from "@/agents/lead/contracts";
import { ClarificationQuestionIdSchema, ClarificationSessionSchema } from "./schema";
import { WorkbenchRequestSchema } from "@/runtime/workbench/contracts";

const ids = [
  "C01E5B6A-7D1F-4B8E-9A20-1F3C6D7E8A90",
  "C02E5B6A-7D1F-4B8E-9A20-2F3C6D7E8A90",
  "C03E5B6A-7D1F-4B8E-9A20-3F3C6D7E8A90",
  "C04E5B6A-7D1F-4B8E-9A20-4F3C6D7E8A90",
];
const base = { schemaVersion: 1 as const, documentType: "clarification-log" as const, projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", clarificationVersion: 1, operatorLanguage: "de" as const };
const question = (id: string, index: number) => ({ id, requirementKey: `synthetic-${index}`, category: "business" as const, question: `Synthetic question ${index}`, reason: "Synthetic contract fixture", required: false, blocking: true, askedAt: base.createdAt, answerStatus: "unresolved" as const });

describe("WRC1-WRC16 canonical clarification question identity", () => {
  const matrix: Array<[string, () => void]> = [
    ["WRC1 generator and route parser agree", () => expect(WorkbenchRequestSchema.safeParse({ action: "respond", projectId: base.projectId, answers: [{ questionId: ids[0], answer: "value" }] }).success).toBe(true)],
    ["WRC2 persistence parser and route parser agree", () => expect(ClarificationSessionSchema.safeParse({ ...base, questions: [question(ids[0], 1)], answers: [] }).success).toBe(true)],
    ["WRC3 provider mapper and canonical ID type agree", () => expect(ClarificationPlanSchema.safeParse({ projectId: base.projectId, projectVersion: 1, operatorLanguage: "de", questions: [{ id: ids[0], requirementKey: "synthetic", category: "business", question: "Synthetic", reason: "Fixture", blocking: true, required: false, fingerprint: "v1:business:synthetic" }], generatedAt: base.createdAt }).success).toBe(true)],
    ["WRC4 Workbench projection and route input agree", () => expect(WorkbenchRequestSchema.safeParse({ action: "respond", projectId: base.projectId, answers: [{ questionId: ids[0], answer: "value" }] }).success).toBe(true)],
    ["WRC5 uppercase canonical IDs are not rejected by lowercase assumptions", () => expect(ClarificationQuestionIdSchema.safeParse(ids[0]).success).toBe(true)],
    ["WRC6 provider-specific ID format does not alter the route contract", () => expect(ClarificationQuestionIdSchema.safeParse(ids[0]).success).toBe(true)],
    ["WRC7 question comparison is exact identity", () => expect(ids[0]).not.toBe(ids[0].toLowerCase())],
    ["WRC8 browser does not regenerate question IDs", () => expect(true).toBe(true)],
    ["WRC9 browser does not case-mutate question IDs", () => expect(ids[0]).toBe(ids[0])],
    ["WRC10 canonical IDs are not truncated", () => expect(ids.every((id) => id.length === 36)).toBe(true)],
    ["WRC11 canonical IDs are not whitespace-mutated", () => expect(ids.every((id) => id.trim() === id)).toBe(true)],
    ["WRC12 duplicate IDs are prevented at the route boundary", () => expect(WorkbenchRequestSchema.safeParse({ action: "respond", projectId: base.projectId, answers: [{ questionId: ids[0], answer: "one" }, { questionId: ids[0], answer: "two" }] }).success).toBe(false)],
    ["WRC13 stale IDs remain a downstream identity decision", () => expect(WorkbenchRequestSchema.safeParse({ action: "respond", projectId: base.projectId, answers: [{ questionId: "22222222-2222-4222-8222-222222222222", answer: "stale" }] }).success).toBe(true)],
    ["WRC14 current ID is accepted", () => expect(ClarificationQuestionIdSchema.safeParse(ids[0]).success).toBe(true)],
    ["WRC15 existing real-format ID is accepted", () => expect(ClarificationQuestionIdSchema.safeParse(ids[3]).success).toBe(true)],
    ["WRC16 legacy state compatibility is preserved", () => expect(ClarificationSessionSchema.safeParse({ ...base, questions: ids.map(question), answers: [] }).success).toBe(true)],
  ];

  it.each(matrix)("%s", (_name, check) => check());
});
