import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { PlanningPackage } from "./contracts";
import {
  PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT,
  PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY,
  type PlanningSemanticChecksumPolicyVersion,
} from "./checksum-policy";

/** Exact persisted-document checksum; envelope and lifecycle fields are intentional. */
export const planningDocumentChecksum = (planningPackage: PlanningPackage) => checksumPersistedDocument(planningPackage);

/** Historical projection retained so existing semantic bindings remain verifiable. */
function legacyPlanningSemanticProjection(planningPackage: PlanningPackage) {
  return {
    ...planningPackage,
    accepted: false,
    acceptance: {},
    updatedAt: planningPackage.createdAt,
    architecture: { ...planningPackage.architecture, acceptance: { accepted: false } },
  };
}

const envelopeKeys = new Set([
  "createdAt",
  "updatedAt",
  "accepted",
  "acceptance",
  "semanticChecksumPolicyVersion",
  "providerContractVersion",
]);

/**
 * Remove host-owned lifecycle and acceptance metadata at every Planning
 * document depth. Arrays retain their order; all semantic values are copied.
 */
function currentPlanningSemanticProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(currentPlanningSemanticProjection);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !envelopeKeys.has(key))
      .map(([key, child]) => [key, currentPlanningSemanticProjection(child)]),
  );
}

export function planningSemanticProjectionForPolicy(
  planningPackage: PlanningPackage,
  policyVersion: PlanningSemanticChecksumPolicyVersion,
) {
  return policyVersion === PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY
    ? legacyPlanningSemanticProjection(planningPackage)
    : currentPlanningSemanticProjection(planningPackage);
}

export function planningSemanticChecksumForPolicy(
  planningPackage: PlanningPackage,
  policyVersion: PlanningSemanticChecksumPolicyVersion,
) {
  return checksumPersistedDocument(planningSemanticProjectionForPolicy(planningPackage, policyVersion));
}

/** One resolver used by Planner, currentness, PREPARE, APPLY, and readback. */
export function planningSemanticChecksum(planningPackage: PlanningPackage) {
  return planningSemanticChecksumForPolicy(
    planningPackage,
    planningPackage.semanticChecksumPolicyVersion ?? PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY,
  );
}

export const CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY = PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT;
