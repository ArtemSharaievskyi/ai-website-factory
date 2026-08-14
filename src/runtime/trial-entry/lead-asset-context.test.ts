import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ClarificationPlanSchema, type ClarificationPlan } from "@/agents/lead/contracts";
import { LeadAgentService } from "@/agents/lead/service";
import { type LeadAnalysisProvider } from "@/agents/lead/ports";
import { analyzePromptDeterministically, assembleRequirements } from "@/agents/lead/deterministic";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { ProjectAssetSchema } from "@/domain/assets/project";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { ProjectAssetRepository } from "@/persistence/database/repositories";
import { ProjectAssetService } from "@/runtime/assets/service";
import { TrialEntryService } from "./service";
import { WorkbenchApplication } from "@/runtime/workbench/application";
import { WorkbenchRequestSchema } from "@/runtime/workbench/contracts";

const png = (marker: number) => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]);
  return bytes;
};

const questionIds = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
];

const fourQuestionPlan = (projectId: string, projectVersion: number, operatorLanguage: string): ClarificationPlan => ClarificationPlanSchema.parse({
  projectId,
  projectVersion,
  operatorLanguage,
  questions: questionIds.map((id, index) => ({
    id,
    requirementKey: `synthetic-${index + 1}`,
    category: (["business", "audience", "pages", "constraints"] as const)[index],
    question: `Synthetic clarification ${index + 1}`,
    reason: "Synthetic authority fixture",
    blocking: true,
    required: true,
    fingerprint: `synthetic-v1:${index + 1}`,
  })),
  generatedAt: "2026-01-01T00:00:00.000Z",
});

describe("ASA1-ASA28 / ALE1-ALE16 server-owned Lead asset context", () => {
  it("derives three current READY assets for Lead during a minimal respond request", async () => {
    const database = new InMemoryPersistenceDatabase();
    const root = await mkdtemp(path.join(os.tmpdir(), "factory-lead-assets-"));
    const observedAssets: Array<Awaited<ReturnType<ProjectAssetService["listCurrentReadyReferences"]>>> = [];
    const observedAnswerCounts: number[] = [];
    const provider: LeadAnalysisProvider = {
      analyzePrompt: async (input) => analyzePromptDeterministically(input),
      proposeClarifications: async (input) => {
        observedAssets.push(input.availableAssets);
        return fourQuestionPlan(input.analysis.projectId, input.analysis.projectVersion, input.operatorLanguage);
      },
      assembleBriefDraft: async (input) => {
        observedAnswerCounts.push(input.session.answers.length);
        return assembleRequirements(input);
      },
    };
    const assets = new ProjectAssetService({ database, root });
    const entry = new TrialEntryService({
      database,
      assets,
      createLeadAgent: () => new LeadAgentService({ database, memory: new FakeLeadMemoryPort(), provider }),
    });
    const application = new WorkbenchApplication({ database, entry, assets });

    try {
      const created = await entry.createProject({ requestText: "Erstelle eine synthetische deutsche Broschüren-Website.\nImages: user-supplied", operatorLanguage: "de", languageHint: "de" });
      expect(created.workflowState).toBe("CLARIFYING");
      expect(created.lead.clarificationQuestions).toHaveLength(4);

      const logo = await assets.upload({ projectId: created.project.projectId, category: "LOGO", filename: "logo.png", mediaType: "image/png", bytes: png(1) });
      const front = await assets.upload({ projectId: created.project.projectId, category: "IMAGE", filename: "Flyer_front.png", mediaType: "image/png", bytes: png(2) });
      const back = await assets.upload({ projectId: created.project.projectId, category: "IMAGE", filename: "Flyer_back.png", mediaType: "image/png", bytes: png(3) });
      const otherProject = await entry.createProject({ requestText: "Other synthetic project.", operatorLanguage: "de", languageHint: "de" });
      const otherAsset = await assets.upload({ projectId: otherProject.project.projectId, category: "LOGO", filename: "other.png", mediaType: "image/png", bytes: png(4) });

      const assetRepository = new ProjectAssetRepository(database);
      const base = logo.asset;
      for (const [status, currentness, rejectionReason] of [
        ["UPLOADING", "CURRENT", undefined],
        ["REJECTED", "CURRENT", "synthetic rejection"],
        ["REMOVED", "SUPERSEDED", undefined],
        ["SUPERSEDED", "SUPERSEDED", undefined],
      ] as const) {
        await assetRepository.create(ProjectAssetSchema.parse({
          ...base,
          assetId: randomUUID(),
          safeDisplayName: `${status.toLowerCase()}.png`,
          storageIdentity: `projects/${created.project.projectId}/assets/${randomUUID()}/png`,
          status,
          currentness,
          ...(rejectionReason ? { rejectionReason } : {}),
        }));
      }

      const snapshotBeforeRespond = JSON.stringify([...database.assets.entries()]);
      const request = WorkbenchRequestSchema.parse({
        action: "respond",
        projectId: created.project.projectId,
        answers: created.lead.clarificationQuestions.map((question, index) => ({
          questionId: question.id,
          answer: [`Zweck und Zielgruppe sind klar beschrieben.\n\nWeitere Details bleiben synthetisch.`, `Die synthetische Zielgruppe erhält verständliche Inhalte.\n\nKeine realen Kontaktdaten.`, `Die Seitenstruktur umfasst Startseite und Kontakt.\n\nDie Navigation bleibt schlicht.`, `Erfolgreich ist die erste Version, wenn die Inhalte verständlich sind.\n\nDiese success-Kriterien gelten für die Abnahme.`][index],
        })),
      });
      expect(request).not.toHaveProperty("availableAssets");
      const next = await application.handle(request);
      const finalStatus = await entry.status(created.project.projectId);
      const context = observedAssets.at(-1) ?? [];

      expect(next.project?.projectId).toBe(created.project.projectId);
      expect(finalStatus.workflowState).toBe("AWAITING_BRIEF_APPROVAL");
      expect(observedAnswerCounts.at(-1)).toBe(4);
      expect(context).toHaveLength(3);
      expect(context.map((asset) => asset.category).sort()).toEqual(["IMAGE", "IMAGE", "LOGO"]);
      expect(context.map((asset) => asset.assetId)).toEqual(expect.arrayContaining([logo.asset.assetId, front.asset.assetId, back.asset.assetId]));
      expect(context.map((asset) => asset.assetId)).not.toContain(otherAsset.asset.assetId);
      expect(context.every((asset) => asset.projectId === created.project.projectId && asset.status === "READY" && asset.currentness === "CURRENT")).toBe(true);
      expect(context.every((asset) => !("storageIdentity" in asset) && !("path" in asset) && !("bytes" in asset) && !("base64" in asset))).toBe(true);
      expect(context.map((asset) => asset.safeDisplayName).sort()).toEqual(["Flyer_back.png", "Flyer_front.png", "logo.png"].sort());
      expect(context.every((asset) => asset.mediaType === "image/png" && asset.source === "USER_SUPPLIED")).toBe(true);
      expect(JSON.stringify([...database.assets.entries()])).toBe(snapshotBeforeRespond);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
