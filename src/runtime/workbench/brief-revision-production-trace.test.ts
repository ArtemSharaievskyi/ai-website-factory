import { describe, expect, it } from "vitest";
import { DeterministicLeadProvider } from "@/agents/lead/ports";
import { LeadAgentService } from "@/agents/lead/service";
import { analyzePromptDeterministically, assembleRequirements, planClarificationsDeterministically } from "@/agents/lead/deterministic";
import type { BriefRevisionDraft } from "@/agents/lead/contracts";
import { RequirementSpecificationSchema, ProjectBriefV2Schema, type RequirementSpecification } from "@/domain/requirements/schema";
import { emptyBriefV2Fields } from "@/domain/requirements/brief";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository } from "@/persistence/database/repositories";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "./application";
import { clearWorkbenchDiagnosticEvents, getBriefRevisionTraceEvents } from "./diagnostics";

const oldProhibition = "No successful submission may be faked.";
const conciseRevision = "Remove the old form success prohibition; show a simulated success after local validation, keep transmission disabled, and preserve all other confirmed requirements.";
const prompt = "Title: Synthetic service\nPurpose: Serve local customers\nAudience: Visitors\nPages: home, contact\nFunctionality: contact form\nLanguages: de\nImages: placeholders\nAcceptance: contact path works";

function legacyV1(brief: RequirementSpecification) {
  const { briefSchemaVersion: _briefSchemaVersion, ...legacy } = brief;
  void _briefSchemaVersion;
  return RequirementSpecificationSchema.parse({
    ...legacy,
    explicitExclusions: [oldProhibition],
    content: undefined,
    technical: undefined,
    brandVisualRequirements: undefined,
    assetRequirements: undefined,
    formBehaviorRequirements: undefined,
    uxResponsiveRequirements: undefined,
    seoMetadata: undefined,
    legalComplianceConstraints: undefined,
    prohibitedRequirements: undefined,
    deferredIntegrations: undefined,
    decisions: undefined,
  });
}

type RevisionFixtureMode = "clean" | "dirty-provider-candidate" | "active-conflict";

async function productionLikeFailure(mode: RevisionFixtureMode = "clean") {
  const database = new InMemoryPersistenceDatabase();
  const memory = new FakeLeadMemoryPort();
  const v2Candidate: { current?: RequirementSpecification } = {};
  const provider = new DeterministicLeadProvider(
    analyzePromptDeterministically,
    (input) => planClarificationsDeterministically(input),
    assembleRequirements,
    (input): BriefRevisionDraft => {
      const requirements = v2Candidate.current ?? ProjectBriefV2Schema.parse({ ...input.currentBrief, ...emptyBriefV2Fields(), explicitExclusions: [], formBehaviorRequirements: { ...emptyBriefV2Fields().formBehaviorRequirements, formPresent: true, validation: "ACTIVE", successUx: "SIMULATED", dataTransmission: "NONE", persistence: "NONE", thirdParty: "NONE", privacyCheckbox: "REQUIRED" } });
      return { projectId: input.projectId, projectVersion: input.projectVersion, requirements, facts: [], recommendations: [], unresolvedItems: [], evidence: requirements.evidence, readyForApproval: true, blockingReasons: [], nonBlockingWarnings: [], briefChecksum: checksumPersistedDocument(requirements), revisionOperations: mode === "active-conflict" ? [{ kind: "ADD", field: "formBehaviorRequirements" }] : [{ kind: "REMOVE", field: "effective-requirements", target: "FORM_SUCCESS_SIMULATION" }] };
    },
  );
  const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory, provider }) });
  const app = new WorkbenchApplication({ database, entry });
  const created = await app.handle({ action: "create", requestText: prompt, languageHint: "de" });
  if (!created.project) throw new Error("synthetic project was not created");
  const answers = created.questions.filter((question) => question.answerStatus === "unresolved").map((question) => ({ questionId: question.id, answer: question.requirementKey === "languages" ? "de" : question.requirementKey === "pages" ? "Home and Contact" : question.requirementKey === "acceptance" ? "Contact path works." : question.requirementKey === "image-source" ? "placeholders" : "Synthetic confirmation." }));
  if (answers.length) await app.handle({ action: "respond", projectId: created.project.projectId, answers });
  const documents = new DocumentRepository(database);
  const current = await documents.get(created.project.projectId, 1, "requirements");
  if (!current || current.documentType !== "requirements") throw new Error("current requirements were not persisted");
  v2Candidate.current = ProjectBriefV2Schema.parse({ ...current, ...emptyBriefV2Fields(), explicitExclusions: mode === "clean" ? [] : [oldProhibition], formBehaviorRequirements: { ...emptyBriefV2Fields().formBehaviorRequirements, formPresent: true, validation: "ACTIVE", successUx: "SIMULATED", dataTransmission: "NONE", persistence: "NONE", thirdParty: "NONE", privacyCheckbox: "REQUIRED" } });
  await documents.save(legacyV1(current), "synthetic-v1-seed");
  return { app, projectId: created.project.projectId, documents };
}

