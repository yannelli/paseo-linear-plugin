import type { AgentFocus } from "./activity";
import type { LabelSide, Placed } from "./graph-geometry";
import type { FileLink, LinkKind } from "./links";
import type { MapTile } from "./map-model";

// The Linear Live graph: files are vertices and the links between them, such as imports, are
// edges. Files sit near others in their folder and take their sub-issue's color; the issue and
// its sub-issues join the files the plan gave them. Pure, so tests can check the layout.

export type GraphNodeKind = "issue" | "subissue" | "file";
export type GraphEdgeKind = "owns" | LinkKind;

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Issue key whose color the node takes. */
  owner: string | null;
  /** Repo path, for file nodes. */
  path: string | null;
  tile: MapTile | null;
  /** Up to two folder levels, which files of one neighborhood share. */
  folder: string | null;
  /** Files left out to keep the graph readable. */
  folded: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface Graph {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphInput {
  issue: string;
  children: readonly string[];
  tiles: readonly MapTile[];
  links?: readonly FileLink[];
}

const MAX_UNTOUCHED_PER_OWNER = 6;
export const MAX_GRAPH_FILES = 120;
const STRENGTH: Record<GraphEdgeKind, number> = { import: 4, link: 3, mention: 2, owns: 1 };

export const issueNodeId = (key: string) => `issue:${key.toUpperCase()}`;
export const subIssueNodeId = (key: string) => `sub:${key.toUpperCase()}`;
export const fileNodeId = (path: string) => `file:${path}`;

export function folderOf(path: string): string {
  const parts = path.split("/").slice(0, -1);
  return parts.length ? parts.slice(0, 2).join("/") : ".";
}

/** The files the graph shows: every touched file, then predicted ones up to a cap per issue. */
export function graphFiles(input: GraphInput): { tiles: MapTile[]; folded: Map<string, number> } {
  const children = new Set(input.children.map((key) => key.toUpperCase()));
  const parent = input.issue.toUpperCase();
  const ownerOf = (tile: MapTile) => (tile.owner && children.has(tile.owner.toUpperCase()) ? tile.owner.toUpperCase() : parent);
  const tiles = input.tiles.filter((tile) => !tile.ghost);
  const chosen = tiles.filter((tile) => tile.touch !== "none").slice(0, MAX_GRAPH_FILES);
  const folded = new Map<string, number>();
  const perOwner = new Map<string, number>();
  for (const tile of tiles) {
    if (tile.touch !== "none" || !tile.onMap) continue;
    const owner = ownerOf(tile);
    const count = perOwner.get(owner) ?? 0;
    if (count >= MAX_UNTOUCHED_PER_OWNER || chosen.length >= MAX_GRAPH_FILES) {
      folded.set(owner, (folded.get(owner) ?? 0) + 1);
      continue;
    }
    perOwner.set(owner, count + 1);
    chosen.push(tile);
  }
  return { tiles: chosen, folded };
}

export function buildGraph(input: GraphInput): Graph {
  const parentKey = input.issue.toUpperCase();
  const root = issueNodeId(parentKey);
  const children = new Set(input.children.map((key) => key.toUpperCase()));
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const { tiles, folded } = graphFiles(input);
  const add = (node: GraphNode) => nodes.set(node.id, node);
  const join = (from: string, to: string, kind: GraphEdgeKind) => {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    const [a, b] = from < to ? [from, to] : [to, from];
    const id = `${a}>${b}`;
    const known = edges.get(id);
    if (!known || STRENGTH[kind] > STRENGTH[known.kind]) edges.set(id, { id, from, to, kind });
  };
  const hub = (key: string) => (children.has(key) ? subIssueNodeId(key) : root);
  add({ id: root, kind: "issue", label: parentKey, owner: parentKey, path: null, tile: null, folder: null, folded: folded.get(parentKey) ?? 0 });
  for (const key of children) {
    add({ id: subIssueNodeId(key), kind: "subissue", label: key, owner: key, path: null, tile: null, folder: null, folded: folded.get(key) ?? 0 });
    join(root, subIssueNodeId(key), "owns");
  }
  for (const tile of tiles) {
    const id = fileNodeId(tile.path);
    const label = tile.path.split("/").pop() ?? tile.path;
    add({ id, kind: "file", label, owner: tile.owner, path: tile.path, tile, folder: folderOf(tile.path), folded: 0 });
    if (tile.onMap && tile.owner) join(hub(tile.owner.toUpperCase()), id, "owns");
  }
  for (const link of input.links ?? []) join(fileNodeId(link.from), fileNodeId(link.to), link.kind);
  return { root, nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Changes only when a node or an edge comes or goes; then the layout runs again. */
export function graphKey(graph: Graph): string {
  const ids = graph.nodes.map((node) => node.id).sort();
  const links = graph.edges.map((edge) => edge.id).sort();
  return `${ids.join("|")}#${links.join("|")}`;
}

const MAX_HOPS = 6;

/** The shortest walk between two nodes along edges, or a straight hop when there is none. */
export function graphPath(graph: Graph, from: string, to: string): string[] {
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (!ids.has(to)) return [];
  if (!ids.has(from) || from === to) return [to];
  const next = new Map<string, string[]>();
  for (const edge of graph.edges) {
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
    next.set(edge.to, [...(next.get(edge.to) ?? []), edge.from]);
  }
  const came = new Map<string, string>([[from, from]]);
  const queue = [from];
  for (let index = 0; index < queue.length && !came.has(to); index += 1) {
    const at = queue[index] as string;
    for (const neighbor of [...(next.get(at) ?? [])].sort()) {
      if (came.has(neighbor)) continue;
      came.set(neighbor, at);
      queue.push(neighbor);
    }
  }
  if (!came.has(to)) return [from, to];
  const path = [to];
  while (path[0] !== from) path.unshift(came.get(path[0] as string) as string);
  return path.length - 1 > MAX_HOPS ? [from, to] : path;
}

/** The node an agent works on: its file or sub-issue when the graph has it, else the issue. */
export function focusNode(graph: Graph, focus: AgentFocus | null): string {
  if (!focus) return graph.root;
  const id = focus.kind === "issue" ? subIssueNodeId(focus.key) : fileNodeId(focus.path);
  return graph.nodes.some((node) => node.id === id) ? id : graph.root;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

// Edge length as a share of the ideal spacing, and how hard the edge pulls.
const SPRINGS: Record<GraphEdgeKind, { length: number; weight: number }> = {
  import: { length: 0.6, weight: 1 },
  link: { length: 0.7, weight: 0.7 },
  mention: { length: 0.9, weight: 0.35 },
  owns: { length: 1, weight: 0.3 },
};
const GRAVITY = 0.05;
const COHESION = 0.35;
const ANCHOR = 6;

function sideOf(point: { x: number; y: number }, center: { x: number; y: number }): LabelSide {
  if (point.x > center.x + 30) return "right";
  if (point.x < center.x - 30) return "left";
  return point.y > center.y ? "below" : "above";
}

// Force layout: nodes push apart, edges pull together, files drift toward their folder's middle,
// and the issue stays fixed in the center. A warm start holds nodes near where they were.
export function layoutGraph(
  graph: Graph,
  width: number,
  height: number,
  previous: ReadonlyMap<string, { x: number; y: number }> = new Map(),
): Map<string, Placed> {
  const random = mulberry32(hash(graphKey(graph)));
  const center = { x: width / 2, y: height / 2 };
  const padX = Math.min(96, width * 0.14);
  const padY = 40;
  const clamp = (x: number, y: number) => ({
    x: Math.min(width - padX, Math.max(padX, x)),
    y: Math.min(height - padY, Math.max(padY, y)),
  });
  const nodes = graph.nodes;
  const k = Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.72;
  const folders = [...new Set(nodes.flatMap((node) => (node.folder ? [node.folder] : [])))].sort();
  const position = new Map<string, { x: number; y: number }>();
  let warm = 0;
  for (const node of nodes) {
    const before = previous.get(node.id);
    if (node.id === graph.root) position.set(node.id, { ...center });
    else if (before) {
      position.set(node.id, clamp(before.x, before.y));
      warm += 1;
    } else {
      // Each folder starts in its own direction, so neighborhoods form quickly.
      const slot = node.folder ? folders.indexOf(node.folder) : folders.length + (hash(node.id) % 7);
      const angle = (slot / Math.max(1, folders.length + 1)) * Math.PI * 2 + random() * 0.6;
      const reach = (node.kind === "file" ? 0.55 + random() * 0.35 : 0.3) * Math.min(width, height) * 0.5;
      position.set(node.id, clamp(center.x + Math.cos(angle) * reach * (width / height), center.y + Math.sin(angle) * reach));
    }
  }
  const coldStart = warm < nodes.length / 2;
  const iterations = coldStart ? 300 : 90;
  let temperature = coldStart ? Math.min(width, height) / 5 : k / 4;
  const cooling = temperature / (iterations + 1);
  const short = Math.min(width, height);
  const pull = { x: (GRAVITY * k * short) / width, y: (GRAVITY * k * short) / height };
  const ids = nodes.map((node) => node.id);
  for (let step = 0; step < iterations; step += 1) {
    const moves = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let a = 0; a < ids.length; a += 1) {
      const pa = position.get(ids[a] as string) as { x: number; y: number };
      const ma = moves.get(ids[a] as string) as { x: number; y: number };
      for (let b = a + 1; b < ids.length; b += 1) {
        const pb = position.get(ids[b] as string) as { x: number; y: number };
        const mb = moves.get(ids[b] as string) as { x: number; y: number };
        const dx = pa.x - pb.x || (random() - 0.5) * 0.01;
        const dy = pa.y - pb.y || (random() - 0.5) * 0.01;
        const distance = Math.max(0.5, Math.hypot(dx, dy));
        const force = (k * k) / distance;
        ma.x += (dx / distance) * force;
        ma.y += (dy / distance) * force;
        mb.x -= (dx / distance) * force;
        mb.y -= (dy / distance) * force;
      }
    }
    for (const edge of graph.edges) {
      const pa = position.get(edge.from);
      const pb = position.get(edge.to);
      if (!pa || !pb) continue;
      const spring = SPRINGS[edge.kind];
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const distance = Math.max(0.5, Math.hypot(dx, dy));
      const force = (spring.weight * distance * distance) / (k * spring.length);
      const ma = moves.get(edge.from) as { x: number; y: number };
      const mb = moves.get(edge.to) as { x: number; y: number };
      ma.x -= (dx / distance) * force;
      ma.y -= (dy / distance) * force;
      mb.x += (dx / distance) * force;
      mb.y += (dy / distance) * force;
    }
    const middles = new Map<string, { x: number; y: number; count: number }>();
    for (const node of nodes) {
      if (!node.folder) continue;
      const point = position.get(node.id) as { x: number; y: number };
      const sum = middles.get(node.folder) ?? { x: 0, y: 0, count: 0 };
      middles.set(node.folder, { x: sum.x + point.x, y: sum.y + point.y, count: sum.count + 1 });
    }
    for (const node of nodes) {
      if (node.id === graph.root) continue;
      const point = position.get(node.id) as { x: number; y: number };
      const move = moves.get(node.id) as { x: number; y: number };
      move.x += (center.x - point.x) * pull.x;
      move.y += (center.y - point.y) * pull.y;
      const middle = node.folder ? middles.get(node.folder) : undefined;
      if (middle && middle.count > 1) {
        const dx = middle.x / middle.count - point.x;
        const dy = middle.y / middle.count - point.y;
        const distance = Math.hypot(dx, dy);
        move.x += (dx * distance * COHESION) / k;
        move.y += (dy * distance * COHESION) / k;
      }
      const home = coldStart ? undefined : previous.get(node.id);
      if (home) {
        move.x += (home.x - point.x) * ANCHOR;
        move.y += (home.y - point.y) * ANCHOR;
      }
      const length = Math.max(0.01, Math.hypot(move.x, move.y));
      const limit = Math.min(length, temperature);
      position.set(node.id, clamp(point.x + (move.x / length) * limit, point.y + (move.y / length) * limit));
    }
    temperature = Math.max(0.5, temperature - cooling);
  }
  return new Map(
    nodes.map((node) => {
      const point = position.get(node.id) as { x: number; y: number };
      return [node.id, { ...point, side: node.kind === "file" ? sideOf(point, center) : "below" }];
    }),
  );
}

/** Where each folder's files gather, for folders with enough files to name. */
export function folderCenters(graph: Graph, positions: ReadonlyMap<string, { x: number; y: number }>, minimum = 3) {
  const sums = new Map<string, { x: number; y: number; top: number; count: number }>();
  for (const node of graph.nodes) {
    const at = node.folder ? positions.get(node.id) : undefined;
    if (!at || !node.folder) continue;
    const sum = sums.get(node.folder) ?? { x: 0, y: 0, top: Number.POSITIVE_INFINITY, count: 0 };
    sums.set(node.folder, { x: sum.x + at.x, y: sum.y + at.y, top: Math.min(sum.top, at.y), count: sum.count + 1 });
  }
  return [...sums.entries()]
    .filter(([, sum]) => sum.count >= minimum)
    .map(([folder, sum]) => ({ folder, x: sum.x / sum.count, y: sum.y / sum.count, top: sum.top, count: sum.count }));
}
