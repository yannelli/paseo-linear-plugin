import type { Point } from "./graph-geometry";
import type { Graph } from "./graph-model";

// The graph camera shifts and zooms the canvas, which scales around its center. A canvas
// point p draws at center + shift + zoom * (p - center). Zoom 1 with no shift shows it all.

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const FIT: Camera = { x: 0, y: 0, zoom: 1 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** Auto mode zooms no further than this, so the nodes around the agents stay in view. */
const AUTO_ZOOM = 2.5;
const PAD_X = 90;
const PAD_Y = 56;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Where a canvas point draws in the view. */
export function project(camera: Camera, at: Point, width: number, height: number): Point {
  return {
    x: width / 2 + camera.x + camera.zoom * (at.x - width / 2),
    y: height / 2 + camera.y + camera.zoom * (at.y - height / 2),
  };
}

/** The canvas point that draws at a point of the view. */
export function unproject(camera: Camera, at: Point, width: number, height: number): Point {
  return {
    x: width / 2 + (at.x - width / 2 - camera.x) / camera.zoom,
    y: height / 2 + (at.y - height / 2 - camera.y) / camera.zoom,
  };
}

/** Keeps the zoom in range and the canvas edges at or past the edges of the view. */
export function clampCamera(camera: Camera, width: number, height: number): Camera {
  const zoom = clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM);
  const spanX = ((zoom - 1) * width) / 2;
  const spanY = ((zoom - 1) * height) / 2;
  return { zoom, x: clamp(camera.x, -spanX, spanX), y: clamp(camera.y, -spanY, spanY) };
}

/** Zooms by a factor and keeps the canvas point under `at` where it is. */
export function zoomAt(camera: Camera, at: Point, factor: number, width: number, height: number): Camera {
  const zoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const cx = width / 2;
  const cy = height / 2;
  const px = cx + (at.x - cx - camera.x) / camera.zoom;
  const py = cy + (at.y - cy - camera.y) / camera.zoom;
  return clampCamera({ zoom, x: at.x - cx - zoom * (px - cx), y: at.y - cy - zoom * (py - cy) }, width, height);
}

/** Shows the box as large as fits in the view, up to the auto zoom. */
export function frameBox(box: Box, width: number, height: number): Camera {
  const fit = Math.min(width / Math.max(1, box.right - box.left), height / Math.max(1, box.bottom - box.top));
  const zoom = clamp(fit, MIN_ZOOM, AUTO_ZOOM);
  const x = zoom * (width / 2 - (box.left + box.right) / 2);
  const y = zoom * (height / 2 - (box.top + box.bottom) / 2);
  return clampCamera({ zoom, x, y }, width, height);
}

// The area auto mode shows: the nodes the running agents work on and their neighbors, with
// room for labels and cursors. Null when no agent works on a node other than the issue.
export function focusBox(graph: Graph, positions: ReadonlyMap<string, Point>, targets: Iterable<string>): Box | null {
  const ids = new Set<string>();
  for (const target of targets) if (target !== graph.root) ids.add(target);
  if (ids.size === 0) return null;
  for (const edge of graph.edges) {
    if (ids.has(edge.from) && edge.to !== graph.root) ids.add(edge.to);
    else if (ids.has(edge.to) && edge.from !== graph.root) ids.add(edge.from);
  }
  let box: Box | null = null;
  for (const id of ids) {
    const at = positions.get(id);
    if (!at) continue;
    box = box
      ? { left: Math.min(box.left, at.x), top: Math.min(box.top, at.y), right: Math.max(box.right, at.x), bottom: Math.max(box.bottom, at.y) }
      : { left: at.x, top: at.y, right: at.x, bottom: at.y };
  }
  if (!box) return null;
  return { left: box.left - PAD_X, top: box.top - PAD_Y, right: box.right + PAD_X, bottom: box.bottom + PAD_Y };
}
