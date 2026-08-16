import { runArchitectureCheck } from "./check-architecture";
import { runProviderContractGuard } from "./check-provider-contracts";
import type { GuardFailure } from "./baseline-failures";

export async function runRegisteredGuardSnapshot(root: string) {
  const [provider, architecture] = await Promise.all([
    runProviderContractGuard({ emit: false }),
    runArchitectureCheck(root, { emit: false }),
  ]);
  return { provider, architecture, failures: [...provider.failures, ...architecture.violations] as GuardFailure[] };
}

export async function runRegisteredGuards(root: string): Promise<GuardFailure[]> {
  return (await runRegisteredGuardSnapshot(root)).failures;
}
