import { describe, expect, it } from "vitest";
import { validateNoDialKitProductionLeak, createDialKitAuthoringSession } from "@/integrations/design/dialkit";
import { detectImpeccableAntiPatterns } from "@/integrations/design/impeccable";
import { FACTORY_ANTI_AI_SLOP_HEURISTIC_IDS } from "@/domain/design/quality-contract";
import { DEFAULT_MOTION_TOKEN_SET, MotionTokenSetSchema } from "@/domain/design/capability";
import { AntiAISlopDesignGuard, DesignSystemChecklist, runDesignSystemChecklist } from "./design-quality";

const checksum = "a".repeat(64);

describe("frontend design quality boundary", () => {
  it("implements all thirty Factory anti-AI-slop heuristics against a synthetic page", () => {
    const source = `
      import { HomeIcon, UserIcon, SettingsIcon } from "lucide-react";
      <main className="bg-gradient-to-r from-purple-500 to-blue-500 bg-white shadow-lg shadow-md shadow-xl shadow-2xl rounded-3xl rounded-3xl rounded-3xl rounded-3xl rounded-3xl grid grid-cols-3 border-l-2 border-l-2">
        <Card feature className="bg-white"><HomeIcon /></Card><Card feature className="bg-white"><UserIcon /></Card><Card feature className="bg-white"><SettingsIcon /></Card>
        <span>😀</span><div className="backdrop-blur bg-white/20">— — —</div>
        <p style={{ fontFamily: "Inter" }}>It's not X, it's Y. ✅ ✅ ✅ ✅</p>
        <section className="bento terminal dot-grid neon pastel pastel bg-pink-50 bg-sky-50 glow sphere blur">red orange yellow green blue purple pink</section>
        <h2>testimonial from our customer</h2><h3>Basic Pro Enterprise pricing tiers</h3>
        <span>SparkleIcon animated arrow bounce</span><span>hover:scale-105 hover:translate-y-1 hover:shadow-lg</span>
        <span>fetch data</span><div className="purple black" />
      </main>`;
    const result = runDesignSystemChecklist({
      files: [{ path: "src/app/page.tsx", content: source }],
      designChecksum: checksum,
      productSignals: { requiresInteractiveDemo: true, collectsPersonalData: true, requiresTerms: true, requiresPrivacy: true, dataDriven: true },
    });
    const detected = new Set(result.findings.filter((finding) => finding.source === "FACTORY_ANTI_AI_SLOP").map((finding) => finding.ruleId));
    expect(DesignSystemChecklist.heuristicCount).toBe(30);
    expect(FACTORY_ANTI_AI_SLOP_HEURISTIC_IDS.every((ruleId) => detected.has(ruleId))).toBe(true);
    expect(result.verdict).toBe("BLOCK");
    expect(AntiAISlopDesignGuard.heuristicCount).toBe(30);
  });

  it("uses approved Design context to avoid simplistic false positives", () => {
    const result = runDesignSystemChecklist({
      files: [{ path: "src/app/data.tsx", content: `import { TableIcon } from "lucide-react"; export function Data() { return <main className="bg-white grid grid-cols-3"><TableIcon /></main>; }` }],
      designChecksum: checksum,
      approvedDesignText: "Approved Design: white editorial background; three-column data layout; restrained Lucide usage.",
    });
    expect(result.findings.filter((finding) => ["pure-white-everywhere", "generic-three-card-row", "lucide-saturation"].includes(finding.ruleId))).toHaveLength(0);
    expect(result.verdict).toBe("PASS");
  });

  it("requires justification for default typography but permits an approved Inter decision", () => {
    const generic = runDesignSystemChecklist({ files: [{ path: "src/app/page.tsx", content: "export const style = { fontFamily: 'Inter' };" }], designChecksum: checksum });
    const approved = runDesignSystemChecklist({ files: [{ path: "src/app/page.tsx", content: "export const style = { fontFamily: 'Inter' };" }], designChecksum: checksum, approvedDesignText: "The approved brand system deliberately specifies Inter for the editorial system." });
    expect(generic.findings.some((finding) => finding.ruleId === "default-ai-font")).toBe(true);
    expect(approved.findings).toMatchObject([{ ruleId: "default-ai-font", disposition: "JUSTIFIED_BY_DESIGN", justified: true, justificationReference: expect.any(String) }]);
    expect(approved.verdict).toBe("PASS");
  });

  it("blocks over-animated hover surfaces and passes coherent reduced-motion behavior", () => {
    const overAnimated = runDesignSystemChecklist({ files: [{ path: "src/app/cards.tsx", content: "<div className=\"hover:scale-105 hover:translate-y-1 hover:shadow-lg\">card</div>" }], designChecksum: checksum });
    const coherent = runDesignSystemChecklist({ files: [{ path: "src/app/layout.tsx", content: "<nav className=\"transition-opacity\">navigation</nav><div data-state=\"open\" className=\"transition-transform\">state</div>@media (prefers-reduced-motion: reduce) { * { transition: none; } }" }], designChecksum: checksum });
    expect(overAnimated.findings.some((finding) => finding.ruleId === "animation-on-every-hover")).toBe(true);
    expect(overAnimated.verdict).toBe("BLOCK");
    expect(coherent.motion).toBe("PASS");
    expect(coherent.accessibility).toBe("PASS");
    expect(coherent.verdict).toBe("PASS");
  });

  it("provides bounded motion tokens and explicit checklist category statuses", () => {
    expect(MotionTokenSetSchema.parse(DEFAULT_MOTION_TOKEN_SET)).toMatchObject({
      fast: { durationMs: 120 },
      standard: { durationMs: 200 },
      slow: { durationMs: 360 },
      gentleSpring: { stiffness: 260 },
      expressiveSpring: { stiffness: 420 },
    });
    const result = runDesignSystemChecklist({ files: [{ path: "src/app/page.tsx", content: "export default function Page() { return <main />; }" }], designChecksum: checksum });
    expect(result).toMatchObject({ designFidelity: "PASS", surfaces: "PASS", uxStates: "PASS" });
  });

  it("normalizes Impeccable findings into Factory evidence without writing source", () => {
    const files = [{ path: "src/app/page.tsx", content: "background: linear-gradient(purple, violet); animation: margin 2s infinite;" }];
    const external = detectImpeccableAntiPatterns(files);
    const result = runDesignSystemChecklist({ files, designChecksum: checksum });
    expect(external.status).toBe("FAIL");
    expect(result.findings.some((finding) => finding.source === "IMPECCABLE" && finding.ruleId === "generic-purple-gradient")).toBe(true);
    expect(result.findings.some((finding) => finding.source === "IMPECCABLE" && finding.ruleId === "layout-property-animation")).toBe(true);
    expect(files[0]?.content).toContain("linear-gradient");
  });

  it("lets approved Design rationale suppress a conflicting normalized Impeccable finding", () => {
    const result = runDesignSystemChecklist({
      files: [{ path: "src/app/page.tsx", content: "background: linear-gradient(purple, violet);" }],
      designChecksum: checksum,
      approvedDesignText: "The approved brand system specifies this purple gradient as the product's focal visual treatment.",
    });
    expect(result.findings.filter((finding) => ["generic-purple-gradient", "generic-gradient"].includes(finding.ruleId))).toMatchObject([
      { disposition: "JUSTIFIED_BY_DESIGN", justified: true, justificationReference: expect.any(String) },
      { disposition: "JUSTIFIED_BY_DESIGN", justified: true, justificationReference: expect.any(String) },
    ]);
    expect(result.antiAiSlop).toBe("PASS");
    expect(result.verdict).toBe("PASS");
  });

  it("keeps DialKit authoring-only and blocks runtime or visible control leaks", () => {
    const authoring = createDialKitAuthoringSession({ sessionId: "fixture", parameters: [{ name: "hero.scale", tokenPath: "motion.hero.scale", value: 1.02 }] });
    expect(authoring.authoringOnly).toBe(true);
    expect(authoring.productionDependency).toBe("NONE");
    const leaked = validateNoDialKitProductionLeak([
      { path: "package.json", content: JSON.stringify({ dependencies: { dialkit: "1.0.0" }, devDependencies: {} }) },
      { path: "src/design-controls.tsx", content: "export function Controls() { return <DialKitPanel />; }" },
    ]);
    const clean = validateNoDialKitProductionLeak([
      { path: "package.json", content: JSON.stringify({ dependencies: {}, devDependencies: { "@dialkit/dev": "1.0.0" } }) },
      { path: "src/tokens.ts", content: "export const motionDuration = 180;" },
    ]);
    expect(leaked).toMatchObject({ status: "BLOCK", productionRuntimeDependency: true });
    expect(clean).toMatchObject({ status: "PASS", productionRuntimeDependency: false });
  });
});
