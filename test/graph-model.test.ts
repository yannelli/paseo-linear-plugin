import { describe, expect, it } from "vitest";
import {
  buildGraph,
  focusNode,
  type GraphInput,
  graphKey,
  HUB_RING,
  labelBox,
  placeLabels,
  pointAt,
  route,
  treeLayout,
  treePath,
} from "../shared/graph-model";
import type { MapTile } from "../shared/map-model";

const tile = (path: string, owner: string | null, touch: MapTile["touch"] = "none"): MapTile => ({
  path,
  name: path.split("/").pop() ?? path,
  owner,
  ghost: false,
  onMap: owner !== null,
  touch,
  added: 0,
  removed: 0,
});

const input = (extra: MapTile[] = []): GraphInput => ({
  issue: "ENG-1",
  children: ["ENG-2", "ENG-3"],
  tiles: [
    tile("src/a.ts", "ENG-2", "read"),
    tile("src/b.ts", "ENG-2"),
    tile("lib/c.ts", "ENG-3", "edited"),
    tile("README.md", null, "read"),
    tile("docs/plan.md", "ENG-1"),
    ...extra,
  ],
});

describe("graph", () => {
  it("builds the issue tree with files under their sub-issue", () => {
    const graph = buildGraph(input());
    const parents = Object.fromEntries(graph.nodes.map((node) => [node.id, node.parent]));
    expect(graph.root).toBe("issue:ENG-1");
    expect(parents).toEqual({
      "issue:ENG-1": null,
      "sub:ENG-2": "issue:ENG-1",
      "sub:ENG-3": "issue:ENG-1",
      "file:src/a.ts": "sub:ENG-2",
      "file:src/b.ts": "sub:ENG-2",
      "file:lib/c.ts": "sub:ENG-3",
      "file:README.md": "issue:ENG-1",
      "file:docs/plan.md": "issue:ENG-1",
    });
    expect(graph.edges.map((edge) => edge.id)).toContain("sub:ENG-2>file:src/b.ts");
    expect(graph.edges).toHaveLength(graph.nodes.length - 1);
  });

  it("folds untouched predicted files past six per sub-issue", () => {
    const many = Array.from({ length: 9 }, (_, index) => tile(`src/f${index}.ts`, "ENG-3"));
    const graph = buildGraph(input(many));
    expect(graph.nodes.find((node) => node.id === "sub:ENG-3")?.folded).toBe(3);
    expect(graph.nodes.filter((node) => node.parent === "sub:ENG-3")).toHaveLength(7);
  });

  it("keeps the key when only touches change", () => {
    const moved = { ...input(), tiles: input().tiles.map((t) => ({ ...t, touch: "read" as const })) };
    expect(graphKey(buildGraph(moved))).toBe(graphKey(buildGraph(input())));
  });
});

