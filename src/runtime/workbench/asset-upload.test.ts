import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkbenchRequestSchema } from "./contracts";

const source = (file: string) => readFile(path.resolve(file), "utf8");

describe("asset upload UI UPLOAD-UI1-UPLOAD-UI10", () => {
  it.each([
    ["UPLOAD-UI1", "Attach project files"],
    ["UPLOAD-UI2", "Asset category"],
    ["UPLOAD-UI3", "accept=\".png,.jpg,.jpeg,.webp,.pdf"],
    ["UPLOAD-UI4", "Project assets"],
    ["UPLOAD-UI5", "Replace"],
    ["UPLOAD-UI6", "Remove"],
    ["UPLOAD-UI7", "The Lead sees metadata only"],
    ["UPLOAD-UI8", "application/pdf"],
    ["UPLOAD-UI9", "Factory-owned intake"],
    ["UPLOAD-UI10", "setAssetBusy"],
  ])("%s remains represented in the Workbench", async (_id, marker) => {
    expect(await source("src/components/workbench.tsx")).toContain(marker);
  });

  it("keeps asset uploads outside the JSON workflow contract", () => {
    expect(WorkbenchRequestSchema.safeParse({ action: "create", requestText: "Build a site", operatorLanguage: "en" }).success).toBe(true);
    expect(WorkbenchRequestSchema.safeParse({ action: "create", requestText: "Build a site", files: ["secret/path"] }).success).toBe(false);
  });
});
