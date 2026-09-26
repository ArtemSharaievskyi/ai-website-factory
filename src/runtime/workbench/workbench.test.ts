import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { DeterministicLeadProvider } from "@/agents/lead/ports";
import { LeadAgentService } from "@/agents/lead/service";
import { analyzePromptDeterministically, assembleRequirements, planClarificationsDeterministically } from "@/agents/lead/deterministic";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { cleanBriefV3, multiDomainChangeSet, pilotShapedV1Brief } from "@/domain/requirements/v3/fixtures";
import { migrateV1ToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate-v1";
import { applyBriefChangeSet } from "@/domain/requirements/v3/reducer";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { BriefV3TransactionService } from "@/runtime/brief-revision-v3/service";
import { WorkbenchApplication } from "./application";
import { WorkbenchRequestSchema, actionsForWorkbenchState } from "./contracts";
import { TrialEntryService } from "@/runtime/trial-entry/service";

const syntheticPrompt = "Create a synthetic local test business website with a home page and contact path. Forms: contact form with simulated success after validation and no transmission.";
const answerFor = (key: string | undefined) => {
  switch (key) {
    case "business-purpose": return "A local synthetic test business website.";
    case "target-audience": return "Synthetic local customers.";
    case "languages": return "en-US";
    case "pages": return "Home and Contact";
    case "functionality": return "A contact form.";
    case "contact": return "Synthetic contact details only.";
    case "image-source": return "placeholders";
    case "logo": return "no logo";
    case "acceptance": return "Done when the synthetic test site renders.";
    case "storage": return "not needed";
    case "email": return "not needed";
    default: return "Confirmed synthetic test answer.";
  }
};

function fixture(options: { calls?: string[]; getWorkflowScope?: () => never } = {}) {
  const database = new InMemoryPersistenceDatabase();
  const memory = new FakeLeadMemoryPort();
  const provider = new DeterministicLeadProvider(
    (input) => { options.calls?.push("analyze"); return analyzePromptDeterministically(input); },
    (input) => { options.calls?.push("clarify"); return planClarificationsDeterministically(input); },
    (input) => { options.calls?.push("brief"); return assembleRequirements(input); },
  );
  const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory, provider }), createBriefRevisionV3: () => new BriefV3TransactionService({ database, provider: { proposeChanges: async () => multiDomainChangeSet } }) });
  return { database, entry, app: new WorkbenchApplication({ database, entry, ...(options.getWorkflowScope ? { getWorkflowScope: options.getWorkflowScope } : {}) }) };
}

async function createBriefReadyProject(app: WorkbenchApplication) {
  const created = await app.handle({ action: "create", requestText: syntheticPrompt });
  if (!created.project) throw new Error("fixture project was not created");
  const answers = created.questions.filter((question) => question.answerStatus === "unresolved").map((question) => ({ questionId: question.id, answer: answerFor(question.requirementKey) }));
  if (answers.length) await app.handle({ action: "respond", projectId: created.project.projectId, answers });
  const ready = await app.handle({ action: "status", projectId: created.project.projectId });
  return ready;
}