describe("tree path", () => {
  const graph = buildGraph(input());

  it("goes up to the shared issue and down again", () => {
    expect(treePath(graph, "file:src/a.ts", "file:src/b.ts")).toEqual(["file:src/a.ts", "sub:ENG-2", "file:src/b.ts"]);
    expect(treePath(graph, "file:src/a.ts", "file:lib/c.ts")).toEqual([
      "file:src/a.ts",
      "sub:ENG-2",
      "issue:ENG-1",
      "sub:ENG-3",
      "file:lib/c.ts",
    ]);
    expect(treePath(graph, "file:lib/c.ts", "sub:ENG-3")).toEqual(["file:lib/c.ts", "sub:ENG-3"]);
  });

  it("finds the node an agent works on, or the issue", () => {
    expect(focusNode(graph, { kind: "file", path: "src/a.ts" })).toBe("file:src/a.ts");
    expect(focusNode(graph, { kind: "issue", key: "ENG-3" })).toBe("sub:ENG-3");
    expect(focusNode(graph, { kind: "file", path: "not/shown.ts" })).toBe("issue:ENG-1");
    expect(focusNode(graph, null)).toBe("issue:ENG-1");
  });

  it("drops zero-length steps from a route", () => {
    const path = route([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 40 }, { x: 30, y: 90 }]);
    expect(path).toEqual({ points: [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 90 }], stops: [0, 0.5, 1], length: 100 });
    expect(route([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toBeNull();
  });

  it("finds the point at a share of a route", () => {
    const path = route([{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 90 }])!;
    expect(pointAt(path, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(path, 0.25)).toEqual({ x: 15, y: 20 });
    expect(pointAt(path, 0.75)).toEqual({ x: 30, y: 65 });
    expect(pointAt(path, 1.2)).toEqual({ x: 30, y: 90 });
  });

  it("goes straight to the target from a node that is not in the graph", () => {
    expect(treePath(graph, "file:gone.ts", "sub:ENG-2")).toEqual(["sub:ENG-2"]);
    expect(treePath(graph, "sub:ENG-2", "file:gone.ts")).toEqual([]);
  });
});

describe("layout", () => {
  const W = 900;
  const H = 520;

  it("puts the issue in the center, sub-issues inside, and files on the outer ring", () => {
    const graph = buildGraph(input());
    const at = treeLayout(graph, W, H);
    expect(at.get("issue:ENG-1")).toMatchObject({ x: W / 2, y: H / 2 });
    const reach = (id: string) => {
      const point = at.get(id)!;
      const rx = W / 2 - 104;
      const ry = H / 2 - 44;
      return Math.hypot((point.x - W / 2) / rx, (point.y - H / 2) / ry);
    };
    expect(reach("sub:ENG-2")).toBeCloseTo(HUB_RING);
    expect(reach("file:src/a.ts")).toBeCloseTo(1);
    expect(reach("file:README.md")).toBeCloseTo(1);
    expect(treeLayout(graph, W, H)).toEqual(at);
  });

  it("keeps each sub-issue's files in its own slice, near the sub-issue", () => {
    const many = Array.from({ length: 12 }, (_, index) => tile(`src/f${index}.ts`, index % 2 ? "ENG-2" : "ENG-3", "read"));
    const graph = buildGraph(input(many));
    const at = treeLayout(graph, W, H);
    const angle = (id: string) => Math.atan2((at.get(id)!.y - H / 2) / (H / 2 - 44), (at.get(id)!.x - W / 2) / (W / 2 - 104));
    const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    for (const node of graph.nodes.filter((n) => n.kind === "file" && n.parent?.startsWith("sub:"))) {
      const own = gap(angle(node.id), angle(node.parent!));
      const other = node.parent === "sub:ENG-2" ? "sub:ENG-3" : "sub:ENG-2";
      expect(own).toBeLessThan(gap(angle(node.id), angle(other)));
    }
  });

  it("keeps a large graph inside the box", () => {
    const many = Array.from({ length: 60 }, (_, index) => tile(`src/f${index}.ts`, index % 2 ? "ENG-2" : "ENG-3", "read"));
    for (const [w, h] of [[360, 420], [1400, 680]]) {
      for (const point of treeLayout(buildGraph(input(many)), w!, h!).values()) {
        expect(point.x).toBeGreaterThan(0);
        expect(point.x).toBeLessThan(w!);
        expect(point.y).toBeGreaterThan(0);
        expect(point.y).toBeLessThan(h!);
      }
    }
  });
});

describe("labels", () => {
  const request = (id: string, left: number, top: number, width = 60) => ({ id, width, height: 14, spots: [{ left, top }] });

  it("puts labels on the side of the node that faces out", () => {
    expect(labelBox({ x: 100, y: 50, side: "right" }, 6, 40, 14)).toEqual({ left: 111, top: 43 });
    expect(labelBox({ x: 100, y: 50, side: "left" }, 6, 40, 14)).toEqual({ left: 49, top: 43 });
    expect(labelBox({ x: 100, y: 50, side: "below" }, 6, 40, 14)).toEqual({ left: 80, top: 59 });
  });

  it("hides a later label that overlaps an earlier one", () => {
    const shown = placeLabels([request("a", 70, 108), request("b", 100, 110), request("c", 70, 148)], 400, 300);
    expect([...shown.keys()]).toEqual(["a", "c"]);
  });

  it("hides a label that would cover another node", () => {
    const nodes = [{ at: { x: 110, y: 115 }, radius: 6 }];
    const shown = placeLabels([request("a", 70, 108), request("b", 270, 108)], 400, 300, nodes);
    expect([...shown.keys()]).toEqual(["b"]);
  });

  it("tries the next spot before hiding a label", () => {
    const blocked = request("a", 70, 108);
    const second = { ...request("b", 80, 110), spots: [{ left: 80, top: 110 }, { left: 80, top: 80 }] };
    expect([...placeLabels([blocked, second], 400, 300)]).toEqual([
      ["a", { left: 70, top: 108, short: false }],
      ["b", { left: 80, top: 80, short: false }],
    ]);
  });

  it("moves a label at the edge back inside the box", () => {
    const shown = placeLabels([request("left", -20, 50), request("right", 365, 292)], 400, 300);
    expect(shown.get("left")).toEqual({ left: 0, top: 50, short: false });
    expect(shown.get("right")).toEqual({ left: 340, top: 286, short: false });
  });

  it("uses the shorter label when the full one does not fit", () => {
    const wide = { ...request("a", 0, 0, 400), fallback: { width: 40, height: 14, spots: [{ left: 10, top: 0 }] } };
    const shown = placeLabels([request("x", 100, 0)], 400, 300);
    expect(shown.size).toBe(1);
    expect(placeLabels([request("x", 100, 0), wide], 400, 300).get("a")).toEqual({ left: 10, top: 0, short: true });
  });
});
