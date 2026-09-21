import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  SkillAuditEventSchema,
  SkillApplicabilitySchema,
  SkillApprovalRecordSchema,
  SkillCurationEvidenceSchema,
  SkillDefinitionSchema,
  SkillLoadRequestSchema,
  SkillManifestSchema,
  SkillSourceRecordSchema,
  type SkillApprovalRecord,
  type SkillDefinition,
  type SkillLoadRequest,
  type SkillAuditEvent,
} from "./contracts";
import { SkillError } from "./errors";
import { readDirectory } from "@/runtime/filesystem/directory";
import {
  DEFAULT_SKILL_POLICY,
  SkillPolicySchema,
  type SkillPolicy,
} from "./policy";
import { parseSkillMarkdown } from "./parser";
import { reviewSkill, type SkillReview } from "./review";
import type { SkillFile } from "./types";

const now = () => new Date().toISOString();
const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const safeSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "skill";
export const safeSkillRelativePath = (value: string) => {
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    normalized.split("/").includes("..") ||
    normalized.includes("\0")
    || normalized.split("/").some((part) => !part || part === ".")
  )
    throw new SkillError("SKILL_PATH_INVALID", "Skill file path is unsafe.");
  if (
    normalized
      .split("/")
      .some((part) =>
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part),
      )
  )
    throw new SkillError(
      "SKILL_PATH_INVALID",
      "Skill file path uses a reserved name.",
    );
  return normalized;
};
const safePath = safeSkillRelativePath;
const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";
const RecordSchema = z
  .object({
    definition: SkillDefinitionSchema,
    source: SkillSourceRecordSchema,
    review: z.unknown(),
    curationEvidence: SkillCurationEvidenceSchema.optional(),
    approval: SkillApprovalRecordSchema.optional(),
    approvedDirectory: z.string().optional(),
    stagedDirectory: z.string(),
    idempotencyKey: z.string().optional(),
  })
  .strict();
type RegistryRecord = z.infer<typeof RecordSchema>;
export type SkillLoadResult = {
  metadata: SkillDefinition;
  skillMarkdown: string;
  references: Array<{ relativePath: string; content: string }>;
  scripts: Array<{
    relativePath: string;
    sha256: string;
    interpreter?: string;
    riskLevel: string;
    requiresExplicitExecutionApproval: true;
  }>;
  permissionSummary: { role: string; taskType: string; tools: string[] };
  citation: { skillId: string; version: string; sourceChecksum: string };
};

