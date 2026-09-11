import {
  SecurityProbeRequestSchema,
  SecurityTestEvidenceSchema,
  type SecurityProbeRequest,
  type SecurityTestEvidence,
} from "@/domain/assurance/contracts";

type ProbeObservation = {
  actual: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  severity?: SecurityProbeRequest["severity"];
  safeEvidence: string[];
};

export type SecurityProbeExecutor = (probe: SecurityProbeRequest, signal: AbortSignal) => Promise<ProbeObservation>;

const localRoute = (route: string) => route.startsWith("/") && !route.includes("..") && !/^\/\//.test(route);
const safeText = (value: string) => value.replaceAll(/\s+/g, " ").trim().slice(0, 500) || "No safe observation was returned.";
const safeRef = (value: string) => value.replaceAll(/[^A-Za-z0-9_.:/-]/g, "-").slice(0, 160) || "security-test:evidence";

/**
 * Execute only caller-supplied, non-destructive probes sequentially. This
 * helper has no network client and therefore cannot silently expand a target
 * boundary; the host must provide the already-authorized local executor.
 */
export async function executeBoundedSecurityProbes(input: {
  implementationChecksum: string;
  targetBoundary: "LOCAL_TEST_APPLICATION" | "DISPOSABLE_TEST_APPLICATION" | "EXPLICIT_AUTHORIZED_STAGING";
  authorizationEvidence?: string;
  timeoutMs: number;
  requestBudget: number;
  probes: readonly SecurityProbeRequest[];
  execute: SecurityProbeExecutor;
}): Promise<SecurityTestEvidence> {
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 60_000) throw new Error("SECURITY_TEST_TIMEOUT_OUT_OF_BOUNDS");
  if (!Number.isInteger(input.requestBudget) || input.requestBudget < 1 || input.requestBudget > 100) throw new Error("SECURITY_TEST_REQUEST_BUDGET_OUT_OF_BOUNDS");
  if (input.targetBoundary === "EXPLICIT_AUTHORIZED_STAGING" && !input.authorizationEvidence) throw new Error("SECURITY_TEST_TARGET_AUTHORIZATION_REQUIRED");
  const probes = input.probes.map((probe) => SecurityProbeRequestSchema.parse(probe));
  if (probes.length > input.requestBudget) throw new Error("SECURITY_TEST_REQUEST_BUDGET_EXCEEDED");
  if (probes.some((probe) => !localRoute(probe.route))) throw new Error("SECURITY_TEST_ROUTE_OUTSIDE_BOUNDARY");
  const captured: SecurityTestEvidence["probes"] = [];
  for (const probe of probes) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("SECURITY_TEST_TIMEOUT"));
        }, input.timeoutMs);
      });
      const observation = await Promise.race([input.execute(probe, controller.signal), timeout]);
      captured.push({ probeId: probe.probeId, kind: probe.kind, route: probe.route, expected: probe.expected, actual: safeText(observation.actual), status: observation.status, severity: observation.severity ?? probe.severity, safeEvidence: observation.safeEvidence.slice(0, 20).map(safeRef) });
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "SECURITY_TEST_TIMEOUT";
      captured.push({ probeId: probe.probeId, kind: probe.kind, route: probe.route, expected: probe.expected, actual: timedOut ? "Probe exceeded the bounded timeout." : "Probe did not produce an admissible safe observation.", status: "FAIL", severity: "HIGH", safeEvidence: [timedOut ? "security-test:timeout" : "security-test:executor-error"] });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return SecurityTestEvidenceSchema.parse({ implementationChecksum: input.implementationChecksum, targetBoundary: input.targetBoundary, ...(input.authorizationEvidence ? { authorizationEvidence: input.authorizationEvidence } : {}), timeoutMs: input.timeoutMs, requestBudget: input.requestBudget, nonDestructive: true, probes: captured, capturedAt: new Date().toISOString() });
}
