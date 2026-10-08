import type { AgentFocus } from "./activity";
import type { MapTile } from "./map-model";

// The Linear Live graph is the issue tree: the issue, its sub-issues, and the files of each.
// Files that no sub-issue names hang from the issue. Pure, so tests can check the layout.

export type GraphNodeKind = "issue" | "subissue" | "file";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Issue key whose color the node takes. */
  owner: string | null;
  /** The node one level up the tree; null for the issue. */
  parent: string | null;
  /** Repo path, for file nodes. */
  path: string | null;
  tile: MapTile | null;
  /** Untouched predicted files left out to keep the graph readable. */
  folded: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
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
}

const MAX_UNTOUCHED_PER_OWNER = 6;
const MAX_FILES = 70;

export const issueNodeId = (key: string) => `issue:${key.toUpperCase()}`;
export const subIssueNodeId = (key: string) => `sub:${key.toUpperCase()}`;
export const fileNodeId = (path: string) => `file:${path}`;

export function buildGraph(input: GraphInput): Graph {
  const parentKey = input.issue.toUpperCase();
  const root = issueNodeId(parentKey);
  const children = new Set(input.children.map((key) => key.toUpperCase()));
  const hubOf = (owner: string | null) =>
    owner && children.has(owner.toUpperCase()) ? subIssueNodeId(owner) : root;
  const nodes = new Map<string, GraphNode>();
  const add = (node: Omit<GraphNode, "folded" | "tile" | "path"> & Partial<GraphNode>) => {
    if (!nodes.has(node.id)) nodes.set(node.id, { path: null, tile: null, folded: 0, ...node });
  };
  add({ id: root, kind: "issue", label: parentKey, owner: parentKey, parent: null });
  for (const key of children) {
    add({ id: subIssueNodeId(key), kind: "subissue", label: key, owner: key, parent: root });
  }

  // Touched files first, then predicted ones, up to a cap per owner.
  const tiles = input.tiles.filter((tile) => !tile.ghost);
  const touched = tiles.filter((tile) => tile.touch !== "none");
  const untouched = tiles.filter((tile) => tile.touch === "none" && tile.onMap);
  const perOwner = new Map<string, number>();
  const files: MapTile[] = [...touched];
  for (const tile of untouched) {
    const hub = hubOf(tile.owner);
    const count = perOwner.get(hub) ?? 0;
    if (count >= MAX_UNTOUCHED_PER_OWNER || files.length >= MAX_FILES) {
      const target = nodes.get(hub);
      if (target) target.folded += 1;
      continue;
    }
    perOwner.set(hub, count + 1);
    files.push(tile);
  }
  for (const tile of files.slice(0, MAX_FILES)) {
    add({
      id: fileNodeId(tile.path),
      kind: "file",
      label: tile.path.split("/").pop() ?? tile.path,
      owner: tile.owner,
      parent: hubOf(tile.owner),
      path: tile.path,
      tile,
    });
  }
  const list = [...nodes.values()];
  const edges = list.flatMap((node) =>
    node.parent ? [{ id: `${node.parent}>${node.id}`, from: node.parent, to: node.id }] : [],
  );
  return { root, nodes: list, edges };
}

/** Changes only when a node comes or goes; then the layout runs again. */
export function graphKey(graph: Graph): string {
  return graph.nodes.map((node) => `${node.id}<${node.parent ?? ""}`).sort().join("|");
}

/** The nodes from one node to another along the tree, through their nearest shared issue. */
export function treePath(graph: Graph, from: string, to: string): string[] {
  const parents = new Map(graph.nodes.map((node) => [node.id, node.parent]));
  const chain = (id: string) => {
    const ids: string[] = [];
    for (let at: string | null = id; at !== null && parents.has(at); at = parents.get(at) ?? null) {
      ids.push(at);
    }
    return ids;
  };
  const up = chain(from);
  const down = chain(to);
  if (down.length === 0) return [];
  const shared = up.findIndex((id) => down.includes(id));
  if (shared < 0) return [to];
  const meet = up[shared] as string;
  return [...up.slice(0, shared + 1), ...down.slice(0, down.indexOf(meet)).reverse()];
}

/** The node an agent works on: its file or sub-issue when the graph has it, else the issue. */
export function focusNode(graph: Graph, focus: AgentFocus | null): string {
  if (!focus) return graph.root;
  const id = focus.kind === "issue" ? subIssueNodeId(focus.key) : fileNodeId(focus.path);
  return graph.nodes.some((node) => node.id === id) ? id : graph.root;
}

export interface Point {
  x: number;
  y: number;
}

export interface Route {
  points: Point[];
  /** Each point's share of the whole distance, from 0 to 1. */
  stops: number[];
  length: number;
}

/** Where a route is at a share of its distance, from 0 to 1. */
export function pointAt(path: Route, share: number): Point {
  const at = Math.min(1, Math.max(0, share));
  for (let index = 1; index < path.stops.length; index += 1) {
    const stop = path.stops[index] as number;
    if (at > stop) continue;
    const before = path.stops[index - 1] as number;
    const from = path.points[index - 1] as Point;
    const to = path.points[index] as Point;
    const part = stop > before ? (at - before) / (stop - before) : 1;
    return { x: from.x + (to.x - from.x) * part, y: from.y + (to.y - from.y) * part };
  }
  return path.points[path.points.length - 1] as Point;
}