export class SkillRegistry {
  readonly root: string;
  readonly policy: SkillPolicy;
  constructor(root: string, policy = DEFAULT_SKILL_POLICY) {
    this.root = path.resolve(root);
    this.policy = SkillPolicySchema.parse(policy);
  }
  private dir(name: "staging" | "approved" | "rejected" | "registry") {
    return path.join(this.root, name);
  }
  private recordPath(id: string) {
    return path.join(this.dir("registry"), `${id}.json`);
  }
  private async initialize() {
    for (const name of ["staging", "approved", "rejected", "registry"] as const)
      await mkdir(this.dir(name), { recursive: true });
  }
  private async atomic(target: string, content: string) {
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, content, { flag: "wx", mode: 0o600 });
    try {
      const handle = await open(temp, constants.O_RDWR);
      await handle.sync();
      await handle.close();
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
  private async audit(event: Omit<SkillAuditEvent, "id" | "timestamp">) {
    await mkdir(this.dir("registry"), { recursive: true });
    const line = `${JSON.stringify(SkillAuditEventSchema.parse({ ...event, id: randomUUID(), timestamp: now() }))}\n`;
    const target = path.join(this.dir("registry"), "audit.jsonl");
    let previous = "";
    try {
      previous = await readFile(target, "utf8");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await this.atomic(target, previous + line);
  }
  private async save(record: RegistryRecord) {
    await this.atomic(
      this.recordPath(record.definition.id),
      JSON.stringify(record, null, 2) + "\n",
    );
  }
  private async read(id: string) {
    try {
      return RecordSchema.parse(
        JSON.parse(await readFile(this.recordPath(id), "utf8")),
      );
    } catch (error) {
      if (isMissing(error))
        throw new SkillError("SKILL_NOT_FOUND", "Skill was not found.");
      if (error instanceof z.ZodError)
        throw new SkillError(
          "SKILL_SOURCE_INVALID",
          "Registry record is invalid.",
        );
      throw error;
    }
  }
  private classify(relativePath: string): SkillFile["kind"] {
    if (relativePath === "SKILL.md") return "entry";
    if (relativePath.startsWith("references/")) return "reference";
    if (relativePath.startsWith("scripts/")) return "script";
    if (relativePath.startsWith("templates/")) return "template";
    return "other";
  }
  private async scan(source: string): Promise<SkillFile[]> {
    const files: SkillFile[] = [];
    const walk = async (current: string, relative: string) => {
      for (const entry of await readDirectory(current)) {
        const rel = safePath(
          relative ? `${relative}/${entry.name}` : entry.name,
        );
        const full = path.join(current, entry.name);
        const info = await lstat(full);
        if (info.isSymbolicLink())
          throw new SkillError(
            "SKILL_SOURCE_INVALID",
            "Symbolic links are not accepted in skill imports.",
          );
        if (info.isDirectory()) {
          if ([".git", "node_modules"].includes(entry.name))
            throw new SkillError(
              "SKILL_SOURCE_INVALID",
              "Dependency and VCS directories are not accepted.",
            );
          await walk(full, rel);
          continue;
        }
        if (!info.isFile())
          throw new SkillError(
            "SKILL_SOURCE_INVALID",
            "Device files and special files are not accepted.",
          );
        if (files.length >= this.policy.maxFileCount)
          throw new SkillError(
            "SKILL_LIMIT_EXCEEDED",
            "Skill file-count limit was exceeded.",
          );
        if (info.size > this.policy.maxIndividualFileBytes)
          throw new SkillError(
            "SKILL_LIMIT_EXCEEDED",
            "Skill individual-file limit was exceeded.",
          );
        const bytes = await readFile(full);
        if (bytes.includes(0) || /\.(zip|tar|gz|7z|rar)$/i.test(rel))
          throw new SkillError(
            "SKILL_SOURCE_INVALID",
            "Binary archives are not accepted.",
          );
        const kind = this.classify(rel);
        if (kind !== "script" && /\.(?:exe|com|bat|cmd|ps1|sh|dll)$/i.test(rel))
          throw new SkillError(
            "SKILL_SOURCE_INVALID",
            "Executable files are only permitted under scripts/.",
          );
        if (
          this.policy.prohibitedFilePatterns.some((pattern) =>
            new RegExp(pattern, "i").test(rel),
          )
        )
          throw new SkillError(
            "SKILL_SOURCE_INVALID",
            "The skill contains a prohibited credential or dependency path.",
          );
        files.push({
          relativePath: rel,
          sha256: digest(bytes),
          byteSize: info.size,
          kind,
          executable: kind === "script",
          text: bytes.toString("utf8"),
        });
      }
    };
    await walk(source, "");
    if (!files.some((file) => file.relativePath === "SKILL.md"))
      throw new SkillError(
        "SKILL_SOURCE_INVALID",
        "Skill import requires SKILL.md.",
      );
    const total = files.reduce((sum, file) => sum + file.byteSize, 0);
    if (total > this.policy.maxTotalBytes)
      throw new SkillError(
        "SKILL_LIMIT_EXCEEDED",
        "Skill total-size limit was exceeded.",
      );
    return files;
  }
  private async copyFiles(
    source: string,
    destination: string,
    files: SkillFile[],
  ) {
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.copy`;
    await mkdir(temporary, { recursive: true });
    try {
      for (const file of files) {
        const relative = safeSkillRelativePath(file.relativePath);
        const target = path.join(temporary, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(
          target,
          await readFile(path.join(source, relative)),
          { flag: "wx", mode: 0o600 },
        );
        if (file.executable) await chmod(target, 0o600);
      }
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  async stageLocalImport(
    sourcePath: string,
    options: {
      idempotencyKey?: string;
      sourceType?:
        | "local-manual-import"
        | "git-repository"
        | "skills-sh"
        | "internal";
      skillId?: string;
      displayName?: string;
      version?: string;
      license?: string;
      sourceRepository?: string;
      sourceCommit?: string;
      sourceTag?: string;
      reviewer?: string;
      externalSkillId?: string;
      provenance?: "ai-website-factory-project-owned";
      canonicalSourceRef?: string;
      retrievedContentChecksum?: string;
      normalizedContentChecksum?: string;
    } = {},
  ) {
    await this.initialize();
    const source = path.resolve(sourcePath);
    let info;
    try {
      info = await lstat(source);
    } catch (error) {
      throw new SkillError(
        "SKILL_SOURCE_INVALID",
        "The explicit skill source does not exist.",
        undefined,
        error,
      );
    }
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new SkillError(
        "SKILL_SOURCE_INVALID",
        "The explicit skill source must be a directory.",
      );
    if (
      options.sourceType === "internal" &&
      (options.provenance !== "ai-website-factory-project-owned" ||
        options.sourceRepository ||
        options.externalSkillId ||
        options.canonicalSourceRef ||
        options.retrievedContentChecksum ||
        options.normalizedContentChecksum)
    )
      throw new SkillError(
        "SKILL_SOURCE_INVALID",
        "Internal skills cannot carry external provenance fields.",
      );
    try {
      const entry = await lstat(path.join(source, "SKILL.md"));
      if (!entry.isFile() || entry.isSymbolicLink()) throw new SkillError("SKILL_SOURCE_INVALID", "Skill import requires a regular root SKILL.md file.");
    } catch (error) {
      if (error instanceof SkillError) throw error;
      throw new SkillError("SKILL_SOURCE_INVALID", "Skill import requires a regular root SKILL.md file.", undefined, error);
    }
    const files = await this.scan(source);
    const manifestFiles = files.map(
      ({ relativePath, sha256, byteSize, kind, executable }) => ({
        relativePath,
        sha256,
        byteSize,
        kind,
        executable,
      }),
    );
    const manifestChecksum = digest(JSON.stringify(manifestFiles));
    const existing = options.idempotencyKey
      ? await this.findIdempotency(options.idempotencyKey)
      : undefined;
    if (existing) {
      if (existing.manifestChecksum !== manifestChecksum)
        throw new SkillError(
          "SKILL_IDEMPOTENCY_CONFLICT",
          "The import idempotency key was reused with different content.",
        );
      return this.read(existing.skillId);
    }
    const markdown =
      files.find((file) => file.relativePath === "SKILL.md")?.text ?? "";
    const summary = parseSkillMarkdown(markdown);
    const slug = safeSlug(
      options.displayName ?? summary.title ?? path.basename(source),
    );
    if (
      options.skillId &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.skillId)
    )
      throw new SkillError(
        "SKILL_SOURCE_INVALID",
        "The authored skill ID must be lowercase, stable, and language-independent.",
      );
    const id = options.skillId ?? `${slug}-${manifestChecksum.slice(0, 12)}`;
    if (options.skillId) {
      try {
        await this.read(id);
        throw new SkillError(
          "SKILL_IDEMPOTENCY_CONFLICT",
          "The authored skill ID already exists in the registry.",
        );
      } catch (error) {
        if (!(error instanceof SkillError) || error.code !== "SKILL_NOT_FOUND")
          throw error;
      }
    }
    const operation = `${id}-${randomUUID()}`;
    const staged = path.join(this.dir("staging"), operation);
    await this.copyFiles(source, staged, files);
    const review = reviewSkill(files, this.policy, summary.unresolved);
    const definition = SkillDefinitionSchema.parse({
      id,
      slug,
      displayName: options.displayName ?? summary.title ?? slug,
      description: summary.description ?? "",
      version: options.version ?? "0.1.0",
      formatVersion: 1,
      sourceType: options.sourceType ?? "local-manual-import",
      sourceRepository: options.sourceRepository,
      sourceCommit: options.sourceCommit,
      sourceTag: options.sourceTag,
      sourceChecksum: manifestChecksum,
      license: options.license,
      importedAt: now(),
      status: "under-review",
      riskLevel: review.riskLevel,
      allowedRoles: [],
      allowedTaskTypes: [],
      requiredTools: [],
      forbiddenTools: [],
      entryFile: "SKILL.md",
      referenceFiles: files
        .filter((file) => file.kind === "reference")
        .map((file) => file.relativePath),
      scriptFiles: files
        .filter((file) => file.kind === "script")
        .map((file) => file.relativePath),
      templateFiles: files
        .filter((file) => file.kind === "template")
        .map((file) => file.relativePath),
      maxContextBytes: this.policy.maxContextBytes,
      maxReferenceFilesPerLoad: this.policy.maxReferenceFilesPerLoad,
      manifest: SkillManifestSchema.parse({
        schemaVersion: 1,
        skillId: id,
        sourceChecksum: manifestChecksum,
        files: manifestFiles,
        totalBytes: files.reduce((sum, file) => sum + file.byteSize, 0),
        createdAt: now(),
      }),
      summary,
    });
    const record: RegistryRecord = {
      definition,
      source: SkillSourceRecordSchema.parse({
        sourceType: definition.sourceType,
        repositoryUrl: options.sourceRepository,
        commitSha: options.sourceCommit,
        tag: options.sourceTag,
        importedAt: definition.importedAt,
        sourceChecksum: manifestChecksum,
        fileManifestChecksum: manifestChecksum,
        originalSkillName: definition.displayName,
        externalSkillId: options.externalSkillId,
        provenance: options.provenance,
        canonicalSourceRef: options.canonicalSourceRef,
        retrievedContentChecksum: options.retrievedContentChecksum,
        normalizedContentChecksum: options.normalizedContentChecksum,
      }),
      review,
      stagedDirectory: staged,
      idempotencyKey: options.idempotencyKey,
    };
    await this.save(record);
    if (options.idempotencyKey)
      await this.atomic(
        path.join(
          this.dir("registry"),
          `idempotency-${digest(options.idempotencyKey)}.json`,
        ),
        JSON.stringify({
          key: options.idempotencyKey,
          skillId: id,
          manifestChecksum,
        }) + "\n",
      );
    await this.audit({
      skillId: id,
      sourceChecksum: manifestChecksum,
      actor: options.reviewer ?? "local-user",
      action: "import-staged",
      summary: "Local skill import staged for review.",
    });
    await this.audit({
      skillId: id,
      sourceChecksum: manifestChecksum,
      actor: options.reviewer ?? "local-user",
      action: "review-started",
      summary: "Deterministic static review completed.",
    });
    return record;
  }
  private async findIdempotency(
    key: string,
  ): Promise<{ skillId: string; manifestChecksum: string } | undefined> {
    try {
      return JSON.parse(
        await readFile(
          path.join(this.dir("registry"), `idempotency-${digest(key)}.json`),
          "utf8",
        ),
      ) as { skillId: string; manifestChecksum: string };
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }
  async getReview(skillId: string) {
    const record = await this.read(skillId);
    return record.review as SkillReview;
  }
  async recordCurationEvidence(
    skillId: string,
    input: {
      evidence: z.input<typeof SkillCurationEvidenceSchema>;
      expectedExternalSkillId: string;
      expectedNormalizedChecksum: string;
      expectedSourceRepository: string;
    },
  ) {
    const record = await this.read(skillId);
    const evidence = SkillCurationEvidenceSchema.parse(input.evidence);
    const license = evidence.license;
    if (
      record.source.externalSkillId !== input.expectedExternalSkillId ||
      license.externalSkillId !== input.expectedExternalSkillId ||
      license.candidateChecksum !== input.expectedNormalizedChecksum ||
      record.source.normalizedContentChecksum !== input.expectedNormalizedChecksum ||
      license.sourceRepository !== input.expectedSourceRepository ||
      license.sourceRef !== `https://github.com/${input.expectedSourceRepository}`
    )
      throw new SkillError(
        "SKILL_CHECKSUM_MISMATCH",
        "Curation evidence does not match the exact staged candidate provenance.",
      );
    if (evidence.metadata.unresolved.length)
      throw new SkillError(
        "SKILL_APPROVAL_REQUIRED",
        "Curation metadata remains unresolved.",
      );
    if (record.curationEvidence) {
      if (JSON.stringify(record.curationEvidence) !== JSON.stringify(evidence))
        throw new SkillError(
          "SKILL_IMMUTABLE",
          "Existing curation evidence cannot be overwritten.",
        );
      return record;
    }
    const next: RegistryRecord = {
      ...record,
      curationEvidence: evidence,
      source: {
        ...record.source,
        licenseEvidenceRecord: license,
      },
      definition: {
        ...record.definition,
        license: license.assertedValue,
      },
      review: {
        ...(record.review as SkillReview),
        metadataUnresolved: [],
      },
    };
    await this.save(next);
    await this.audit({
      skillId,
      sourceChecksum: record.definition.sourceChecksum,
      actor: license.suppliedBy,
      action: "evidence-recorded",
      summary:
        "Checksum-bound human curation evidence recorded; approval remains separate.",
    });
    return next;
  }
  async recordInternalApprovalEvidence(
    skillId: string,
    input: {
      version: string;
      normalizedContentChecksum: string;
      provenance: "ai-website-factory-project-owned";
    },
  ) {
    const record = await this.read(skillId);
    if (
      record.source.sourceType !== "internal" ||
      record.definition.version !== input.version ||
      record.source.externalSkillId !== undefined ||
      record.source.repositoryUrl !== undefined
    )
      throw new SkillError(
        "SKILL_SOURCE_INVALID",
        "Internal approval evidence does not match first-party provenance.",
      );
    if (
      (record.source.normalizedContentChecksum !== undefined &&
        record.source.normalizedContentChecksum !== input.normalizedContentChecksum) ||
      (record.source.provenance !== undefined &&
        record.source.provenance !== input.provenance)
    )
      throw new SkillError(
        "SKILL_CHECKSUM_MISMATCH",
        "Internal approval evidence does not match the exact staged artifact.",
      );
    const next: RegistryRecord = {
      ...record,
      source: {
        ...record.source,
        provenance: input.provenance,
        normalizedContentChecksum: input.normalizedContentChecksum,
      },
    };
    await this.save(next);
    await this.audit({
      skillId,
      sourceChecksum: record.definition.sourceChecksum,
      actor: "phase-4d4",
      action: "evidence-recorded",
      summary:
        "First-party checksum and provenance evidence recorded; approval remains separate.",
    });
    return next;
  }
  async createApproval(
    skillId: string,
    input: Omit<
      SkillApprovalRecord,
      | "skillId"
      | "sourceChecksum"
      | "manifestChecksum"
      | "approvedFiles"
      | "excludedFiles"
      | "maxContextBytes"
    > & {
      allowedFiles?: string[];
      excludedFiles?: string[];
      maxContextBytes?: number;
      applicability?: z.input<typeof SkillApplicabilitySchema>;
    },
  ) {
    const record = await this.read(skillId);
    const review = record.review as SkillReview;
    if (review.findings.some((finding) => finding.approvalBlocker))
      throw new SkillError(
        "SKILL_REVIEW_BLOCKED",
        "Critical static review findings block approval.",
      );
    if (
      review.metadataUnresolved.length ||
      (record.source.sourceType !== "internal" && !record.definition.license)
    )
      throw new SkillError(
        "SKILL_APPROVAL_REQUIRED",
        "Manual metadata and explicit license evidence are required before approval.",
      );
    if (
      record.curationEvidence?.license.licensePolicyStatus !== undefined &&
      record.curationEvidence.license.licensePolicyStatus !==
        "LICENSE_ALLOWED_FOR_FACTORY_USE"
    )
      throw new SkillError(
        "SKILL_APPROVAL_REQUIRED",
        "The asserted license requires explicit Factory license-policy review before approval.",
      );
    if (
      input.candidateChecksum &&
      input.candidateChecksum !== record.source.normalizedContentChecksum
    )
      throw new SkillError(
        "SKILL_CHECKSUM_MISMATCH",
        "Approval candidate checksum does not match staged provenance.",
      );
    if (
      record.source.sourceType === "internal" &&
      (input.candidateChecksum === undefined ||
        input.approvedVersion !== record.definition.version)
    )
      throw new SkillError(
        "SKILL_CHECKSUM_MISMATCH",
        "Internal approval must bind the exact version and normalized checksum.",
      );
    const allowedFiles = (input.allowedFiles ??
      record.definition.manifest.files.map((file) => file.relativePath)).map(
      safeSkillRelativePath,
    );
    const excludedFiles = (input.excludedFiles ?? []).map(safeSkillRelativePath);
    const manifestFiles = new Set(record.definition.manifest.files.map((file) => file.relativePath));
    for (const relativePath of [...allowedFiles, ...excludedFiles]) {
      if (!manifestFiles.has(relativePath))
        throw new SkillError("SKILL_PATH_INVALID", "Approval file selections must be safe paths from the staged manifest.");
    }
    const approval = SkillApprovalRecordSchema.parse({
      ...input,
      id: input.id,
      skillId,
      sourceChecksum: record.definition.sourceChecksum,
      manifestChecksum: digest(
        JSON.stringify(record.definition.manifest.files),
      ),
      approvedFiles: allowedFiles,
      excludedFiles,
      maxContextBytes:
        input.maxContextBytes ?? record.definition.maxContextBytes,
      ...(input.applicability
        ? { applicability: SkillApplicabilitySchema.parse(input.applicability) }
        : {}),
    });
    if (
      approval.decision === "approved" &&
      review.riskLevel === "high" &&
      (!approval.allowedRoles.length ||
        !approval.allowedTaskTypes.length ||
        !approval.allowedTools.length)
    )
      throw new SkillError(
        "SKILL_APPROVAL_REQUIRED",
        "High-risk skills require narrowed roles, tasks, and tools.",
      );
    const next: RegistryRecord = {
      ...record,
      approval,
      definition: {
        ...record.definition,
        status:
          approval.decision === "approved"
            ? "approved"
            : approval.decision === "rejected"
              ? "rejected"
              : record.definition.status,
        reviewedAt: approval.reviewedAt,
        reviewer: approval.reviewedBy,
        approvalRecordId: approval.id,
        ...(approval.applicability
          ? { applicability: approval.applicability }
          : {}),
      },
    };
    await this.save(next);
    await this.audit({
      skillId,
      sourceChecksum: record.definition.sourceChecksum,
      actor: approval.reviewedBy,
      action:
        approval.decision === "approved" ? "approval-requested" : "rejected",
      summary: `Manual approval decision recorded: ${approval.decision}.`,
      approvalId: approval.id,
    });
    return approval;
  }
  async promoteApproved(skillId: string) {
    const record = await this.read(skillId);
    const approval = record.approval;
    if (!approval || approval.decision !== "approved")
      throw new SkillError(
        "SKILL_APPROVAL_REQUIRED",
        "An approved manual approval record is required.",
      );
    if (
      approval.sourceChecksum !== record.definition.sourceChecksum ||
      (approval.candidateChecksum &&
        approval.candidateChecksum !== record.source.normalizedContentChecksum) ||
      approval.manifestChecksum !==
        digest(JSON.stringify(record.definition.manifest.files))
    )
      throw new SkillError(
        "SKILL_CHECKSUM_MISMATCH",
        "Approval does not match the staged source manifest.",
      );
    const short = record.definition.sourceChecksum.slice(0, 12);
    const destination = path.join(
      this.dir("approved"),
      record.definition.slug,
      `${record.definition.version}-${short}`,
    );
    if (await this.exists(destination))
      throw new SkillError(
        "SKILL_IMMUTABLE",
        "The approved skill copy already exists and cannot be overwritten.",
      );
    await this.copyFiles(
      record.stagedDirectory,
      destination,
      record.definition.manifest.files
        .filter((file) => approval.approvedFiles.includes(file.relativePath))
        .map((file) => ({ ...file, text: undefined })),
    );
    const approvedManifest = {
      ...record.definition.manifest,
      createdAt: now(),
    };
    await this.atomic(
      path.join(destination, "manifest.json"),
      JSON.stringify(approvedManifest, null, 2) + "\n",
    );
    const next: RegistryRecord = {
      ...record,
      approvedDirectory: destination,
      definition: {
        ...record.definition,
        status: "approved",
        approvedAt: now(),
        allowedRoles: approval.allowedRoles,
        allowedTaskTypes: approval.allowedTaskTypes,
        maxContextBytes: approval.maxContextBytes,
        ...(approval.applicability
          ? { applicability: approval.applicability }
          : {}),
      },
    };
    await this.save(next);
    await this.audit({
      skillId,
      sourceChecksum: record.definition.sourceChecksum,
      actor: approval.reviewedBy,
      action: "approved",
      summary: "Approved immutable copy promoted.",
      approvalId: approval.id,
    });
    return next;
  }
  async revoke(
    skillId: string,
    actor = "local-user",
    notes = "Revoked by administrator",
  ) {
    const record = await this.read(skillId);
    const next = {
      ...record,
      definition: { ...record.definition, status: "revoked" as const, notes },
    };
    await this.save(next);
    await this.audit({
      skillId,
      sourceChecksum: record.definition.sourceChecksum,
      actor,
      action: "revoked",
      summary: "Skill loading revoked; immutable history preserved.",
      approvalId: record.approval?.id,
    });
    return next.definition;
  }
  async getRuntimeMetadata(skillId: string) {
    const record = await this.read(skillId);
    return {
      definition: record.definition,
      approval: record.approval,
      normalizedContentChecksum: record.source.normalizedContentChecksum,
      retrievedContentChecksum: record.source.retrievedContentChecksum,
    };
  }
  async load(request: SkillLoadRequest): Promise<SkillLoadResult> {
    const parsed = SkillLoadRequestSchema.parse(request);
    const record = await this.read(parsed.skillId);
    const deny = async (
      code:
        | "SKILL_NOT_APPROVED"
        | "SKILL_REVOKED"
        | "SKILL_SUPERSEDED"
        | "SKILL_ROLE_NOT_ALLOWED"
        | "SKILL_TASK_NOT_ALLOWED"
        | "SKILL_TOOL_NOT_ALLOWED"
        | "SKILL_NOT_ALLOWED_FOR_AGENT"
        | "SKILL_CONTEXT_LIMIT_EXCEEDED"
        | "SKILL_CHECKSUM_MISMATCH"
        | "SKILL_PATH_INVALID",
      message: string,
    ): Promise<never> => {
      await this.audit({
        skillId: parsed.skillId,
        sourceChecksum: record.definition.sourceChecksum,
        actor: "loader",
        action: "load-denied",
        summary: message,
        role: parsed.role,
        taskType: parsed.taskType,
        approvalId: record.approval?.id,
      });
      throw new SkillError(code, message);
    };
    if (record.definition.status === "revoked")
      return deny("SKILL_REVOKED", "Skill is revoked.");
    if (record.definition.status === "superseded")
      return deny("SKILL_SUPERSEDED", "Skill is superseded.");
    if (
      record.definition.status !== "approved" ||
      !record.approvedDirectory ||
      !record.approval
    )
      return deny("SKILL_NOT_APPROVED", "Skill is not approved.");
    const approval = record.approval;
    if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now())
      return deny("SKILL_NOT_APPROVED", "Skill approval has expired.");
    if (parsed.allowedSkillIds && !parsed.allowedSkillIds.includes(record.definition.id))
      return deny(
        "SKILL_NOT_ALLOWED_FOR_AGENT",
        "The skill is not explicitly allowed by the agent definition.",
      );
    if (!approval.allowedRoles.includes(parsed.role))
      return deny(
        "SKILL_ROLE_NOT_ALLOWED",
        "Role is not allowed for this skill.",
      );
    if (!approval.allowedTaskTypes.includes(parsed.taskType))
      return deny(
        "SKILL_TASK_NOT_ALLOWED",
        "Task type is not allowed for this skill.",
      );
    if (
      parsed.requestedTools.some(
        (tool) =>
          !approval.allowedTools.includes(tool) ||
          approval.deniedTools.includes(tool),
      )
    )
      return deny("SKILL_TOOL_NOT_ALLOWED", "Requested tool is not allowed.");
    let requestedFiles: string[];
    try {
      requestedFiles = parsed.requestedFiles.map((relativePath) => safeSkillRelativePath(relativePath));
    } catch (error) {
      return deny("SKILL_PATH_INVALID", error instanceof SkillError ? error.message : "Requested skill file path is unsafe.");
    }
    const files = record.definition.manifest.files;
    const manifestFiles = new Set(files.map((file) => file.relativePath));
    const approvedFiles = new Set(approval.approvedFiles);
    if (requestedFiles.some((relativePath) => !manifestFiles.has(relativePath) || !approvedFiles.has(relativePath)))
      return deny("SKILL_PATH_INVALID", "Requested skill files must be explicitly present in the approved manifest and file allowlist.");
    if (!approvedFiles.has("SKILL.md"))
      return deny("SKILL_PATH_INVALID", "Approved skill loading requires the approved SKILL.md entry file.");
    const manifest = await this.readApprovedManifest(record);
    if (manifest.sourceChecksum !== record.definition.sourceChecksum)
      return deny("SKILL_CHECKSUM_MISMATCH", "Approved source checksum no longer matches.");
    const selected = requestedFiles.length
      ? files.filter((file) =>
          requestedFiles.includes(file.relativePath),
        )
      : files.filter((file) => file.kind === "reference" && approvedFiles.has(file.relativePath));
    const contents: Array<{ relativePath: string; content: string }> = [];
    let total = 0;
    const entry = await this.readApprovedText(record, "SKILL.md");
    const entryContent = parsed.requestedSections.length
      ? entry
          .split(/\r?\n/)
          .filter((line) =>
            parsed.requestedSections.some((section) =>
              line.toLowerCase().includes(section.toLowerCase()),
            ),
          )
          .join("\n")
      : entry;
    total += Buffer.byteLength(entryContent);
    if (total > parsed.contextBudgetBytes || total > approval.maxContextBytes)
      return deny(
        "SKILL_CONTEXT_LIMIT_EXCEEDED",
        "Requested skill context exceeds the configured limit.",
      );
    for (const file of selected
      .filter((item) => item.kind === "reference")
      .slice(0, record.definition.maxReferenceFilesPerLoad)) {
      const content = await this.readApprovedText(record, file.relativePath);
      total += Buffer.byteLength(content);
      if (total > parsed.contextBudgetBytes || total > approval.maxContextBytes)
        return deny(
          "SKILL_CONTEXT_LIMIT_EXCEEDED",
          "Requested skill context exceeds the configured limit.",
        );
      contents.push({ relativePath: file.relativePath, content });
    }
    await this.audit({
      skillId: parsed.skillId,
      sourceChecksum: record.definition.sourceChecksum,
      actor: "loader",
      action: "load-permitted",
      summary: "Approved skill content loaded within policy limits.",
      role: parsed.role,
      taskType: parsed.taskType,
      approvalId: approval.id,
    });
    return {
      metadata: record.definition,
      skillMarkdown: entryContent,
      references: contents.sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath),
      ),
      scripts: files
        .filter((file) => file.kind === "script" && approvedFiles.has(file.relativePath))
        .map((file) => ({
          relativePath: file.relativePath,
          sha256: file.sha256,
          interpreter: "declared-by-review",
          riskLevel: record.definition.riskLevel,
          requiresExplicitExecutionApproval: true as const,
        })),
      permissionSummary: {
        role: parsed.role,
        taskType: parsed.taskType,
        tools: approval.allowedTools,
      },
      citation: {
        skillId: record.definition.id,
        version: record.definition.version,
        sourceChecksum: record.definition.sourceChecksum,
      },
    };
  }
  private async approvedRoot(record: RegistryRecord) {
    const approvedDirectory = record.approvedDirectory;
    if (!approvedDirectory) throw new SkillError("SKILL_CHECKSUM_MISMATCH", "Approved skill directory is missing.");
    const root = path.resolve(this.dir("approved"));
    const candidate = path.resolve(approvedDirectory);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new SkillError("SKILL_PATH_INVALID", "Approved skill directory escapes the approved registry.");
    const info = await lstat(candidate);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new SkillError("SKILL_CHECKSUM_MISMATCH", "Approved skill directory is not a regular directory.");
    return candidate;
  }
  private async approvedFilePath(record: RegistryRecord, relativePath: string) {
    const root = await this.approvedRoot(record);
    const safe = safeSkillRelativePath(relativePath);
    let current = root;
    const parts = safe.split("/");
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new SkillError("SKILL_CHECKSUM_MISMATCH", "Approved skill content contains a symbolic link.");
      if (index < parts.length - 1 && !info.isDirectory()) throw new SkillError("SKILL_CHECKSUM_MISMATCH", "Approved skill path is not a directory chain.");
      if (index === parts.length - 1 && !info.isFile()) throw new SkillError("SKILL_CHECKSUM_MISMATCH", "Approved skill content is not a regular file.");
    }
    return current;
  }
  private async readApprovedFile(record: RegistryRecord, relativePath: string) {
    return readFile(await this.approvedFilePath(record, relativePath));
  }
  private async readApprovedText(record: RegistryRecord, relativePath: string) {
    return readFile(await this.approvedFilePath(record, relativePath), "utf8");
  }
  private async readApprovedManifest(record: RegistryRecord) {
    try {
      const manifest = SkillManifestSchema.parse(
        JSON.parse(
          await this.readApprovedText(record, "manifest.json"),
        ),
      );
      const definitionFiles = new Map(record.definition.manifest.files.map((file) => [file.relativePath, file]));
      const seen = new Set<string>();
      for (const file of manifest.files) {
        const relativePath = safeSkillRelativePath(file.relativePath);
        if (seen.has(relativePath) || definitionFiles.get(relativePath)?.sha256 !== file.sha256 || definitionFiles.get(relativePath)?.byteSize !== file.byteSize || definitionFiles.get(relativePath)?.kind !== file.kind || definitionFiles.get(relativePath)?.executable !== file.executable)
          throw new SkillError("SKILL_CHECKSUM_MISMATCH", "Approved manifest does not match the staged manifest.");
        seen.add(relativePath);
        if (!record.approval?.approvedFiles.includes(relativePath)) continue;
        const bytes = await this.readApprovedFile(record, relativePath);
        if (digest(bytes) !== file.sha256)
          throw new SkillError(
            "SKILL_CHECKSUM_MISMATCH",
            "Approved skill content changed after promotion.",
          );
      }
      if (!seen.has("SKILL.md") || !record.approval?.approvedFiles.includes("SKILL.md")) throw new SkillError("SKILL_CHECKSUM_MISMATCH", "Approved manifest is missing the approved entry file.");
      return manifest;
    } catch (error) {
      if (error instanceof SkillError) throw error;
      throw new SkillError(
        "SKILL_CHECKSUM_MISMATCH",
        "Approved manifest could not be verified.",
      );
    }
  }
  private async exists(target: string) {
    try {
      await lstat(target);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }
  async listAuditEvents() {
    try {
      return (
        await readFile(path.join(this.dir("registry"), "audit.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => SkillAuditEventSchema.parse(JSON.parse(line)));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }
}
