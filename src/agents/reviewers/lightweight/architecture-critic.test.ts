import { describe, expect, it } from "vitest";
import { TechnicalArchitectureSchema } from "@/domain/architecture/schema";
import { ArchitectureCriticAgent } from "./agents";

const architecture = TechnicalArchitectureSchema.parse({
  schemaVersion: 1,
  documentType: "architecture",
  projectId: "11111111-1111-4111-8111-111111111111",
  projectVersion: 1,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  applicationProfile: "marketing-site",
  packageManager: "npm",
  routes: [{ path: "/", responsibility: "Public home" }],
  componentBoundaries: ["PublicPage"],
  componentDecisions: [{ area: "PublicPage", serverOrClient: "server", rationale: "No interaction is required." }],
  serverActions: [],
  routeHandlers: [],
  backendPriority: [],
  supabaseDatabaseRequirements: [],
  schemaPlan: [],
  rlsRequirements: [],
  authenticationPlan: "none",
  storagePlan: "not-required",
  emailPlan: "not-required",
  environmentVariables: [],
  dependencies: [],
  npmScripts: { build: "next build" },
  testStrategy: ["Unit"],
  securityControls: ["Input validation"],
  rejectedInfrastructure: [],
  acceptance: { accepted: true, acceptedAt: "2026-09-11T00:00:00.000Z", acceptedBy: "synthetic-test" },
});

describe("pre-implementation architecture critic", () => {
  it("passes a simple approved architecture and blocks risky stateful gaps", () => {
    const agent = new ArchitectureCriticAgent();
    expect(agent.reviewApprovedArchitecture({ architecture }).verdict).toBe("PASS");
    const risky = TechnicalArchitectureSchema.parse({ ...architecture, serverActions: ["Persist an authenticated record"], authenticationPlan: "member login", securityControls: [], testStrategy: [] });
    expect(agent.reviewApprovedArchitecture({ architecture: risky }).verdict).toBe("BLOCK");
    expect(() => agent.assertApprovedArchitectureReady({ architecture: risky })).toThrow("ARCHITECTURE_CRITIC_BLOCKED");
  });
});
