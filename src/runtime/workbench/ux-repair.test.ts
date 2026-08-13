import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { isUserFacingProjectOrigin } from "@/domain/project/provenance";
import { assertWorkbenchStyleIsolation } from "@/integrations/design/isolation";
import { WorkbenchRequestSchema } from "./contracts";

const source = (relativePath: string) => readFile(path.resolve(relativePath), "utf8");

describe("Workbench UX1-UX36 deterministic repair matrix", () => {
  const matrix: Array<[string, () => Promise<void>]> = [
    ["UX1 dark product background", async () => expect(await source("src/app/globals.css")).toContain("--workbench-bg: #090b10")],
    ["UX2 green is not the primary accent", async () => { const css = await source("src/app/globals.css"); expect(css).toContain("--workbench-accent: #9b8cff"); expect(css).not.toContain("#167864"); }],
    ["UX3 Workbench styling is not customer-derived", async () => { const [css, component] = await Promise.all([source("src/app/globals.css"), source("src/components/workbench.tsx")]); expect(`${css}\n${component}`).not.toMatch(/Haus|Garten|customer-project-theme/i); }],
    ["UX4 project switching does not recolor Workbench", async () => { const component = await source("src/components/workbench.tsx"); expect(component).toContain('action: "status", projectId'); expect(component).not.toContain("setTheme"); }],
    ["UX5 main screen has a visual", async () => expect(await source("src/components/workbench.tsx")).toContain("workbench-hero.svg")],
    ["UX6 visual is Factory-owned", async () => expect(await source("src/components/workbench.tsx")).toContain("/factory/workbench-hero.svg")],
    ["UX7 hero has no remote dependency", async () => expect(await source("public/factory/workbench-hero.svg")).not.toMatch(/(?:href|src)=['"]https?:\/\//i)],
    ["UX8 composer remains functional", async () => expect(WorkbenchRequestSchema.safeParse({ action: "create", requestText: "Build a site" }).success).toBe(true)],
    ["UX9 composer accepts multiline UTF-8", async () => { const value = "Zeile eins\nGießen — Möbel"; const parsed = WorkbenchRequestSchema.parse({ action: "create", requestText: value }); expect(parsed.action === "create" ? parsed.requestText : "").toBe(value); }],
    ["UX10 Factory UI copy is English", async () => { const component = await source("src/components/workbench.tsx"); expect(component).not.toMatch(/Bitte|Antwort|Schreibe eine kurze Antwort/i); }],
    ["UX11 operator and site language are separate fields", async () => { const contracts = await source("src/runtime/workbench/contracts.ts"); expect(contracts).toContain("operatorLanguage"); expect(contracts).toContain("siteLanguage"); }],
    ["UX12 German site language cannot set operator language", async () => { const lead = await source("src/agents/lead/contracts.ts"); expect(lead).toContain("operatorLanguage"); expect(lead).not.toContain("operatorLanguage: LocaleSchema"); }],
    ["UX13 Lead receives operator language", async () => expect(await source("src/runtime/trial-entry/service.ts")).toContain("operatorLanguage: FACTORY_OPERATOR_LANGUAGE")],
    ["UX14 new deterministic questions are English", async () => { const lead = await source("src/agents/lead/deterministic.ts"); expect(lead).toContain("What is the primary business purpose"); expect(lead).not.toContain("Bitte bestätigen"); }],
    ["UX15 site language contract remains customer-owned", async () => { const value = RequirementSpecificationSchema.parse({ schemaVersion: 1, documentType: "requirements", projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", projectSummary: "German site", protectedFunctionalityRequired: false, imagesRequired: false, businessGoals: [], targetAudiences: [], pages: [], userRoles: [], features: [], forms: [], contentRequirements: [], backendRequirements: [], supabaseRequirements: [], authenticationDecision: "pending", storageDecision: "pending", emailDecision: "pending", administrationDecision: "pending", seoRequirements: [], localization: { locales: ["de"], defaultLocale: "de" }, imageSourceDecision: "pending", suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" }, technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: [], unresolvedItems: [], approval: { approved: false }, briefStatus: "draft", briefVersion: 1 }); expect(value.localization.defaultLocale).toBe("de"); }],
    ["UX16 clarification placeholder is exact", async () => expect(await source("src/components/workbench.tsx")).toContain('placeholder="Answer in English..."')],
    ["UX17 clarification uses multiline textarea", async () => { const [component, css] = await Promise.all([source("src/components/workbench.tsx"), source("src/app/globals.css")]); expect(component).toContain("rows={5}"); expect(css).toContain("resize: vertical"); }],
    ["UX18 line breaks survive answer DTO", async () => expect(await source("src/runtime/trial-entry/service.test.ts")).toContain("Gießen & Umgebung\\n\\nServices")],
    ["UX19 Unicode survives answer DTO", async () => expect(await source("src/runtime/trial-entry/service.test.ts")).toContain("Möbelmontage")],
    ["UX20 browser does not summarize answers", async () => { const component = await source("src/components/workbench.tsx"); expect(component).not.toMatch(/summariz|answer\.slice|answer\.substring/i); }],
    ["UX21 browser does not rewrite answers", async () => { const component = await source("src/components/workbench.tsx"); expect(component).not.toMatch(/answer\.replace|setAnswers\([^)]*trim/i); }],
    ["UX22 required labels are explicit", async () => expect(await source("src/components/workbench.tsx")).toContain("Required")],
    ["UX23 failure path retains answer state", async () => { const component = await source("src/components/workbench.tsx"); expect(component).toContain("setError"); expect(component).toContain("setAnswers((current)"); }],
    ["UX24 no automatic retry", async () => expect(await source("src/components/workbench.tsx")).not.toMatch(/retry|setTimeout|auto.?retry/i)],
    ["UX25 synthetic origins are excluded", async () => expect(isUserFacingProjectOrigin("SMOKE")).toBe(false)],
    ["UX26 filtering is not deletion", async () => expect(await source("src/runtime/workbench/application.ts")).not.toMatch(/delete|remove|rm\(/i)],
    ["UX27 legitimate origins remain visible", async () => { expect(isUserFacingProjectOrigin("USER")).toBe(true); expect(isUserFacingProjectOrigin("REAL")).toBe(true); }],
    ["UX28 filtering is not name matching", async () => { const application = await source("src/runtime/workbench/application.ts"); expect(application).not.toContain("VeloFix"); expect(application).toContain("isUserFacingProjectOrigin"); }],
    ["UX29 project IDs remain authoritative", async () => expect(await source("src/app/api/workbench/route.ts")).toContain("projectId")],
    ["UX30 Workbench tokens are rejected at design boundary", async () => expect(() => assertWorkbenchStyleIsolation({ token: "--workbench-bg" })).toThrow()],
    ["UX31 generated design remains project-owned", async () => { const design = await source("src/agents/design/deterministic.ts"); expect(design).not.toContain("workbench-bg"); expect(design).toContain("approvedBrief"); }],
    ["UX32 desktop hero layout exists", async () => expect(await source("src/app/globals.css")).toContain(".landing-hero-layout")],
    ["UX33 tablet layout collapses safely", async () => expect(await source("src/app/globals.css")).toContain("@media (max-width: 900px)")],
    ["UX34 mobile layout is bounded", async () => expect(await source("src/app/globals.css")).toContain("@media (max-width: 620px)")],
    ["UX35 real project is not referenced by client code", async () => expect(await source("src/components/workbench.tsx")).not.toContain("b7a0829d-a077-487c-844a-3232efc21bc3")],
    ["UX36 customer source is not generated by Workbench", async () => { const component = await source("src/components/workbench.tsx"); expect(component).not.toContain("generatedProjectsRoot"); expect(component).not.toContain("ImplementationAgent"); }],
  ];

  it.each(matrix)("%s", async (_name, check) => check());
});