describe("production-shaped Brief V1 to V2 revision reproduction", () => {
  it("reproduces and repairs the host preservation path with safe stage snapshots", async () => {
    clearWorkbenchDiagnosticEvents();
    const fixture = await productionLikeFailure();
    const revised = await fixture.app.handle({ action: "request-brief-changes", projectId: fixture.projectId, reason: conciseRevision, requirementKeys: ["project-brief"] });
    expect(revised.brief).toMatchObject({ approved: false, briefSchemaVersion: 2 });
    const revisedDocument = await fixture.documents.get(fixture.projectId, 1, "requirements");
    if (!revisedDocument || revisedDocument.documentType !== "requirements") throw new Error("revised requirements were not persisted");
    expect(revisedDocument?.formBehaviorRequirements).toMatchObject({ successUx: "SIMULATED", dataTransmission: "NONE" });
    expect(revisedDocument?.explicitExclusions).not.toContain(oldProhibition);
    expect(revisedDocument?.requirementHistory?.some((item) => item.statement === oldProhibition && item.status === "REMOVED")).toBe(true);
    const traces = getBriefRevisionTraceEvents().filter((event) => event.projectId === fixture.projectId);
    expect(traces.map((event) => event.stage)).toEqual(["LEGACY_INPUT", "PROVIDER_CANDIDATE", "REVISION_OPERATIONS", "POST_REVISION_APPLICATION", "POST_PRESERVATION", "EFFECTIVE_SELECTION", "CONTRADICTION_INPUT"]);
    expect(traces.find((event) => event.stage === "LEGACY_INPUT")).toMatchObject({ hasSuccessSimulationProhibited: true, removeOperationPresent: true });
    expect(traces.find((event) => event.stage === "PROVIDER_CANDIDATE")).toMatchObject({ hasSuccessSimulationRequired: true, hasSuccessSimulationProhibited: false, providerCandidateHasSuccessSimulationProhibited: false });
    expect(traces.find((event) => event.stage === "POST_REVISION_APPLICATION")).toMatchObject({ postRevisionHasSuccessSimulationProhibited: false });
    expect(traces.find((event) => event.stage === "POST_PRESERVATION")).toMatchObject({ postPreservationHasSuccessSimulationProhibited: false });
    expect(traces.find((event) => event.stage === "EFFECTIVE_SELECTION")).toMatchObject({ effectiveHasSuccessSimulationProhibited: false, historyCount: 1, historyHasSuccessSimulationProhibited: true });
    expect(traces.find((event) => event.stage === "CONTRADICTION_INPUT")).toMatchObject({ hasSuccessSimulationRequired: true, hasSuccessSimulationProhibited: false, contradictionCount: 0 });
    expect(JSON.stringify(traces)).not.toContain(oldProhibition);
    expect(JSON.stringify(traces)).not.toContain(conciseRevision);
  });

  it("rejects a dirty provider candidate before preservation can hide an unapplied REMOVE", async () => {
    clearWorkbenchDiagnosticEvents();
    const fixture = await productionLikeFailure("dirty-provider-candidate");
    await expect(fixture.app.handle({ action: "request-brief-changes", projectId: fixture.projectId, reason: conciseRevision, requirementKeys: ["project-brief"] })).rejects.toMatchObject({ code: "LEAD_PROVIDER_FAILED", details: { outputStage: "REVISION_SEMANTIC_VALIDATION_FAILED", issueCode: "BRIEF_REVISION_REMOVE_NOT_APPLIED" } });
    const persisted = await fixture.documents.get(fixture.projectId, 1, "requirements");
    expect(persisted?.documentType).toBe("requirements");
    if (persisted?.documentType === "requirements") expect(persisted.explicitExclusions).toContain(oldProhibition);
    const traces = getBriefRevisionTraceEvents().filter((event) => event.projectId === fixture.projectId);
    expect(traces.map((event) => event.stage)).toEqual(["LEGACY_INPUT", "PROVIDER_CANDIDATE", "REVISION_OPERATIONS"]);
    expect(traces.find((event) => event.stage === "PROVIDER_CANDIDATE")).toMatchObject({ providerCandidateHasSuccessSimulationProhibited: true });
    expect(traces.at(-1)).toMatchObject({ stage: "REVISION_OPERATIONS", removeVerificationPassed: false });
  });

  it("preserves a true active conflict for contradiction validation", async () => {
    clearWorkbenchDiagnosticEvents();
    const fixture = await productionLikeFailure("active-conflict");
    await expect(fixture.app.handle({ action: "request-brief-changes", projectId: fixture.projectId, reason: "Keep the simulated success behavior and preserve all confirmed requirements.", requirementKeys: ["project-brief"] })).rejects.toMatchObject({ code: "LEAD_PROVIDER_FAILED", details: { outputStage: "BRIEF_CONTRADICTION_DETECTED", issueCode: "FORM_SUCCESS_SIMULATION_CONFLICT" } });
    const traces = getBriefRevisionTraceEvents().filter((event) => event.projectId === fixture.projectId);
    expect(traces.at(-1)).toMatchObject({ stage: "CONTRADICTION_INPUT", hasSuccessSimulationRequired: true, hasSuccessSimulationProhibited: true, contradictionCount: 1 });
  });
});
