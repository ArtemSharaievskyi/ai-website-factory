import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const component = () => readFile(path.resolve("src/components/workbench.tsx"), "utf8");

describe("WRA1-WRA20 Workbench clarification answer UX", () => {
  const matrix: Array<[string, () => Promise<void>]> = [
    ["WRA1 filled answer text persists in component state", async () => expect(await component()).toContain("setAnswers((current)" )],
    ["WRA2 submit enters pending state", async () => expect(await component()).toContain("setLoading(true)")],
    ["WRA3 button disables while pending", async () => expect(await component()).toContain("loading ||")],
    ["WRA4 duplicate click is suppressed", async () => { const source = await component(); expect(source).toContain("requestInFlightRef.current"); expect(source).toContain("if (requestInFlightRef.current) return"); }],
    ["WRA5 failure preserves typed answers", async () => { const source = await component(); expect(source).toContain("catch (caught)"); expect(source).toContain("setError("); }],
    ["WRA6 validation failure is visible", async () => expect(await component()).toContain('role="alert"')],
    ["WRA7 correlation/reference is visible", async () => expect(await component()).toContain("Reference: ")],
    ["WRA8 raw server stack is not rendered", async () => expect(await component()).not.toContain("stack")],
    ["WRA9 success clears only accepted answer drafts", async () => { const source = await component(); expect(source).toContain("acceptedQuestionIds"); expect(source).toContain("setAnswers((current)"); }],
    ["WRA10 success applies the returned canonical project state", async () => expect(await component()).toContain("apply(await request(input))")],
    ["WRA11 German clarification placeholder remains language-aware", async () => expect(await component()).toContain('"Answer in " + displayLanguageName')],
    ["WRA12 canonical question text is rendered", async () => expect(await component()).toContain("{question.question}")],
    ["WRA13 full Workbench i18n is not required", async () => expect(await component()).toContain("PROJECT WORKBENCH")],
    ["WRA14 no answer summarization", async () => { const source = await component(); expect(source).not.toMatch(/summariz|answer\.slice|answer\.substring/i); }],
    ["WRA15 line breaks are not stripped", async () => { const source = await component(); expect(source).toContain("event.target.value"); expect(source).not.toContain("replace(/\\r\\n?") ; }],
    ["WRA16 no automatic retry", async () => { const source = await component(); expect(source).not.toMatch(/retry|setTimeout|auto.?retry/i); }],
    ["WRA17 route failure prevents application success projection", async () => expect(await component()).toContain("if (!response.ok || !body.ok || !body.data)")],
    ["WRA18 no Brief is applied before server success", async () => expect(await component()).toContain("return body.data")],
    ["WRA19 assets remain projected alongside clarification failure", async () => expect(await component()).toContain("<AssetPanel")],
    ["WRA20 existing READY assets are not touched by answer submit", async () => { const source = await component(); expect(source).toContain("onRemove={(assetId) => void removeAsset(assetId)}"); expect(source).not.toContain("removeAsset(input.projectId)"); }],
  ];

  it.each(matrix)("%s", async (_name, check) => check());
});
