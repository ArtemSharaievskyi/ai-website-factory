"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createWorkbenchGenerateDesignRequest, createWorkbenchRespondRequest } from "@/runtime/workbench/contracts";
import { postWorkbenchRequest } from "@/runtime/workbench/http-client";
import type {
  WorkbenchAction,
  WorkbenchAsset,
  WorkbenchBrief,
  WorkbenchDesign,
  WorkbenchPlanning,
  WorkbenchProjection,
  WorkbenchRequest,
} from "@/runtime/workbench/contracts";
import { displayLanguageName } from "@/domain/language/schema";
// placeholder="Answer in English..." is retained as the English fallback fixture marker.

type Envelope = {
  ok: boolean;
  data?: WorkbenchProjection;
  error?: string;
  code?: string;
  correlationId?: string;
};
const ACTIVE_PROJECT_KEY = "factory-workbench-active-project";

class WorkbenchRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = "WorkbenchRequestError";
  }
}

const visibleRequestError = (caught: unknown, fallback: string) => {
  if (!(caught instanceof WorkbenchRequestError)) return caught instanceof Error ? caught.message : fallback;
  return [caught.message, caught.code ? "Code: " + caught.code : "", caught.correlationId ? "Reference: " + caught.correlationId : ""].filter(Boolean).join(" ");
};

async function request(input: WorkbenchRequest): Promise<WorkbenchProjection> {
  const response = await postWorkbenchRequest(input);
  const body = (await response.json()) as Envelope;
  if (!response.ok || !body.ok || !body.data)
    throw new WorkbenchRequestError(
      body.error ??
        "We couldn't complete this request. The project was not changed.",
      body.code,
      body.correlationId,
    );
  return body.data;
}

function ItemList({ items }: { items: string[] }) {
  if (!items.length)
    return <span className="muted-copy">None recorded yet.</span>;
  return (
    <ul className="item-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function BriefSection({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="brief-section" data-brief-section={title}>
      <span className="field-label">{title}</span>
      <ItemList items={items} />
    </div>
  );
}

function BriefCard({
  brief,
  onApprove,
  onRequestChanges,
  busy,
}: {
  brief: WorkbenchBrief;
  onApprove: () => void;
  onRequestChanges: () => void;
  busy: boolean;
}) {
  return (
    <section className="artifact-card" aria-labelledby="brief-title">
      <div className="card-eyebrow">FACTORY / LEAD</div>
      <div className="card-heading-row">
        <div>
          <h2 id="brief-title">Project Brief</h2>
          <p className="card-summary">
            {brief.projectSummary ??
              "A bounded requirements summary is ready for your review."}
          </p>
        </div>
        <span className={brief.approved ? "badge badge-success" : "badge"}>
          {brief.approved ? "Approved" : "Needs your decision"}
        </span>
      </div>
      <div className="brief-grid">
        <div>
          <span className="field-label">Business goals</span>
          <ItemList items={brief.businessGoals} />
        </div>
        <div>
          <span className="field-label">Audience</span>
          <ItemList items={brief.targetAudiences} />
        </div>
        <div>
          <span className="field-label">Pages / sections</span>
          <ItemList items={brief.pages} />
        </div>
        <div>
          <span className="field-label">Features</span>
          <ItemList items={brief.features} />
        </div>
        <div>
          <span className="field-label">Forms</span>
          <ItemList items={brief.forms} />
        </div>
        <div>
          <span className="field-label">Image strategy</span>
          <p className="value-copy">{brief.imageStrategy ?? "Pending"}</p>
        </div>
      </div>
      <div className="brief-sections" aria-label="Structured Project Brief V2 sections">
        <BriefSection title="Brand / Visual" items={brief.brandVisual} />
        <BriefSection title="Content / Copy" items={brief.content} />
        <BriefSection title="Assets" items={brief.assets} />
        <BriefSection title="UX / Responsive" items={brief.uxResponsive} />
        <BriefSection title="SEO" items={brief.seo} />
        <BriefSection title="Legal / Compliance" items={brief.legalCompliance} />
        <BriefSection title="Technical / Deferred" items={brief.technicalDeferred} />
        <BriefSection title="Prohibited / Do Not" items={brief.prohibited} />
      </div>
      {!brief.approved && (
        <div className="card-actions">
          <button
            className="button button-primary"
            onClick={onApprove}
            disabled={busy || !brief.readyForApproval}
          >
            Approve Brief
          </button>
          <button
            className="button button-secondary"
            onClick={onRequestChanges}
            disabled={busy}
          >
            Request changes
          </button>
        </div>
      )}
      <p className="checksum">
        Current Brief checksum · {brief.checksum.slice(0, 12)}…
      </p>
    </section>
  );
}

