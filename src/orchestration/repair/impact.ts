import { ChangeImpactGraphSchema, checksumImpactGraph, ImpactEdgeSchema, ImpactNodeSchema, type ChangeImpactGraph, type ImpactEdge, type ImpactGraphMeasurement, type ImpactNode, type RepairRisk } from "./contracts";
import { RegressionLedger } from "./ledger";

export type ImpactEvidence = { source: ImpactNode["source"]; nodes: readonly ImpactNode[]; edges: readonly ImpactEdge[] };

export interface ImpactEvidenceSource {
  readonly source: ImpactNode["source"];
  collect(input: { sourceHead: string }): Promise<ImpactEvidence>;
}

export class StaticImpactEvidenceSource implements ImpactEvidenceSource {
  constructor(readonly source: ImpactNode["source"], private readonly evidence: Omit<ImpactEvidence, "source">) {}

  async collect() { return { source: this.source, nodes: this.evidence.nodes, edges: this.evidence.edges }; }
}

export type ImpactMapperOptions = {
  sources: readonly ImpactEvidenceSource[];
  ledger?: RegressionLedger;
  maxDepth?: number;
  maxNodes?: number;
  maxEdges?: number;
};

const normalizePath = (value: string) => value.replaceAll("\\", "/");
const sortStrings = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b));

export class ImpactMapper {
  private readonly maxDepth: number;
  private readonly maxNodes: number;
  private readonly maxEdges: number;
  private _lastMeasurement: ImpactGraphMeasurement | undefined;

  constructor(private readonly options: ImpactMapperOptions) {
    this.maxDepth = options.maxDepth ?? 4;
    this.maxNodes = options.maxNodes ?? 1000;
    this.maxEdges = options.maxEdges ?? 3000;
    if (this.maxDepth < 0 || this.maxNodes < 1 || this.maxEdges < 1) throw new Error("IMPACT_GRAPH_BOUNDS_INVALID");
  }

  get lastMeasurement() { return this._lastMeasurement; }

