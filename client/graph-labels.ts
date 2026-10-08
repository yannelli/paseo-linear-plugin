import { type LabelRequest, labelBox, labelSides, type Placed, type Point, placeLabels } from "../shared/graph-geometry";
import { folderCenters, type Graph, type GraphNode } from "../shared/graph-model";
import type { IssueDetail } from "../shared/linear";
import { todoStatus } from "../shared/todo-sync";
import type { IssueProgress } from "./live-issues";

// Which labels the graph shows and where: issues first, then folder names, then the files the
// agent works on, then touched files. A label that fits nowhere is hidden.

const SIZES = { issue: 46, subissue: 32 } as const;
export const HOVER_GAP = 22;

/** About how wide a cursor caption draws. */
export const captionWidth = (text: string | null) => (text ? Math.min(190, text.length * 6.2 + 18) : 0);
const MAX_LABEL = 170;

export function nodeSize(node: GraphNode): number {
  if (node.kind !== "file") return SIZES[node.kind];
  const touched = node.tile && node.tile.touch !== "none";
  return touched ? (node.tile?.touch === "read" ? 12 : 14) : 9;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export interface Label {
  left: number;
  top: number;
  width: number;
  lines: readonly [string, string | null];
}

export interface FolderLabel {
  folder: string;
  left: number;
  top: number;
  width: number;
}

export interface LabelInput {
  graph: Graph;
  positions: ReadonlyMap<string, Placed>;
  issue: IssueDetail;
  progress: IssueProgress;
  selected: string | null;
  /** Nodes a running agent works on. */
  working: ReadonlySet<string>;
  /** Where each agent hovers, with the width of its caption and the side it shows on. */
  cursors: readonly { at: Point; caption: number; flip: boolean }[];
  width: number;
  height: number;
}

function linesOf(node: GraphNode, input: LabelInput): readonly [string, string | null] {
  if (node.kind === "issue") return [node.label, clip(input.issue.title, 34)];
  if (node.kind === "file") return [node.label, null];
  const child = input.issue.children.find((entry) => entry.identifier.toUpperCase() === node.label);
  const todos = input.progress.groups.get(node.label) ?? [];
  const done = todos.filter((todo) => todoStatus(todo) === "completed").length;
  const counts = todos.length > 0 ? `  ${done}/${todos.length}` : "";
  const folded = node.folded > 0 ? `  +${node.folded}` : "";
  return [`${node.label}${counts}${folded}`, clip(child?.title ?? "", 26)];
}

const textWidth = (text: string, perChar: number) => Math.min(MAX_LABEL, text.length * perChar + 4);

export function graphLabels(input: LabelInput): { nodes: Map<string, Label>; folders: FolderLabel[] } {
  const { graph, positions, selected, working } = input;
  const order = (node: GraphNode) =>
    node.id === selected ? 0 : node.kind === "issue" ? 1 : node.kind === "subissue" ? 2 : working.has(node.id) ? 4 : 5;
  const wanted = graph.nodes
    .filter((node) => node.kind !== "file" || node.id === selected || working.has(node.id) || (node.tile?.touch ?? "none") !== "none")
    .sort((a, b) => order(a) - order(b));
  const lines = new Map<string, readonly [string, string | null]>();
  const requests: LabelRequest[] = [];
  const push = (node: GraphNode) => {
    const at = positions.get(node.id);
    if (!at) return;
    const text = linesOf(node, input);
    const perChar = node.kind === "issue" ? 7.4 : 6.2;
    const width = Math.max(textWidth(text[0], perChar), text[1] ? textWidth(text[1], 5.6) : 0);
    const height = text[1] ? 28 : 14;
    const spotsFor = (w: number, h: number) =>
      labelSides(at.side).map((side) => labelBox({ ...at, side }, nodeSize(node) / 2, w, h));
    const short = textWidth(text[0], perChar);
    lines.set(node.id, text);
    requests.push({
      id: node.id,
      width,
      height,
      spots: spotsFor(width, height),
      fallback: text[1] ? { width: short, height: 14, spots: spotsFor(short, 14) } : undefined,
    });
  };
  for (const node of wanted.filter((entry) => order(entry) <= 2)) push(node);
  // Folder names sit above each neighborhood, after the issues and before single files.
  const folderIds = new Map<string, string>();
  for (const center of folderCenters(graph, positions)) {
    const name = center.folder === "." ? "/" : `${center.folder}/`;
    const width = textWidth(name, 6);
    const id = `folder:${center.folder}`;
    folderIds.set(id, center.folder);
    requests.push({ id, width, height: 14, spots: [{ left: center.x - width / 2, top: center.top - 30 }, { left: center.x - width / 2, top: center.y - 7 }] });
  }
  for (const node of wanted.filter((entry) => order(entry) > 2)) push(node);
  const shapes: { at: Point; radius: number }[] = graph.nodes.flatMap((node) => {
    const at = positions.get(node.id);
    return at ? [{ at, radius: nodeSize(node) / 2 }] : [];
  });
  // Keep labels out from under the agents and their captions, as a row of small circles.
  for (const cursor of input.cursors) {
    shapes.push({ at: cursor.at, radius: 16 });
    for (let offset = 24; offset < cursor.caption + 24; offset += 14) {
      shapes.push({ at: { x: cursor.at.x + (cursor.flip ? -offset : offset), y: cursor.at.y }, radius: 10 });
    }
  }
  const sizes = new Map(requests.map((request) => [request.id, request]));
  const nodes = new Map<string, Label>();
  const folders: FolderLabel[] = [];
  for (const [id, box] of placeLabels(requests, input.width, input.height, shapes)) {
    const request = sizes.get(id) as LabelRequest;
    const folder = folderIds.get(id);
    if (folder !== undefined) {
      folders.push({ folder, left: box.left, top: box.top, width: request.width });
      continue;
    }
    const text = lines.get(id) ?? ["", null];
    nodes.set(id, {
      left: box.left,
      top: box.top,
      width: (box.short ? request.fallback?.width : request.width) ?? 0,
      lines: box.short ? [text[0], null] : text,
    });
  }
  return { nodes, folders };
}