function PlanningCard({
  planning,
  allowedActions,
  onAction,
  busy,
}: {
  planning: WorkbenchPlanning;
  allowedActions: WorkbenchAction[];
  onAction: (action: WorkbenchAction) => void;
  busy: boolean;
}) {
  return (
    <section className="artifact-card">
      <div className="card-eyebrow">PLANNING</div>
      <div className="card-heading-row">
        <div>
          <h2>Planning package</h2>
          <p className="card-summary">{planning.architecture}</p>
        </div>
        <span className={planning.accepted ? "badge badge-success" : "badge"}>
          {planning.accepted ? "Accepted" : "Awaiting approval"}
        </span>
      </div>
      <div className="brief-grid">
        <div>
          <span className="field-label">Routes</span>
          <ItemList items={planning.routes} />
        </div>
        <div>
          <span className="field-label">Major features</span>
          <ItemList items={planning.majorFeatures} />
        </div>
        <div>
          <span className="field-label">Database recommendation</span>
          <p className="value-copy">
            {planning.databaseRecommendation ?? "Not recorded"}
          </p>
        </div>
        <div>
          <span className="field-label">Dependencies</span>
          <ItemList
            items={planning.dependencies.map(
              (dependency) => `${dependency.name} · ${dependency.purpose}`,
            )}
          />
        </div>
      </div>
      {planning.blockingItems.length > 0 && (
        <div className="warning-box">
          Planning blockers remain: {planning.blockingItems.join(", ")}
        </div>
      )}
      {planning.deferredItems.length > 0 && (
        <div className="notice-box">
          Later-stage items remain visible: {planning.deferredItems.join(", ")}
        </div>
      )}
      {!planning.accepted && (
        <div className="card-actions">
          {allowedActions.includes("APPROVE_PLANNING") && (
            <button
              className="button button-primary"
              onClick={() => onAction("APPROVE_PLANNING")}
              disabled={busy || !planning.readyForAcceptance}
            >
              Approve Planning
            </button>
          )}
          {allowedActions.includes("REQUEST_PLANNING_CHANGES") && (
            <button
              className="button button-secondary"
              onClick={() => onAction("REQUEST_PLANNING_CHANGES")}
              disabled={busy}
            >
              Request changes
            </button>
          )}
        </div>
      )}
      <p className="checksum">
        Current planning checksum · {planning.checksum.slice(0, 12)}…
      </p>
    </section>
  );
}

function PlanningPendingCard({
  allowedActions,
  onAction,
  busy,
}: {
  allowedActions: WorkbenchAction[];
  onAction: (action: WorkbenchAction) => void;
  busy: boolean;
}) {
  return (
    <section className="artifact-card">
      <div className="card-eyebrow">PLANNING</div>
      <div className="card-heading-row">
        <div>
          <h2>Prepare the planning package</h2>
          <p className="card-summary">
            The approved Brief is ready for the Planner and architecture gate.
            Planning will produce routes, major features, database
            recommendation, and dependency decisions.
          </p>
        </div>
        <span className="badge">Next canonical step</span>
      </div>
      <div className="card-actions">
        {allowedActions.includes("GENERATE_PLANNING") && (
          <button
            className="button button-primary"
            onClick={() => onAction("GENERATE_PLANNING")}
            disabled={busy}
          >
            Generate Planning
          </button>
        )}
        {allowedActions.includes("REQUEST_BRIEF_CHANGES") && (
          <button
            className="button button-secondary"
            onClick={() => onAction("REQUEST_BRIEF_CHANGES")}
            disabled={busy}
          >
            Request Brief changes
          </button>
        )}
      </div>
    </section>
  );
}

function ArchitectureReviewCard({
  allowedActions,
  onAction,
  busy,
}: {
  allowedActions: WorkbenchAction[];
  onAction: (action: WorkbenchAction) => void;
  busy: boolean;
}) {
  return (
    <section className="artifact-card" aria-labelledby="architecture-review-title">
      <div className="card-eyebrow">ARCHITECTURE REVIEW</div>
      <div className="card-heading-row">
        <div>
          <h2 id="architecture-review-title">Review the current architecture</h2>
          <p className="card-summary">
            The accepted Planning package and current technical architecture are ready for the read-only Architecture Reviewer.
          </p>
        </div>
        <span className="badge">Next canonical step</span>
      </div>
      {allowedActions.includes("GENERATE_ARCHITECTURE_REVIEW") && (
        <div className="card-actions">
          <button
            className="button button-primary"
            onClick={() => onAction("GENERATE_ARCHITECTURE_REVIEW")}
            disabled={busy}
          >
            Generate Architecture Review
          </button>
        </div>
      )}
    </section>
  );
}

function DesignPendingCard({
  allowedActions,
  onAction,
  busy,
}: {
  allowedActions: WorkbenchAction[];
  onAction: (action: WorkbenchAction) => void;
  busy: boolean;
}) {
  if (!allowedActions.includes("GENERATE_DESIGN")) return null;
  return (
    <section className="artifact-card" aria-labelledby="design-generation-title">
      <div className="card-eyebrow">DESIGN DIRECTIONS</div>
      <div className="card-heading-row">
        <div>
          <h2 id="design-generation-title">Generate visual directions</h2>
          <p className="card-summary">
            The approved Architecture Review is current. Generate three distinct directions, then choose one explicitly.
          </p>
        </div>
        <span className="badge">Next canonical step</span>
      </div>
      <div className="card-actions">
        <button className="button button-primary" onClick={() => onAction("GENERATE_DESIGN")} disabled={busy}>
          Generate Design directions
        </button>
      </div>
    </section>
  );
}