/** A route through the points without zero-length steps, or null when there is nowhere to go. */
export function route(points: readonly Point[]): Route | null {
  const kept: Point[] = [];
  const steps = [0];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (!last) kept.push(point);
    else {
      const step = Math.hypot(point.x - last.x, point.y - last.y);
      if (step < 0.5) continue;
      kept.push(point);
      steps.push((steps[steps.length - 1] as number) + step);
    }
  }
  const length = steps[steps.length - 1] as number;
  if (kept.length < 2) return null;
  return { points: kept, stops: steps.map((step) => step / length), length };
}

export type LabelSide = "below" | "above" | "left" | "right";

export interface Placed extends Point {
  side: LabelSide;
}

/** Sub-issues sit on this fraction of the file ring. */
export const HUB_RING = 0.46;
const STAGGER_RING = 0.8;
const MIN_SPACING = 46;
const LABEL_ROOM = 104;

function sideOf(angle: number): LabelSide {
  const cos = Math.cos(angle);
  if (cos > 0.3) return "right";
  if (cos < -0.3) return "left";
  return Math.sin(angle) > 0 ? "below" : "above";
}

// The issue sits in the center, sub-issues on an inner ring, and each sub-issue's files on the
// outer ring inside its own slice, so a file never moves to another sub-issue's side.
export function treeLayout(graph: Graph, width: number, height: number): Map<string, Placed> {
  const center = { x: width / 2, y: height / 2 };
  const rx = Math.max(40, width / 2 - Math.min(LABEL_ROOM, width * 0.18));
  // Room above the top files for an agent hovering over them.
  const ry = Math.max(40, height / 2 - 44);
  const positions = new Map<string, Placed>([[graph.root, { ...center, side: "below" }]]);
  const byPath = (a: GraphNode, b: GraphNode) => (a.path ?? a.id).localeCompare(b.path ?? b.id);
  const filesOf = (hub: string) =>
    graph.nodes.filter((node) => node.kind === "file" && node.parent === hub).sort(byPath);
  const groups = graph.nodes
    .filter((node) => node.kind === "subissue")
    .map((node) => ({ hub: node.id as string | null, files: filesOf(node.id) }));
  const loose = filesOf(graph.root);
  if (loose.length > 0) groups.push({ hub: null, files: loose });
  if (groups.length === 0) return positions;

  const weights = groups.map((group) => Math.max(1, group.files.length) + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  // Ramanujan's ellipse perimeter, to tell whether neighbors on the ring need staggering.
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const stagger = perimeter / total < MIN_SPACING;
  const ring = (angle: number, scale: number): Placed => ({
    x: center.x + Math.cos(angle) * rx * scale,
    y: center.y + Math.sin(angle) * ry * scale,
    side: sideOf(angle),
  });
  let start = -Math.PI / 2 - (Math.PI * (weights[0] as number)) / total;
  groups.forEach((group, index) => {
    const span = (2 * Math.PI * (weights[index] as number)) / total;
    if (group.hub) positions.set(group.hub, { ...ring(start + span / 2, HUB_RING), side: "below" });
    group.files.forEach((file, slot) => {
      const angle = start + (span * (slot + 1)) / (group.files.length + 1);
      positions.set(file.id, ring(angle, stagger && slot % 2 === 1 ? STAGGER_RING : 1));
    });
    start += span;
  });
  return positions;
}

/** Where a label of this size goes on its node's side. */
export function labelBox(at: Placed, radius: number, width: number, height: number): { left: number; top: number } {
  if (at.side === "right") return { left: at.x + radius + 5, top: at.y - height / 2 };
  if (at.side === "left") return { left: at.x - radius - 5 - width, top: at.y - height / 2 };
  if (at.side === "above") return { left: at.x - width / 2, top: at.y - radius - 3 - height };
  return { left: at.x - width / 2, top: at.y + radius + 3 };
}

/** The sides to try for a label, best first: the outward side, then the others. */
export function labelSides(side: LabelSide): LabelSide[] {
  if (side === "left" || side === "right") return [side, "above", "below"];
  return side === "below" ? ["below", "above", "right", "left"] : ["above", "below", "right", "left"];
}

export interface LabelRequest {
  id: string;
  width: number;
  height: number;
  /** Where the label may go, best first. */
  spots: readonly { left: number; top: number }[];
  /** A shorter label to try when the full one has no free spot. */
  fallback?: { width: number; height: number; spots: readonly { left: number; top: number }[] };
}

export interface PlacedLabel {
  left: number;
  top: number;
  /** The fallback was used. */
  short: boolean;
}

// Places labels in request order at the first spot that overlaps no node or placed label,
// moved inside the box when it would cross an edge. A label with no free spot is hidden.
export function placeLabels(
  requests: readonly LabelRequest[],
  width: number,
  height: number,
  nodes: readonly { at: Point; radius: number }[] = [],
  gap = 3,
): Map<string, PlacedLabel> {
  const placed = nodes.map(({ at, radius }) => ({
    left: at.x - radius,
    right: at.x + radius,
    top: at.y - radius,
    bottom: at.y + radius,
  }));
  const shown = new Map<string, PlacedLabel>();
  for (const request of requests) {
    const tries = [{ ...request, short: false }];
    if (request.fallback) tries.push({ ...request, ...request.fallback, short: true });
    find: for (const attempt of tries) {
      for (const spot of attempt.spots) {
        const left = Math.min(Math.max(0, width - attempt.width), Math.max(0, spot.left));
        const top = Math.min(Math.max(0, height - attempt.height), Math.max(0, spot.top));
        const box = { left: left - gap, right: left + attempt.width + gap, top, bottom: top + attempt.height };
        const hit = placed.some(
          (other) => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom,
        );
        if (hit) continue;
        placed.push(box);
        shown.set(request.id, { left, top, short: attempt.short });
        break find;
      }
    }
  }
  return shown;
}