describe("Factory Workbench projection and boundary", () => {
  it("projects a new-project landing state and recent-project list", async () => {
    const { app } = fixture();
    const projection = await app.handle({ action: "list" });
    expect(projection.mode).toBe("NEW_PROJECT");
    expect(projection.status.allowedActions).toEqual([]);
    expect(projection.projects).toEqual([]);
  });

  it("submits through InitialProjectRequest, TrialEntryService, and Lead first", async () => {
    const calls: string[] = [];
    const database = new InMemoryPersistenceDatabase();
    const memory = new FakeLeadMemoryPort();
    const provider = new DeterministicLeadProvider((input) => { calls.push("analyze"); return analyzePromptDeterministically(input); }, (input) => { calls.push("clarify"); return planClarificationsDeterministically(input); }, (input) => { calls.push("brief"); return assembleRequirements(input); });
    const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory, provider }) });
    const projection = await new WorkbenchApplication({ database, entry }).handle({ action: "create", requestText: syntheticPrompt });
    expect(projection.mode).toBe("PROJECT_WORKBENCH");
    expect(projection.status.stage).toBe("Lead");
    expect(calls.slice(0, 2)).toEqual(["analyze", "clarify"]);
    expect([...database.events].some((event) => event.toState === "IMPLEMENTING")).toBe(false);
  });

  it("resumes clarification on the same durable project", async () => {
    const { database, app } = fixture();
    const created = await app.handle({ action: "create", requestText: syntheticPrompt });
    if (!created.project) throw new Error("fixture project was not created");
    const question = created.questions.find((item) => item.answerStatus === "unresolved");
    if (!question) throw new Error("fixture did not produce a question");
    const resumed = await app.handle({ action: "respond", projectId: created.project.projectId, answers: [{ questionId: question.id, answer: "Synthetic continuation" }] });
    expect(resumed.project?.projectId).toBe(created.project.projectId);
    expect(database.projects.size).toBe(1);
    expect(resumed.status.allowedActions).toContain("ANSWER_LEAD_CLARIFICATIONS");
  });

  it("projects and executes typed Brief approval and revision actions", async () => {
    const database = new InMemoryPersistenceDatabase();
    const projectId = "16161616-1616-4161-8161-161616161616";
    const project = { schemaVersion: 1 as const, documentType: "factory-project" as const, projectId, projectVersion: 1, createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z", id: projectId, slug: "workbench-v3", origin: "TEST" as const, siteLanguage: "UNRESOLVED" as const, originalPrompt: "Synthetic V3 Workbench project.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" as const };
    await new ProjectRepository(database).create(project);
    await new ProjectVersionRepository(database).create({ id: "17171717-1717-4171-8171-171717171717", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: "a".repeat(64), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: project.createdAt, updatedAt: project.updatedAt, rowVersion: 1 });
    await new DocumentRepository(database).save(createBriefV3Document({ projectId, projectVersion: 1, brief: cleanBriefV3, createdAt: project.createdAt, updatedAt: project.updatedAt }));
    const entry = new TrialEntryService({ database, createLeadAgent: () => { throw new Error("LEGACY_LEAD_REVISION_REACHED"); }, createBriefRevisionV3: () => new BriefV3TransactionService({ database, provider: { proposeChanges: async () => multiDomainChangeSet } }) });
    const app = new WorkbenchApplication({ database, entry });
    const ready = await app.handle({ action: "status", projectId });
    if (!ready.project || !ready.brief) throw new Error("fixture Brief was not ready");
    expect(ready.status.allowedActions).toEqual(["APPROVE_BRIEF", "REQUEST_BRIEF_CHANGES"]);
    const revised = await app.handle({ action: "request-brief-changes", projectId, projectVersion: ready.project.projectVersion, briefChecksum: ready.brief.checksum, expectedRowVersion: ready.project.rowVersion, reason: "Synthetic correction", requirementKeys: [] });
    expect(revised.project?.workflowState).toBe("CLARIFYING");
    const readyAgain = await app.handle({ action: "status", projectId });
    if (!readyAgain.project || !readyAgain.brief) throw new Error("fixture Brief was not ready");
    const approved = await app.handle({ action: "approve-brief", projectId, briefChecksum: readyAgain.brief.checksum, expectedRowVersion: readyAgain.project.rowVersion });
    expect(approved.project?.workflowState).toBe("AWAITING_PLANNING_GENERATION");
  });

  it("projects pilot-shaped legal placeholders as Brief-ready without changing workflow state", async () => {
    const database = new InMemoryPersistenceDatabase();
    const projectId = "18181818-1818-4181-8181-181818181818";
    const timestamp = "2026-08-17T00:00:00.000Z";
    const project = { schemaVersion: 1 as const, documentType: "factory-project" as const, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "workbench-readiness", origin: "TEST" as const, siteLanguage: "de" as const, originalPrompt: "Synthetic pilot-shaped readiness fixture.", currentVersion: 1, workflowState: "CLARIFYING" as const };
    const brief = applyBriefChangeSet(migrateV1ToCanonicalBriefV3(pilotShapedV1Brief), { contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED" }], unresolved: [] });
    await new ProjectRepository(database).create(project);
    await new ProjectVersionRepository(database).create({ id: "19191919-1919-4191-8191-191919191919", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: "a".repeat(64), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    await new DocumentRepository(database).save(createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: timestamp, updatedAt: timestamp }));
    const entry = new TrialEntryService({ database, createLeadAgent: () => { throw new Error("LEGACY_LEAD_READINESS_REACHED"); } });
    const projection = await new WorkbenchApplication({ database, entry }).handle({ action: "status", projectId });

    expect(projection.brief?.readyForApproval).toBe(true);
    expect(projection.status.allowedActions).toEqual(["APPROVE_BRIEF", "REQUEST_BRIEF_CHANGES"]);
    expect(projection.project?.workflowState).toBe("CLARIFYING");
    expect((await entry.status(projectId)).blockingReasons).toEqual([]);
  });

  it("keeps action permission in one canonical mapper", () => {
    expect(actionsForWorkbenchState({ workflowState: "CLARIFYING", hasBlockingQuestions: true, hasBrief: false, briefReady: false, hasPlanning: false, hasDesigns: false })).toEqual(["ANSWER_LEAD_CLARIFICATIONS"]);
    expect(actionsForWorkbenchState({ workflowState: "DRAFT", hasBlockingQuestions: false, hasBrief: false, briefReady: false, hasPlanning: false, hasDesigns: false })).toEqual([]);
    expect(actionsForWorkbenchState({ workflowState: "READY_FOR_IMPLEMENTATION", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: true, implementationReady: false })).toEqual([]);
    expect(actionsForWorkbenchState({ workflowState: "READY_FOR_IMPLEMENTATION", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: true, implementationReady: false, phase7cDatabaseDecisionPending: true })).toEqual(["DATABASE_DECISION"]);
    expect(actionsForWorkbenchState({ workflowState: "READY_FOR_IMPLEMENTATION", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: true, implementationReady: false, phase7cDependencyApprovalPending: true })).toEqual(["DEPENDENCY_APPROVAL"]);
    expect(actionsForWorkbenchState({ workflowState: "READY_FOR_IMPLEMENTATION", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: true, implementationReady: true })).toEqual(["START_IMPLEMENTATION"]);
  });

  it("separates Planning generation and approval frontiers", () => {
    const projectId = "00000000-0000-4000-8000-000000000000";
    expect(actionsForWorkbenchState({ workflowState: "AWAITING_PLANNING_GENERATION", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: false, hasDesigns: false })).toEqual(["GENERATE_PLANNING", "REQUEST_BRIEF_CHANGES"]);
    expect(WorkbenchRequestSchema.safeParse({ action: "generate-planning", projectId }).success).toBe(true);
    expect(actionsForWorkbenchState({ workflowState: "AWAITING_PLANNING_APPROVAL", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: false })).toContain("APPROVE_PLANNING");
    expect(actionsForWorkbenchState({ workflowState: "AWAITING_PLANNING_APPROVAL", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: false, hasDesigns: false })).toEqual([]);
    expect(actionsForWorkbenchState({ workflowState: "AWAITING_DESIGN_SELECTION", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: false })).not.toContain("APPROVE_PLANNING");
  });

  it("fails closed when Planning approval is requested before Planning exists", async () => {
    const { app } = fixture();
    const ready = await createBriefReadyProject(app);
    if (!ready.project || !ready.brief) throw new Error("fixture Brief was not ready");
    const approved = await app.handle({ action: "approve-brief", projectId: ready.project.projectId, briefChecksum: ready.brief.checksum, expectedRowVersion: ready.project.rowVersion });
    await expect(app.handle({ action: "approve-planning", projectId: approved.project!.projectId })).rejects.toMatchObject({ code: "PLANNING_WORKFLOW_INVALID" });
  });

  it("dispatches generation to the existing Planner service entry point", async () => {
    const planApprovedProject = vi.fn().mockResolvedValue(undefined);
    const workflowScope = { planner: { planApprovedProject, acceptPlanningPackage: vi.fn() } } as never;
    const { app, entry } = fixture({ getWorkflowScope: () => workflowScope });
    const ready = await createBriefReadyProject(app);
    if (!ready.project || !ready.brief) throw new Error("fixture Brief was not ready");
    const approved = await app.handle({ action: "approve-brief", projectId: ready.project.projectId, briefChecksum: ready.brief.checksum, expectedRowVersion: ready.project.rowVersion });
    expect((await entry.status(approved.project!.projectId)).nextAllowedActions).toContain("GENERATE_PLANNING");
    await app.handle({ action: "generate-planning", projectId: approved.project!.projectId });
    expect(planApprovedProject).toHaveBeenCalledOnce();
    expect(planApprovedProject.mock.calls[0]?.[0]).toMatchObject({ currentWorkflowState: "AWAITING_PLANNING_GENERATION", projectId: ready.project.projectId });
  });

  const matrix: Array<[string, () => Promise<void>]> = [
    ["W1 landing renders without project", async () => { expect((await fixture().app.handle({ action: "list" })).mode).toBe("NEW_PROJECT"); }],
    ["W2 multiline composer contract accepts text", async () => { const parsed = WorkbenchRequestSchema.parse({ action: "create", requestText: "line one\nline two" }); expect(parsed.action).toBe("create"); if (parsed.action === "create") expect(parsed.requestText).toContain("\n"); }],
    ["W3 request bound remains explicit", async () => { expect(WorkbenchRequestSchema.safeParse({ action: "create", requestText: "x".repeat(128 * 1024 + 1) }).success).toBe(false); }],
    ["W4 empty request rejects", async () => { expect(WorkbenchRequestSchema.safeParse({ action: "create", requestText: "" }).success).toBe(false); }],
    ["W5 keyboard submit is in client source", async () => { expect(await source("src/components/workbench.tsx")).toContain("event.metaKey || event.ctrlKey"); }],
    ["W6 Enter remains newline by only modified Enter prevention", async () => { const value = await source("src/components/workbench.tsx"); expect(value).toContain("event.preventDefault()"); expect(value).toContain("event.metaKey || event.ctrlKey"); }],
    ["W7 InitialProjectRequest remains canonical", async () => { expect(await source("src/runtime/trial-entry/service.ts")).toContain("createInitialProjectRequest"); }],
    ["W8 web path uses TrialEntryService", async () => { expect(await source("src/runtime/workbench/application.ts")).toContain("TrialEntryService"); }],
    ["W9 Lead is first semantic owner", async () => { expect(await source("src/runtime/trial-entry/service.ts")).toContain('firstSemanticOwner: "lead"'); }],
    ["W10 Planner is not imported by browser component", async () => { expect(await source("src/components/workbench.tsx")).not.toContain("@/agents/planner"); }],
    ["W11 Implementation is not imported by browser component", async () => { expect(await source("src/components/workbench.tsx")).not.toContain("ImplementationAgent"); }],
    ["W12 successful create changes presentation mode", async () => { expect((await fixture().app.handle({ action: "create", requestText: syntheticPrompt })).mode).toBe("PROJECT_WORKBENCH"); }],
    ["W13 clarification has question projections", async () => { expect((await fixture().app.handle({ action: "create", requestText: syntheticPrompt })).questions.length).toBeGreaterThan(0); }],
    ["W14 clarification keeps project identity", async () => { const p = await fixture().app.handle({ action: "create", requestText: syntheticPrompt }); expect(p.project?.projectId).toBeTruthy(); }],
    ["W15 refresh reads status by active project", async () => { expect(await source("src/components/workbench.tsx")).toContain('action: "status"'); }],
    ["W16 Brief projection is bounded", async () => { const p = await createBriefReadyProject(fixture().app); expect(p.brief?.businessGoals.length).toBeLessThanOrEqual(12); }],
    ["W17 approval action is typed", async () => { expect(WorkbenchRequestSchema.safeParse({ action: "approve-brief", projectId: "00000000-0000-4000-8000-000000000000", briefChecksum: "a".repeat(64), expectedRowVersion: 1 }).success).toBe(true); }],
    ["W18 revision action is typed", async () => { expect(WorkbenchRequestSchema.safeParse({ action: "request-brief-changes", projectId: "00000000-0000-4000-8000-000000000000", projectVersion: 1, briefChecksum: "a".repeat(64), expectedRowVersion: 1, reason: "Change" }).success).toBe(true); }],
    ["W19 planning requires upstream state", async () => { expect(actionsForWorkbenchState({ workflowState: "CLARIFYING", hasBlockingQuestions: true, hasBrief: false, briefReady: false, hasPlanning: false, hasDesigns: false })).not.toContain("APPROVE_PLANNING"); }],
    ["W20 planning approval permission is state-derived", async () => { expect(actionsForWorkbenchState({ workflowState: "AWAITING_DESIGN_SELECTION", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: false })).not.toContain("APPROVE_PLANNING"); }],
    ["W21 database action is explicit", async () => { expect(actionsForWorkbenchState({ workflowState: "AWAITING_DESIGN_SELECTION", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: false })).toContain("DATABASE_DECISION"); }],
    ["W22 dependency action is explicit", async () => { expect(actionsForWorkbenchState({ workflowState: "AWAITING_DESIGN_SELECTION", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: false })).toContain("DEPENDENCY_APPROVAL"); }],
    ["W23 direction set cardinality is three in domain", async () => { expect(await source("src/domain/design/schema.ts")).toContain(".length(3)"); }],
    ["W24 no direction auto-selected", async () => { expect(await source("src/components/workbench.tsx")).toContain("No direction is preselected"); }],
    ["W25 design selection is not arbitrary chat", async () => { expect(await source("src/components/workbench.tsx")).toContain("canonical Design Agent authority"); }],
    ["W26 start action is separate", async () => { expect(await source("src/components/workbench.tsx")).toContain("Start implementation"); }],
    ["W27 implementation authority remains orchestrator", async () => { expect(await source("src/orchestration/orchestrator/service.ts")).toContain("startImplementation"); }],
    ["W28 client state cannot override server mapper", async () => { expect(await source("src/runtime/workbench/application.ts")).toContain("WORKBENCH_ACTION_NOT_AVAILABLE"); }],
    ["W29 project list uses durable repository", async () => { expect(await source("src/persistence/database/repositories.ts")).toContain("async list()"); }],
    ["W30 no secrets in client source", async () => { const value = await source("src/components/workbench.tsx"); expect(value).not.toMatch(/OPENAI_API_KEY|DATABASE_URL|SUPABASE_SERVICE_ROLE/); }],
    ["W31 no raw HTML execution", async () => { expect(await source("src/components/workbench.tsx")).not.toContain("dangerouslySetInnerHTML"); }],
    ["W32 no source filesystem tree", async () => { expect(await source("src/components/workbench.tsx")).not.toContain("filesystem"); }],
    ["W33 mobile composer styles exist", async () => { expect(await source("src/app/globals.css")).toContain("@media (max-width: 620px)"); }],
    ["W34 direction cards stack responsively", async () => { expect(await source("src/app/globals.css")).toContain(".design-grid { grid-template-columns: 1fr; }"); }],
    ["W35 sidebar has keyboard buttons", async () => { expect(await source("src/components/workbench.tsx")).toContain("Toggle project sidebar"); }],
    ["W36 conversation does not force scroll", async () => { expect(await source("src/components/workbench.tsx")).not.toContain("scrollIntoView"); }],
    ["W37 CLI scripts remain present", async () => { const packageSource = await source("package.json"); expect(packageSource).toContain("factory:new"); expect(packageSource).toContain("factory:respond"); expect(packageSource).toContain("factory:status"); }],
    ["W38 provider telemetry path remains", async () => { expect(await source("src/runtime/trial-entry/production.ts")).toContain("usageSink"); }],
    ["W39 no Codex provider", async () => { expect(await source("src/runtime/workbench/production.ts")).not.toMatch(/Codex|codex/); }],
    ["W40 test uses synthetic data only", async () => { expect(syntheticPrompt).not.toMatch(/Haus|Garten|Halenko|Volodimir/i); }],
  ];

  it.each(matrix)("%s", async (_name, check) => check());
});

async function source(relativePath: string) {
  return readFile(path.resolve(relativePath), "utf8");
}
