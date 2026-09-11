/**
 * Deterministic supply-chain procedure owned by DependencyGuardianAgent.
 * It is deliberately not a second agent or a package-install authority; the
 * approved generated evidence and existing dependency tooling remain inputs.
 */
export const SupplyChainSecuritySkill = Object.freeze({
  id: "supply-chain-security",
  version: "1.0.0",
  readOnly: true,
  checks: [
    "dependencies.supply-chain",
    "dependencies.secret-scan",
    "dependencies.lifecycle-scripts",
    "dependencies.remote-sources",
    "dependencies.integrity",
  ] as const,
});