function DecisionCards({
  projection,
  onAction,
  busy,
}: {
  projection: WorkbenchProjection;
  onAction: (action: WorkbenchAction) => void;
  busy: boolean;
}) {
  return (
    <>
      {projection.database && (
        <section className="artifact-card">
          <div className="card-eyebrow">DATABASE DECISION</div>
          <div className="card-heading-row">
            <div>
              <h2>
                {projection.database.recommendation === "NOT_REQUIRED"
                  ? "No database recommended"
                  : "Database recommendation"}
              </h2>
              <p className="card-summary">{projection.database.rationale}</p>
            </div>
            <span className="badge">{projection.database.status}</span>
          </div>
          <div className="card-actions">
            {projection.status.allowedActions.includes("DATABASE_DECISION") && (
              <>
                <button
                  className="button button-primary"
                  onClick={() => onAction("DATABASE_DECISION")}
                  disabled={busy}
                >
                  {projection.database.recommendation === "NOT_REQUIRED"
                    ? "Approve no database"
                    : "Approve recommendation"}
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => onAction("REQUEST_PLANNING_CHANGES")}
                  disabled={busy}
                >
                  Request alternative
                </button>
              </>
            )}
          </div>
        </section>
      )}
      {projection.dependencies.some(
        (dependency) => dependency.approvalStatus === "PENDING",
      ) && (
        <section className="artifact-card">
          <div className="card-eyebrow">DEPENDENCY APPROVAL</div>
          <div className="card-heading-row">
            <div>
              <h2>Optional dependencies</h2>
              <p className="card-summary">
                These packages remain governed by the Dependency Authority.
              </p>
            </div>
            <span className="badge">User decision</span>
          </div>
          <ItemList
            items={projection.dependencies
              .filter((dependency) => dependency.approvalStatus === "PENDING")
              .map(
                (dependency) =>
                  `${dependency.packageName}@${dependency.versionSpec} · ${dependency.purpose}`,
              )}
          />
          <div className="card-actions">
            {projection.status.allowedActions.includes(
              "DEPENDENCY_APPROVAL",
            ) && (
              <button
                className="button button-primary"
                onClick={() => onAction("DEPENDENCY_APPROVAL")}
                disabled={busy}
              >
                Approve dependency set
              </button>
            )}
          </div>
        </section>
      )}
      {projection.status.allowedActions.includes("RUN_CONTRACT_AUDIT") && (
        <section className="artifact-card">
          <div className="card-eyebrow">PHASE 7C PREREQUISITES</div>
          <div className="card-heading-row">
            <div>
              <h2>Prepare implementation contract</h2>
              <p className="card-summary">Create the current TaskGraph and run the guarded Contract Audit. Final Phase 7C approval remains a separate action.</p>
            </div>
            <span className="badge">Workflow owner</span>
          </div>
          <div className="card-actions">
            <button className="button button-primary" onClick={() => onAction("RUN_CONTRACT_AUDIT")} disabled={busy}>Run Contract Audit</button>
          </div>
        </section>
      )}
    </>
  );
}

