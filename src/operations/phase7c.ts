import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { DocumentRepository, saveDocumentCASInTransaction } from "@/persistence/database/repositories";
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
import { planningSemanticChecksum } from "@/agents/planner/deterministic";

export class Phase7CContractService {
  private readonly documents: DocumentRepository;

  constructor(private readonly database: PersistenceDatabase) {
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
    const current = await this.documents.getWithMetadata(input.projectId, input.projectVersion, "phase-7c-contract-package");
    if (!current || current.document.documentType !== "phase-7c-contract-package") throw new Phase7CContractError("CONTRACT_PACKAGE_INVALID", "The Phase 7C contract package is not persisted.");
    const pkg = validatePhase7CContractPackage(current.document);
    this.assertCurrent(pkg, input.expectedPackageChecksum);
    const [planning, architecture, architectureReview, selected, audit] = await Promise.all([
      this.documents.get(input.projectId, input.projectVersion, "planning-package"),
      this.documents.get(input.projectId, input.projectVersion, "architecture"),
      this.documents.get(input.projectId, input.projectVersion, "architecture-review"),
      this.documents.get(input.projectId, input.projectVersion, "selected-design"),
      this.documents.get(input.projectId, input.projectVersion, "contract-audit"),
    ]);
    const selectedChecksum = selected ? checksumPersistedDocument(selected) : undefined;
    if (!planning || planning.documentType !== "planning-package" || planningSemanticChecksum(planning) !== pkg.planningChecksum) throw new Phase7CContractError("PLANNING_ACCEPTANCE_STALE", "The persisted Planning package is not current for this Phase 7C approval.");
    if (!architecture || architecture.documentType !== "architecture" || !architecture.acceptance.accepted || checksumPersistedDocument(architecture) !== pkg.architectureChecksum) throw new Phase7CContractError("PLANNING_ACCEPTANCE_STALE", "The approved Architecture is not current for this Phase 7C approval.");
    if (!architectureReview || architectureReview.documentType !== "architecture-review" || architectureReview.result.verdict !== "APPROVED" || architectureReview.approvedBriefChecksum !== pkg.approvedBriefChecksum || architectureReview.acceptedPlanningChecksum !== checksumPersistedDocument(planning)) throw new Phase7CContractError("PLANNING_ACCEPTANCE_STALE", "The approved Architecture Review is not current for this Phase 7C approval.");
    if (!selected || selected.documentType !== "selected-design" || !selectedChecksum) throw new Phase7CContractError("PLANNING_ACCEPTANCE_STALE", "The selected Design is not current for this Phase 7C approval.");
    if (!audit || audit.documentType !== "contract-audit" || audit.result.verdict !== "APPROVED" || audit.briefChecksum !== pkg.approvedBriefChecksum || audit.planningChecksum !== checksumPersistedDocument(planning) || audit.designChecksum !== selectedChecksum) throw new Phase7CContractError("PLANNING_ACCEPTANCE_STALE", "The approved Contract Audit is not current for this Phase 7C approval.");
    const approved = approvePhase7CContractPackage(pkg, { actorId: input.actorId, approvedAt: input.approvedAt });
    const next = validatePhase7CContractPackage({ ...approved, designChecksum: selectedChecksum, architectureAccepted: true, contractAuditAccepted: true, designSelected: true });
    return this.database.transaction((tx) => saveDocumentCASInTransaction(tx, next, current.rowVersion, current.checksum));
  }
}
