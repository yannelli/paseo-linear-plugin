import { describe, expect, it } from "vitest";
import { clampCamera, FIT, focusBox, frameBox, growth, MAX_ZOOM, zoomAt } from "../shared/graph-camera";
import type { Graph } from "../shared/graph-model";

const W = 800;
const H = 600;
/** Where a canvas point draws for a camera; the canvas scales around its center. */
const draw = (camera: { x: number; y: number; zoom: number }, p: { x: number; y: number }) => ({
  x: W / 2 + camera.x + camera.zoom * (p.x - W / 2),
  y: H / 2 + camera.y + camera.zoom * (p.y - H / 2),
});

describe("graph camera", () => {
  it("keeps the zoom in range and the canvas covering the view", () => {
    expect(clampCamera({ x: 50, y: 50, zoom: 0.5 }, W, H)).toEqual(FIT);
    const near = clampCamera({ x: 9999, y: -9999, zoom: 2 }, W, H);
    expect(near).toEqual({ x: 400, y: -300, zoom: 2 });
    expect(draw(near, { x: 0, y: 0 }).x).toBe(0);
    expect(draw(near, { x: W, y: H }).y).toBe(H);
    expect(clampCamera({ x: 0, y: 0, zoom: 99 }, W, H).zoom).toBe(MAX_ZOOM);
  });

  it("zooms around the point under the pointer", () => {
    const at = { x: 600, y: 200 };
    const before = { x: 0, y: 0, zoom: 1 };
    const after = zoomAt(before, at, 2, W, H);
    expect(after.zoom).toBe(2);
    expect(draw(after, at)).toEqual(at);
    expect(zoomAt(after, at, 0.25, W, H)).toEqual(FIT);
  });

  it("frames a box in the middle of the view, up to the auto zoom", () => {
    const camera = frameBox({ left: 500, top: 300, right: 700, bottom: 450 }, W, H);
    expect(camera.zoom).toBe(2.5);
    expect(draw(camera, { x: 600, y: 375 })).toEqual({ x: W / 2, y: H / 2 });
    expect(draw(camera, { x: W, y: 0 }).x).toBeGreaterThanOrEqual(W);
    // At the corner, the canvas edge stops at the view edge instead of the box's middle.
    const corner = frameBox({ left: 700, top: 0, right: 800, bottom: 100 }, W, H);
    expect(draw(corner, { x: W, y: 0 })).toEqual({ x: W, y: 0 });
    expect(frameBox({ left: -100, top: -100, right: 900, bottom: 700 }, W, H)).toEqual(FIT);
  });

  it("centers on the focus as far as the box stays in view", () => {
    const box = { left: 500, top: 300, right: 700, bottom: 450 };
    const camera = frameBox({ ...box, center: { x: 520, y: 320 } }, W, H);
    expect(camera.zoom).toBe(2.5);
    // The focus moves toward the middle until the box's far corner reaches the view edge.
    expect(draw(camera, { x: 540, y: 330 })).toEqual({ x: W / 2, y: H / 2 });
    expect(draw(camera, { x: 700, y: 450 })).toEqual({ x: W, y: H });
    expect(draw(camera, { x: 500, y: 300 }).x).toBeGreaterThanOrEqual(0);
    const inside = frameBox({ ...box, center: { x: 600, y: 380 } }, W, H);
    expect(draw(inside, { x: 600, y: 380 })).toEqual({ x: W / 2, y: H / 2 });
  });

  it("grows parts of the graph by the square root of the zoom", () => {
    expect(growth(1)).toBe(1);
    expect(growth(4)).toBe(2);
  });
});

describe("focusBox", () => {
  const node = (id: string, kind: "issue" | "subissue" | "file") => ({
    id,
    kind,
    label: id,
    owner: null,
    path: null,
    tile: null,
    folder: null,
    folded: 0,
  });
  const graph: Graph = {
    root: "issue:ENG-1",
    nodes: [node("issue:ENG-1", "issue"), node("sub:ENG-2", "subissue"), node("file:a.ts", "file"), node("file:b.ts", "file"), node("file:far.ts", "file")],
    edges: [
      { id: "1", from: "issue:ENG-1", to: "sub:ENG-2", kind: "owns" },
      { id: "2", from: "sub:ENG-2", to: "file:a.ts", kind: "owns" },
      { id: "3", from: "file:a.ts", to: "file:b.ts", kind: "import" },
    ],
  };
  const positions = new Map([
    ["issue:ENG-1", { x: 400, y: 300 }],
    ["sub:ENG-2", { x: 500, y: 300 }],
    ["file:a.ts", { x: 600, y: 250 }],
    ["file:b.ts", { x: 650, y: 350 }],
    ["file:far.ts", { x: 50, y: 50 }],
  ]);

  it("covers the agents' nodes and their neighbors, but not the issue", () => {
    expect(focusBox(graph, positions, ["file:a.ts"])).toEqual({
      left: 410,
      top: 194,
      right: 740,
      bottom: 406,
      center: { x: 600, y: 250 },
    });
  });

  it("shows the whole graph when the agents work on the issue itself", () => {
    expect(focusBox(graph, positions, ["issue:ENG-1"])).toBeNull();
    expect(focusBox(graph, positions, [])).toBeNull();
  });
});
