import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { DocumentRepository } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import {
  approveDatabaseDecision,
  approveDependencyProposal,
  approvePhase7CContractPackage,
  createPlanningAcceptance,
  validatePhase7CContractPackage,
  type DatabaseMode,
  type Phase7CContractPackage,
} from "@/domain/contracts/phase7c";
import { Phase7CContractError } from "@/domain/contracts/phase7c";

export class Phase7CContractService {
  private readonly documents: DocumentRepository;

  constructor(database: PersistenceDatabase) {
    this.documents = new DocumentRepository(database);
  }

  async get(projectId: string, projectVersion: number) {
    const document = await this.documents.get(projectId, projectVersion, "phase-7c-contract-package");
    if (!document || document.documentType !== "phase-7c-contract-package") throw new Phase7CContractError("CONTRACT_PACKAGE_INVALID", "The Phase 7C contract package is not persisted.");
    return validatePhase7CContractPackage(document);
  }

  private assertCurrent(pkg: Phase7CContractPackage, expectedChecksum: string) {
    if (checksumPersistedDocument(pkg) !== expectedChecksum) throw new Phase7CContractError("CONTRACT_PACKAGE_STALE", "The Phase 7C package changed before the user decision was applied.");
  }

  async approveDatabase(input: { projectId: string; projectVersion: number; expectedPackageChecksum: string; mode: DatabaseMode; actorId: string; approvedAt: string; reason?: string; idempotencyKey?: string }) {
    const pkg = await this.get(input.projectId, input.projectVersion);
    this.assertCurrent(pkg, input.expectedPackageChecksum);
    const databaseDecision = approveDatabaseDecision(pkg.databaseDecision, { actorId: input.actorId, approvedAt: input.approvedAt, mode: input.mode, reason: input.reason });
    const planningAcceptance = createPlanningAcceptance({ projectId: pkg.projectId, projectVersion: pkg.projectVersion, planningChecksum: pkg.planningChecksum, databaseDecision, dependencyProposal: pkg.dependencyProposal, architectureChecksum: pkg.architectureChecksum, designChecksum: pkg.designChecksum, createdAt: pkg.createdAt });
    const next = validatePhase7CContractPackage({ ...pkg, databaseDecision, planningAcceptance, safeEnvironmentMetadata: databaseDecision.connectionRequirements, status: "PENDING_USER_APPROVAL", updatedAt: input.approvedAt });
    return this.documents.save(next, input.idempotencyKey);
  }

  async approveDependencies(input: { projectId: string; projectVersion: number; expectedPackageChecksum: string; actorId: string; approvedAt: string; idempotencyKey?: string }) {
    const pkg = await this.get(input.projectId, input.projectVersion);
    this.assertCurrent(pkg, input.expectedPackageChecksum);
    const dependencyProposal = approveDependencyProposal(pkg.dependencyProposal, { actorId: input.actorId, approvedAt: input.approvedAt });
    const planningAcceptance = createPlanningAcceptance({ projectId: pkg.projectId, projectVersion: pkg.projectVersion, planningChecksum: pkg.planningChecksum, databaseDecision: pkg.databaseDecision, dependencyProposal, architectureChecksum: pkg.architectureChecksum, designChecksum: pkg.designChecksum, createdAt: pkg.createdAt });
    const next = validatePhase7CContractPackage({ ...pkg, dependencyProposal, planningAcceptance, status: "PENDING_USER_APPROVAL", updatedAt: input.approvedAt });
    return this.documents.save(next, input.idempotencyKey);
  }

  async approvePlanning(input: { projectId: string; projectVersion: number; expectedPackageChecksum: string; actorId: string; approvedAt: string; idempotencyKey?: string }) {
    const pkg = await this.get(input.projectId, input.projectVersion);
    this.assertCurrent(pkg, input.expectedPackageChecksum);
    const next = approvePhase7CContractPackage(pkg, { actorId: input.actorId, approvedAt: input.approvedAt });
    return this.documents.save(next, input.idempotencyKey);
  }
}