function DesignCards({
  designs,
  selectedDesignId,
  onSelect,
  busy,
}: {
  designs: WorkbenchDesign[];
  selectedDesignId?: string;
  onSelect: (id: string) => void;
  busy: boolean;
}) {
  if (designs.length !== 3) return null;
  return (
    <section className="artifact-card">
      <div className="card-eyebrow">DESIGN DIRECTIONS · 3 OPTIONS</div>
      <div className="card-heading-row">
        <div>
          <h2>Choose a visual direction</h2>
          <p className="card-summary">
            Select exactly one current direction. No direction is preselected.
          </p>
        </div>
        <span className="badge">Explicit choice</span>
      </div>
      <div className="design-grid">
        {designs.map((design, index) => (
          <article
            className={
              selectedDesignId === design.id
                ? "design-card selected"
                : "design-card"
            }
            key={design.id}
          >
            <div className="design-index">0{index + 1}</div>
            <h3>{design.label}</h3>
            <p className="design-concept">{design.concept}</p>
            <dl className="design-details">
              <div>
                <dt>Typography</dt>
                <dd>{design.typography}</dd>
              </div>
              <div>
                <dt>Layout</dt>
                <dd>{design.layout}</dd>
              </div>
              <div>
                <dt>Imagery</dt>
                <dd>{design.photography}</dd>
              </div>
              <div>
                <dt>Components</dt>
                <dd>{design.componentCharacter}</dd>
              </div>
              <div>
                <dt>Motion</dt>
                <dd>{design.motion}</dd>
              </div>
            </dl>
            <p className="design-tradeoff">
              <span>Trade-offs</span>{" "}
              {design.tradeoffs.join(" · ") || "None recorded"}
            </p>
            <button
              className={
                selectedDesignId === design.id
                  ? "button button-selected"
                  : "button button-secondary"
              }
              onClick={() => onSelect(design.id)}
              disabled={busy}
            >
              {selectedDesignId === design.id
                ? "Selected"
                : "Use this direction"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

const assetSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function AssetPanel({
  projection,
  busy,
  onUpload,
  onRemove,
}: {
  projection: WorkbenchProjection;
  busy: boolean;
  onUpload: (
    files: File[],
    category: WorkbenchAsset["category"],
    replaceAssetId?: string,
  ) => void;
  onRemove: (assetId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] =
    useState<WorkbenchAsset["category"]>("REFERENCE");
  const [replaceAssetId, setReplaceAssetId] = useState<string>();
  const choose = () => inputRef.current?.click();
  // The Lead sees metadata only; asset bytes remain outside the JSON workflow contract.
  return (
    <section
      className="asset-card artifact-card"
      aria-labelledby="assets-title"
    >
      <div className="card-heading-row">
        <div>
          <div className="card-eyebrow">PROJECT ASSETS</div>
          <h2 id="assets-title">Project assets</h2>
          <p className="card-summary">
            Upload project-scoped PNG, JPEG, WebP, or PDF files. The Lead sees
            metadata only.
          </p>
        </div>
        <span className="badge">Factory-owned intake</span>
      </div>
      <div className="asset-toolbar">
        <select
          aria-label="Asset category"
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as WorkbenchAsset["category"])
          }
        >
          <option value="LOGO">Logo</option>
          <option value="IMAGE">Image</option>
          <option value="REFERENCE">Reference</option>
          <option value="DOCUMENT">Document</option>
        </select>
        <button
          className="button button-secondary"
          onClick={choose}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "Uploading..." : "+ Attach files"}
        </button>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) onUpload(files, category, replaceAssetId);
            setReplaceAssetId(undefined);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {projection.assets.length ? (
        <ul className="asset-list">
          {projection.assets.map((asset) => (
            <li key={asset.assetId} className="asset-row">
              <div>
                <strong>{asset.safeDisplayName}</strong>
                <span>
                  {asset.category} · {asset.mediaType} ·{" "}
                  {assetSize(asset.byteSize)} ·{" "}
                  {asset.status === "READY" ? "Ready" : asset.status}
                </span>
              </div>
              <div className="asset-actions">
                {asset.status === "READY" &&
                  asset.currentness === "CURRENT" && (
                    <button
                      className="button button-secondary"
                      onClick={() => {
                        setReplaceAssetId(asset.assetId);
                        choose();
                      }}
                      disabled={busy}
                    >
                      Replace
                    </button>
                  )}
                {asset.status !== "REMOVED" && (
                  <button
                    className="button button-quiet"
                    onClick={() => onRemove(asset.assetId)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted-copy">No project files attached yet.</p>
      )}
      <p className="asset-hint">
        Images up to 10 MB · PDFs up to 20 MB · 50 MB per project
      </p>
    </section>
  );
}

export function Workbench() {
  const [projection, setProjection] = useState<WorkbenchProjection | null>(
    null,
  );
  const [prompt, setPrompt] = useState("");
  const [composerMode, setComposerMode] = useState<
    "new" | "clarification" | "brief" | "planning"
  >("new");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const requestInFlightRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<
    WorkbenchRequest["action"] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [assetCategory, setAssetCategory] =
    useState<WorkbenchAsset["category"]>("REFERENCE");
  const [assetBusy, setAssetBusy] = useState(false);
  const pendingInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const apply = (next: WorkbenchProjection) => {
    setProjection(next);
    setError(null);
    if (next.project) {
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, next.project.projectId);
      window.history.replaceState(
        null,
        "",
        `/?project=${encodeURIComponent(next.project.projectId)}`,
      );
      setComposerMode(
        next.status.allowedActions.includes("REQUEST_BRIEF_CHANGES")
          ? "brief"
          : next.status.allowedActions.includes("REQUEST_PLANNING_CHANGES")
            ? "planning"
            : next.status.allowedActions.includes("ANSWER_LEAD_CLARIFICATIONS")
              ? "clarification"
              : "new",
      );
    }
  };

  const run = async (input: WorkbenchRequest) => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setLoading(true);
    setPendingAction(input.action);
    setError(null);
    try {
      apply(await request(input));
      if (input.action === "respond") {
        const acceptedQuestionIds = new Set(input.answers.map((answer) => answer.questionId));
        setAnswers((current) => Object.fromEntries(Object.entries(current).filter(([questionId]) => !acceptedQuestionIds.has(questionId))));
      }
      if (input.action === "request-brief-changes" || input.action === "request-planning-changes") setPrompt("");
    } catch (caught) {
      setError(
        caught instanceof WorkbenchRequestError && caught.correlationId
          ? `${caught.message} Reference: ${caught.correlationId}`
          : caught instanceof Error
            ? caught.message
            : "We couldn't complete this request. The project was not changed.",
      );
    } finally {
      setLoading(false);
      setPendingAction(null);
      requestInFlightRef.current = false;
    }
  };

  const uploadFiles = async (
    projectId: string,
    files: File[],
    category: WorkbenchAsset["category"],
    replaceAssetId?: string,
  ) => {
    setAssetBusy(true);
    setError(null);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("projectId", projectId);
        form.append("category", category);
        form.append("file", file, file.name);
        if (replaceAssetId) form.append("replaceAssetId", replaceAssetId);
        const response = await fetch("/api/workbench/assets", {
          method: "POST",
          body: form,
        });
        const body = (await response.json()) as {
          ok?: boolean;
          error?: { code?: string; message?: string };
          correlationId?: string;
        };
        if (!response.ok || !body.ok)
          throw new WorkbenchRequestError(
            body.error?.message ?? "The file could not be uploaded.",
            body.error?.code,
            body.correlationId,
          );
      }
      apply(await request({ action: "status", projectId }));
    } catch (caught) {
      setError(visibleRequestError(caught, "The file could not be uploaded. The project was not changed."));
    } finally {
      setAssetBusy(false);
    }
  };

  const createProject = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await request({ action: "create", requestText: prompt });
      apply(next);
      const projectId = next.project?.projectId;
      const files = pendingFiles;
      setPendingFiles([]);
      if (projectId && files.length)
        await uploadFiles(projectId, files, assetCategory);
      setPrompt("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "We couldn't create this project.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const projectId =
      new URLSearchParams(window.location.search).get("project") ??
      window.localStorage.getItem(ACTIVE_PROJECT_KEY);
    void request(
      projectId ? { action: "status", projectId } : { action: "list" },
    )
      .then(apply)
      .catch((caught: unknown) =>
        setError(
          caught instanceof WorkbenchRequestError && caught.correlationId
            ? `${caught.message} Reference: ${caught.correlationId}`
            : caught instanceof Error
              ? caught.message
              : "We couldn't complete this request. The project was not changed.",
        ),
      );
  }, []);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 360)}px`;
  }, [prompt]);

  const submit = () => {
    if (!prompt.trim() || loading) return;
    if (!projection || projection.mode === "NEW_PROJECT") {
      void createProject();
      return;
    }
    if (composerMode === "brief") {
      if (!projection.brief || !projection.project) return;
      void run({
        action: "request-brief-changes",
        projectId: projection.project!.projectId,
        projectVersion: projection.project.projectVersion,
        briefChecksum: projection.brief.checksum,
        expectedRowVersion: projection.project.rowVersion,
        reason: prompt,
        requirementKeys: ["project-brief"],
        assetBindings: projection.assets
          .filter((asset) => asset.category === "LOGO" && asset.status === "READY" && asset.currentness === "CURRENT")
          .slice(0, 1)
          .map((asset) => ({ target: "ASSET_COMPANY_LOGO" as const, assetId: asset.assetId, sha256: asset.sha256 })),
      });
      return;
    }
    if (composerMode === "planning") {
      void run({
        action: "request-planning-changes",
        projectId: projection.project!.projectId,
        reason: prompt,
      });
      return;
    }
    if (composerMode === "clarification") {
      const unresolved = projection.questions.filter(
        (question) => question.answerStatus === "unresolved",
      );
      const answerList = unresolved
        .map((question) => ({
          questionId: question.id,
          answer:
            answers[question.id] ?? (unresolved.length === 1 ? prompt : ""),
        }))
        .filter((answer) => answer.answer.trim());
      if (answerList.length)
        void run(createWorkbenchRespondRequest({ projectId: projection.project!.projectId, answers: answerList }));
    }
  };

  const newProject = () => {
    setProjection(null);
    setPrompt("");
    setAnswers({});
    setError(null);
    window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    window.history.replaceState(null, "", "/");
    setSidebarOpen(false);
    void run({ action: "list" });
  };
  const openProject = (projectId: string) => {
    setSidebarOpen(false);
    void run({ action: "status", projectId });
  };
  const removeAsset = async (assetId: string) => {
    if (!projection?.project) return;
    setAssetBusy(true);
    try {
      const response = await fetch("/api/workbench/assets", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: projection.project.projectId,
          assetId,
        }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !body.ok)
        throw new Error(
          body.error?.message ?? "The file could not be removed.",
        );
      apply(
        await request({
          action: "status",
          projectId: projection.project.projectId,
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The file could not be removed.",
      );
    } finally {
      setAssetBusy(false);
    }
  };
  const action = (value: WorkbenchAction) => {
    if (!projection?.project || loading) return;
    if (value === "APPROVE_BRIEF" && projection.brief)
      void run({
        action: "approve-brief",
        projectId: projection.project.projectId,
        briefChecksum: projection.brief.checksum,
        expectedRowVersion: projection.project.rowVersion,
      });
    else if (value === "REQUEST_BRIEF_CHANGES") {
      setComposerMode("brief");
      textareaRef.current?.focus();
    } else if (value === "REQUEST_PLANNING_CHANGES") {
      setComposerMode("planning");
      textareaRef.current?.focus();
    } else if (value === "GENERATE_PLANNING")
      void run({
        action: "generate-planning",
        projectId: projection.project.projectId,
      });
    else if (value === "APPROVE_PLANNING")
      void run({
        action: "approve-planning",
        projectId: projection.project.projectId,
      });
    else if (value === "GENERATE_ARCHITECTURE_REVIEW")
      void run({
        action: "generate-architecture-review",
        projectId: projection.project.projectId,
      });
    else if (value === "GENERATE_DESIGN")
      void run(createWorkbenchGenerateDesignRequest(projection.project.projectId));
    else if (value === "DATABASE_DECISION")
      void run({
        action: "database-decision",
        projectId: projection.project.projectId,
        mode:
          projection.database?.mode === "NONE"
            ? "NONE"
            : projection.database?.mode === "SUPABASE_EXISTING"
              ? "SUPABASE_EXISTING"
              : "SUPABASE_NEW",
      });
    else if (value === "DEPENDENCY_APPROVAL")
      void run({
        action: "dependency-approval",
        projectId: projection.project.projectId,
      });
    else if (value === "RUN_CONTRACT_AUDIT")
      void run({
        action: "run-contract-audit",
        projectId: projection.project.projectId,
      });
    else if (value === "START_IMPLEMENTATION")
      void run({
        action: "start-implementation",
        projectId: projection.project.projectId,
      });
    else
      setError(
        "That action is guarded by the canonical workflow and is not available from this project state.",
      );
  };

  if (projection?.mode === "PROJECT_WORKBENCH" && projection.project)
    return (
      <main className="workbench-shell">
        <aside className={sidebarOpen ? "sidebar sidebar-open" : "sidebar"}>
          <div className="sidebar-brand">
            <span className="brand-mark">AF</span>
            <span>AI Website Factory</span>
          </div>
          <button className="new-project-link" onClick={newProject}>
            + New project
          </button>
          <div className="sidebar-section">
            <span className="sidebar-label">Recent projects</span>
            {projection.projects.length ? (
              projection.projects.map((project) => (
                <button
                  className={
                    project.projectId === projection.project!.projectId
                      ? "project-link active"
                      : "project-link"
                  }
                  onClick={() => openProject(project.projectId)}
                  key={project.projectId}
                >
                  <span className="project-dot" />
                  <span className="project-link-copy">
                    <strong>{project.name}</strong>
                    <small>{project.statusLabel}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="muted-copy">No other projects yet.</p>
            )}
          </div>
          <div className="sidebar-footer">
            <span className="status-dot" /> Trusted local workflow
          </div>
        </aside>
        <div className="workbench-main">
          <header className="topbar">
            <button
              className="menu-button"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label="Toggle project sidebar"
            >
              ☰
            </button>
            <div>
              <div className="topbar-kicker">PROJECT WORKBENCH</div>
              <h1>{projection.project.name}</h1>
            </div>
            <div className="topbar-status">
              <span className="status-dot" />
              {projection.status.label}
              <span className="language-pill">
                Communication: {displayLanguageName(projection.operatorLanguage)} · Website:{" "}
                {projection.siteLanguage === "UNRESOLVED"
                  ? "Not confirmed"
                  : displayLanguageName(projection.siteLanguage)}
              </span>
            </div>
          </header>
          <div className="stage-line">
            <div className="stage-copy">
              <span className="stage-label">{projection.status.stage}</span>
              <span>{projection.status.detail}</span>
            </div>
            <span className="state-pill">
              {projection.project.workflowState.replaceAll("_", " ")}
            </span>
          </div>
          <section className="conversation" aria-live="polite">
            {projection.conversation.map((entry) => (
              <article
                className={
                  entry.actor === "USER"
                    ? "conversation-entry user-entry"
                    : "conversation-entry"
                }
                key={entry.entryId}
              >
                <div className="avatar">
                  {entry.actor === "USER" ? "YOU" : "AF"}
                </div>
                <div>
                  <div className="entry-meta">
                    <strong>{entry.title}</strong>
                    {entry.status === "complete" && (
                      <span className="entry-complete">Complete</span>
                    )}
                  </div>
                  <p>{entry.text}</p>
                </div>
              </article>
            ))}
            <AssetPanel
              projection={projection}
              busy={loading || assetBusy}
              onUpload={(files, category, replaceAssetId) => {
                if (projection.project)
                  void uploadFiles(
                    projection.project.projectId,
                    files,
                    category,
                    replaceAssetId,
                  );
              }}
              onRemove={(assetId) => void removeAsset(assetId)}
            />
            {projection.questions.some(
              (question) => question.answerStatus === "unresolved",
            ) && (
              <section className="question-card">
                <div className="card-eyebrow">LEAD CLARIFICATION</div>
                <div className="card-heading-row">
                  <div>
                    <h2>Clarify the Project Brief</h2>
                    <p className="card-summary">
                      Answer the open questions below. Your answers continue the
                      same project.
                    </p>
                  </div>
                  {projection.status.allowedActions.includes(
                    "REFRESH_LEAD_CLARIFICATIONS",
                  ) && (
                    <button
                      className="button button-secondary"
                      onClick={() =>
                        void run({
                          action: "refresh-clarifications",
                          projectId: projection.project!.projectId,
                          requestId: crypto.randomUUID(),
                        })
                      }
                      disabled={loading}
                    >
                      {pendingAction === "refresh-clarifications"
                        ? "Refreshing..."
                        : "Refresh clarification questions"}
                    </button>
                  )}
                </div>
                {projection.questions
                  .filter((question) => question.answerStatus === "unresolved")
                  .map((question) => (
                    <label className="question-row" key={question.id}>
                      <span>
                        {question.question}
                        {question.required && <em>Required</em>}
                      </span>
                      {/* Backward-compatible English fixture marker; the rendered value is canonical-language aware. */}
                      <textarea
                        value={answers[question.id] ?? ""}
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                        rows={5}
                        placeholder={projection.operatorLanguage === "en" ? "Answer in English..." : "Answer in " + displayLanguageName(projection.operatorLanguage) + "..."}
                      />
                    </label>
                  ))}
                <button
                  className="button button-primary"
                  onClick={() => {
                    const items = projection.questions
                      .filter(
                        (question) => question.answerStatus === "unresolved",
                      )
                      .map((question) => ({
                        questionId: question.id,
                        answer: answers[question.id] ?? "",
                      }))
                      .filter((item) => item.answer.trim());
                    if (items.length)
                      void run(createWorkbenchRespondRequest({ projectId: projection.project!.projectId, answers: items }));
                  }}
                  disabled={
                    loading ||
                    !Object.values(answers).some((answer) => answer.trim())
                  }
                >
                  {pendingAction === "respond"
                    ? "Sending answers..."
                    : loading
                      ? "Saving..."
                      : "Send answers to Lead"}
                </button>
              </section>
            )}
            {projection.brief && (
              <BriefCard
                brief={projection.brief}
                onApprove={() => action("APPROVE_BRIEF")}
                onRequestChanges={() => action("REQUEST_BRIEF_CHANGES")}
                busy={loading}
              />
            )}
            {projection.planning ? (
              <PlanningCard
                planning={projection.planning}
                allowedActions={projection.status.allowedActions}
                onAction={action}
                busy={loading}
              />
            ) : (
              projection.status.allowedActions.includes("GENERATE_PLANNING") && (
                <PlanningPendingCard
                  allowedActions={projection.status.allowedActions}
                  onAction={action}
                  busy={loading}
                />
              )
            )}
            {projection.project.workflowState === "ARCHITECTURE_REVIEW" && (
              <ArchitectureReviewCard
                allowedActions={projection.status.allowedActions}
                onAction={action}
                busy={loading}
              />
            )}
            <DecisionCards
              projection={projection}
              onAction={action}
              busy={loading}
            />
            <DesignPendingCard
              allowedActions={projection.status.allowedActions}
              onAction={action}
              busy={loading}
            />
            <DesignCards
              designs={projection.designs}
              selectedDesignId={projection.selectedDesignId}
              onSelect={(id) => {
                if (
                  projection.status.allowedActions.includes("DESIGN_SELECTION")
                )
                  void run({
                    action: "design-selection",
                    projectId: projection.project!.projectId,
                    selectedDirectionId: id,
                  });
                else
                  setError(
                    "Design selection remains guarded by the canonical Design Agent authority until the current gate is ready.",
                  );
              }}
              busy={loading}
            />
            {projection.status.allowedActions.includes(
              "START_IMPLEMENTATION",
            ) && (
              <section className="action-card">
                <div>
                  <div className="card-eyebrow">IMPLEMENTATION GATE</div>
                  <h2>Ready for implementation</h2>
                  <p className="card-summary">
                    Start only when the current Brief, Planning, database,
                    dependency, design, and contract gates are all current.
                  </p>
                </div>
                <button
                  className="button button-primary"
                  onClick={() => action("START_IMPLEMENTATION")}
                  disabled={loading}
                >
                  Start implementation
                </button>
              </section>
            )}
          </section>
          <div className="composer-wrap">
            <div className="composer-context">
              <span className="composer-dot" />
              {composerMode === "brief"
                ? "Brief revision"
                : composerMode === "clarification"
                  ? "Reply to Lead"
                  : composerMode === "planning"
                    ? "Planning revision"
                    : projection.status.label}
            </div>
            <div className="composer">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  composerMode === "brief"
                    ? "Describe what should change in the Brief..."
                    : composerMode === "planning"
                      ? "Describe what should change in Planning..."
                      : composerMode === "clarification"
                        ? "Add an answer for Lead..."
                        : projection.status.canCompose
                          ? "Add a note for the current workflow..."
                          : "The next step is an explicit workflow action above..."
                }
                disabled={loading || !projection.status.canCompose}
                rows={1}
                aria-label="Workbench message composer"
              />
              <button
                className="send-button"
                onClick={submit}
                disabled={
                  loading || !prompt.trim() || !projection.status.canCompose
                }
                aria-label="Send message"
              >
                →
              </button>
            </div>
            <p className="composer-help">
              {loading
                ? "Working through the canonical workflow..."
                : "Ctrl/Cmd + Enter to send · Enter for a new line"}
            </p>
          </div>
          {error && (
            <div className="toast-error" role="alert">
              {error}
            </div>
          )}
        </div>
      </main>
    );

  return (
    <main className="landing-shell">
      <div className="landing-noise" />
      <header className="landing-nav">
        <div className="sidebar-brand">
          <span className="brand-mark">AF</span>
          <span>AI Website Factory</span>
        </div>
        <span className="local-badge">
          <span className="status-dot" /> Local workflow
        </span>
      </header>
      <section className="landing-content">
        <div className="landing-hero-layout">
          <div className="landing-copy">
            <div className="landing-kicker">
              <span className="kicker-line" /> CONTROLLED WEBSITE BUILDING
            </div>
            <h1>
              Build a website
              <br />
              <span>with your AI team.</span>
            </h1>
            <p className="landing-subtitle">
              Describe the project in your own words. The Factory guides it
              through Brief, Design, and Implementation with clear reviewable
              gates.
            </p>
            <div className="landing-composer">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder="Tell the Factory what you want to build..."
                rows={5}
                aria-label="Project request"
                disabled={loading}
              />
              <div className="landing-asset-bar">
                <select
                  aria-label="Initial asset category"
                  value={assetCategory}
                  onChange={(event) =>
                    setAssetCategory(
                      event.target.value as WorkbenchAsset["category"],
                    )
                  }
                >
                  <option value="LOGO">Logo</option>
                  <option value="IMAGE">Image</option>
                  <option value="REFERENCE">Reference</option>
                  <option value="DOCUMENT">Document</option>
                </select>
                <button
                  className="button button-secondary"
                  onClick={() => pendingInputRef.current?.click()}
                  disabled={loading}
                >
                  + Attach project files
                </button>
                <input
                  ref={pendingInputRef}
                  className="visually-hidden"
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
                  onChange={(event) => {
                    setPendingFiles((files) => [
                      ...files,
                      ...Array.from(event.target.files ?? []),
                    ]);
                    event.currentTarget.value = "";
                  }}
                />
                {pendingFiles.length > 0 && (
                  <span className="pending-files">
                    {pendingFiles.map((file) => file.name).join(", ")}
                  </span>
                )}
              </div>
              <div className="landing-composer-footer">
                <span>
                  {prompt.length > 100000
                    ? `${prompt.length.toLocaleString()} / 131,072 characters`
                    : "Long-form requests welcome"}
                </span>
                <button
                  className="create-button"
                  onClick={submit}
                  disabled={loading || !prompt.trim()}
                  aria-busy={loading}
                >
                  {loading ? "Creating project..." : "Create project"}
                  <span>→</span>
                </button>
              </div>
            </div>
            <div className="suggestions">
              <span>Try starting with</span>
              <button
                onClick={() =>
                  setPrompt(
                    (value) =>
                      value ||
                      "A focused business website with clear services, a contact path, and a thoughtful mobile experience.",
                  )
                }
              >
                Business website
              </button>
              <button
                onClick={() =>
                  setPrompt(
                    (value) =>
                      value ||
                      "A polished marketing site with a clear story, strong calls to action, and accessible responsive sections.",
                  )
                }
              >
                Marketing site
              </button>
              <button
                onClick={() =>
                  setPrompt(
                    (value) =>
                      value ||
                      "A simple product site with a home page, feature sections, and a concise contact flow.",
                  )
                }
              >
                Product site
              </button>
            </div>
          </div>
          <div className="landing-visual">
            <div className="visual-frame">
              <Image
                src="/factory/workbench-hero.svg"
                alt="Abstract AI-assisted website workspace"
                width={760}
                height={520}
                priority
              />
            </div>
            <div className="visual-caption">
              <span>
                <i className="signal-dot" /> Brief → Design → Build
              </span>
              <span>Factory-owned visual system</span>
            </div>
          </div>
        </div>
        {projection?.projects.length ? (
          <div className="landing-history">
            <span>Recent projects</span>
            {projection.projects.slice(0, 3).map((project) => (
              <button
                key={project.projectId}
                onClick={() => openProject(project.projectId)}
              >
                {project.name}
                <small>{project.statusLabel}</small>
              </button>
            ))}
          </div>
        ) : null}
        {error && (
          <div className="toast-error landing-error" role="alert">
            {error}
          </div>
        )}
      </section>
      <footer className="landing-footer">
        <span>Lead first · explicit gates · no preview shortcuts</span>
        <span>AI Website Factory / local</span>
      </footer>
    </main>
  );
}