  async map(input: { sourceHead: string; changedFiles: readonly string[]; risk?: RepairRisk }): Promise<ChangeImpactGraph> {
    const startedAt = performance.now();
    const maxDepth = input.risk === "HIGH" ? this.maxDepth + 2 : input.risk === "LOW" ? Math.min(this.maxDepth, 2) : this.maxDepth;
    const changedFiles = sortStrings(input.changedFiles.map(normalizePath));
    const nodesById = new Map<string, ImpactNode>();
    const edgesById = new Map<string, ImpactEdge>();
    for (const source of this.options.sources) {
      const evidence = await source.collect({ sourceHead: input.sourceHead });
      for (const rawNode of evidence.nodes) {
        const node = ImpactNodeSchema.parse(rawNode);
        const prior = nodesById.get(node.nodeId);
        if (prior && JSON.stringify(prior) !== JSON.stringify(node)) throw new Error("IMPACT_GRAPH_NODE_CONFLICT");
        nodesById.set(node.nodeId, node);
      }
      for (const rawEdge of evidence.edges) {
        const edge = ImpactEdgeSchema.parse(rawEdge);
        const prior = edgesById.get(edge.edgeId);
        if (prior && JSON.stringify(prior) !== JSON.stringify(edge)) throw new Error("IMPACT_GRAPH_EDGE_CONFLICT");
        edgesById.set(edge.edgeId, edge);
      }
    }
    const nodes = [...nodesById.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    const edges = [...edgesById.values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    if (nodes.length > this.maxNodes || edges.length > this.maxEdges) throw new Error("IMPACT_GRAPH_BOUNDS_EXCEEDED");
    const knownNodes = new Set(nodes.map((node) => node.nodeId));
    if (edges.some((edge) => !knownNodes.has(edge.from) || !knownNodes.has(edge.to))) throw new Error("IMPACT_GRAPH_EDGE_ENDPOINT_UNKNOWN");

    const directNodeIds = nodes.filter((node) => node.path && changedFiles.includes(normalizePath(node.path)) || node.type === "FILE" && changedFiles.includes(normalizePath(node.label))).map((node) => node.nodeId).sort();
    if (!directNodeIds.length) throw new Error("IMPACT_GRAPH_CHANGED_FILE_NOT_FOUND");
    const adjacent = new Map<string, string[]>();
    for (const edge of edges) {
      const from = adjacent.get(edge.from) ?? []; from.push(edge.to); adjacent.set(edge.from, from);
      const to = adjacent.get(edge.to) ?? []; to.push(edge.from); adjacent.set(edge.to, to);
    }
    for (const values of adjacent.values()) values.sort((a, b) => a.localeCompare(b));
    const distances = new Map<string, number>(directNodeIds.map((id) => [id, 0]));
    const queue = [...directNodeIds];
    while (queue.length) {
      const current = queue.shift()!;
      const depth = distances.get(current)!;
      if (depth >= maxDepth) continue;
      for (const next of adjacent.get(current) ?? []) {
        if (distances.has(next)) continue;
        distances.set(next, depth + 1);
        queue.push(next);
      }
    }

    const reachableNodeIds = sortStrings(distances.keys());
    const discovered = this.options.ledger ? await this.options.ledger.discoverForImpact(nodes, reachableNodeIds) : [];
    const graphNodes = [...nodes];
    const graphEdges = [...edges];
    const reachableSet = new Set(reachableNodeIds);
    for (const entry of discovered) {
      const regressionNodeId = `regression:${entry.regressionId}`;
      if (!knownNodes.has(regressionNodeId)) graphNodes.push(ImpactNodeSchema.parse({ nodeId: regressionNodeId, type: "REGRESSION", label: entry.regressionId, source: "REGRESSION_LEDGER", protected: true }));
      const protectedNode = nodes.find((node) => reachableSet.has(node.nodeId) && [entry.subsystem, ...entry.affectedContracts, ...entry.affectedRuntimeBoundaries].includes(node.nodeId) || reachableSet.has(node.nodeId) && [entry.subsystem, ...entry.affectedContracts, ...entry.affectedRuntimeBoundaries].includes(node.label));
      if (protectedNode) graphEdges.push(ImpactEdgeSchema.parse({ edgeId: `ledger:${entry.regressionId}:${protectedNode.nodeId}`, from: regressionNodeId, to: protectedNode.nodeId, type: "PROTECTS", source: "REGRESSION_LEDGER", evidenceRefs: [entry.regressionId] }));
      distances.set(regressionNodeId, (protectedNode ? distances.get(protectedNode.nodeId) ?? 0 : maxDepth) + 1);
    }
    const finalNodes = graphNodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    const finalEdges = graphEdges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    if (finalNodes.length > this.maxNodes || finalEdges.length > this.maxEdges) throw new Error("IMPACT_GRAPH_BOUNDS_EXCEEDED");
    const transitiveNodeIds = sortStrings([...distances.keys()].filter((id) => !directNodeIds.includes(id)));
    const mandatoryRegressionIds = discovered.map((entry) => entry.regressionId).sort();
    const identityBase = { graphId: "pending", sourceHead: input.sourceHead, changedFiles, nodes: finalNodes, edges: finalEdges, directNodeIds, transitiveNodeIds, mandatoryRegressionIds, maxDepth, bounded: true, nodeCount: finalNodes.length, edgeCount: finalEdges.length };
    const base = { ...identityBase, graphId: `impact:${input.sourceHead}:${checksumImpactGraph(identityBase).slice(0, 32)}` };
    const result = ChangeImpactGraphSchema.parse({ ...base, checksum: checksumImpactGraph(base) });
    this._lastMeasurement = { buildDurationMs: Number((performance.now() - startedAt).toFixed(3)), nodeCount: result.nodeCount, edgeCount: result.edgeCount, traversedNodeCount: reachableNodeIds.length, bounded: result.bounded, cacheKey: `${input.sourceHead}:${changedFiles.join(",")}` };
    return result;
  }
}

export function impactNode(input: Omit<ImpactNode, "source" | "protected"> & { source?: ImpactNode["source"]; protected?: boolean }): ImpactNode {
  return ImpactNodeSchema.parse({ ...input, source: input.source ?? "HOST", protected: input.protected ?? false });
}

export function impactEdge(input: Omit<ImpactEdge, "source" | "evidenceRefs"> & { source?: ImpactEdge["source"]; evidenceRefs?: string[] }): ImpactEdge {
  return ImpactEdgeSchema.parse({ ...input, source: input.source ?? "HOST", evidenceRefs: input.evidenceRefs ?? [] });
}
