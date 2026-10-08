import { describe, expect, it } from "vitest";
import {
  buildGraph,
  focusNode,
  folderCenters,
  type GraphInput,
  graphKey,
  graphPath,
  layoutGraph,
  MAX_GRAPH_FILES,
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

const input = (extra: Partial<GraphInput> = {}): GraphInput => ({
  issue: "ENG-1",
  children: ["ENG-2", "ENG-3"],
  tiles: [
    tile("src/cart/a.ts", "ENG-2", "read"),
    tile("src/cart/b.ts", "ENG-2"),
    tile("src/pay/c.ts", "ENG-3", "edited"),
    tile("README.md", null, "read"),
    tile("docs/plan.md", "ENG-1"),
  ],
  links: [
    { from: "src/cart/a.ts", to: "src/cart/b.ts", kind: "import" },
    { from: "src/cart/b.ts", to: "src/cart/a.ts", kind: "mention" },
    { from: "src/pay/c.ts", to: "src/cart/a.ts", kind: "import" },
    { from: "README.md", to: "docs/plan.md", kind: "link" },
    { from: "src/pay/c.ts", to: "src/not-shown.ts", kind: "import" },
  ],
  ...extra,
});

describe("graph", () => {
  it("joins files by their links and planned files to their issue", () => {
    const graph = buildGraph(input());
    const edges = Object.fromEntries(graph.edges.map((edge) => [edge.id, edge.kind]));
    expect(edges).toEqual({
      "issue:ENG-1>sub:ENG-2": "owns",
      "issue:ENG-1>sub:ENG-3": "owns",
      "file:src/cart/a.ts>sub:ENG-2": "owns",
      "file:src/cart/b.ts>sub:ENG-2": "owns",
      "file:src/pay/c.ts>sub:ENG-3": "owns",
      "file:docs/plan.md>issue:ENG-1": "owns",
      "file:src/cart/a.ts>file:src/cart/b.ts": "import",
      "file:src/cart/a.ts>file:src/pay/c.ts": "import",
      "file:README.md>file:docs/plan.md": "link",
    });
    expect(graph.nodes.find((node) => node.id === "file:src/cart/a.ts")?.folder).toBe("src/cart");
    expect(graph.nodes.find((node) => node.id === "file:README.md")?.folder).toBe(".");
  });

  it("keeps every touched file up to the cap and folds predicted ones past six per issue", () => {
    const many = Array.from({ length: 9 }, (_, index) => tile(`src/f${index}.ts`, "ENG-3"));
    const graph = buildGraph(input({ tiles: [...input().tiles, ...many] }));
    expect(graph.nodes.find((node) => node.id === "sub:ENG-3")?.folded).toBe(3);
    const touched = Array.from({ length: MAX_GRAPH_FILES + 5 }, (_, index) => tile(`lib/t${index}.ts`, null, "read"));
    expect(buildGraph(input({ tiles: touched })).nodes.filter((node) => node.kind === "file")).toHaveLength(MAX_GRAPH_FILES);
  });

  it("changes the key when a link comes, not when a touch changes", () => {
    const first = graphKey(buildGraph(input()));
    const touched = input({ tiles: input().tiles.map((t) => ({ ...t, touch: "read" as const })) });
    expect(graphKey(buildGraph(touched))).toBe(first);
    expect(graphKey(buildGraph(input({ links: [] })))).not.toBe(first);
  });
});

describe("paths", () => {
  const graph = buildGraph(input());

  it("walks along links and issues", () => {
    expect(graphPath(graph, "file:src/cart/b.ts", "file:src/pay/c.ts")).toEqual([
      "file:src/cart/b.ts",
      "file:src/cart/a.ts",
      "file:src/pay/c.ts",
    ]);
    expect(graphPath(graph, "file:src/pay/c.ts", "sub:ENG-3")).toEqual(["file:src/pay/c.ts", "sub:ENG-3"]);
  });

  it("hops straight across when nothing connects the nodes", () => {
    const loose = buildGraph(input({ tiles: [tile("a.ts", null, "read"), tile("b.ts", null, "read")], links: [] }));
    expect(graphPath(loose, "file:a.ts", "file:b.ts")).toEqual(["file:a.ts", "file:b.ts"]);
    expect(graphPath(loose, "file:gone.ts", "file:b.ts")).toEqual(["file:b.ts"]);
    expect(graphPath(loose, "file:a.ts", "file:gone.ts")).toEqual([]);
  });

  it("finds the node an agent works on, or the issue", () => {
    expect(focusNode(graph, { kind: "file", path: "src/cart/a.ts" })).toBe("file:src/cart/a.ts");
    expect(focusNode(graph, { kind: "issue", key: "ENG-3" })).toBe("sub:ENG-3");
    expect(focusNode(graph, { kind: "file", path: "not/shown.ts" })).toBe("issue:ENG-1");
    expect(focusNode(graph, null)).toBe("issue:ENG-1");
  });
});

describe("layout", () => {
  const W = 960;
  const H = 560;
  // Two folders of linked files and a few loose ones, like a small feature branch.
  const big = (): GraphInput => {
    const folders = ["src/cart", "src/pay", "docs", ".github/workflows"];
    const tiles = folders.flatMap((folder, f) =>
      Array.from({ length: 8 }, (_, index) => tile(`${folder}/file${index}.ts`, f < 2 ? `ENG-${f + 2}` : null, "read")),
    );
    const links = folders.flatMap((folder) =>
      Array.from({ length: 7 }, (_, index) => ({ from: `${folder}/file${index}.ts`, to: `${folder}/file${index + 1}.ts`, kind: "import" as const })),
    );
    return input({ tiles, links });
  };

  it("is the same for the same graph, keeps the issue in the center, and stays inside the box", () => {
    const graph = buildGraph(big());
    const a = layoutGraph(graph, W, H);
    expect(layoutGraph(graph, W, H)).toEqual(a);
    expect(a.get("issue:ENG-1")).toMatchObject({ x: W / 2, y: H / 2 });
    for (const point of a.values()) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(W);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(H);
    }
  });

  it("gathers each folder's files into a neighborhood", () => {
    const graph = buildGraph(big());
    const at = layoutGraph(graph, W, H);
    const files = graph.nodes.filter((node) => node.kind === "file");
    let same = 0;
    let other = 0;
    let sameCount = 0;
    let otherCount = 0;
    for (const a of files) {
      for (const b of files) {
        if (a === b) continue;
        const distance = Math.hypot(at.get(a.id)!.x - at.get(b.id)!.x, at.get(a.id)!.y - at.get(b.id)!.y);
        if (a.folder === b.folder) {
          same += distance;
          sameCount += 1;
        } else {
          other += distance;
          otherCount += 1;
        }
      }
    }
    expect(same / sameCount).toBeLessThan((other / otherCount) * 0.6);
    expect(folderCenters(graph, at).map((center) => center.folder).sort()).toEqual([".github/workflows", "docs", "src/cart", "src/pay"]);
  });

  it("barely moves the other nodes when a file arrives", () => {
    const before = layoutGraph(buildGraph(big()), W, H);
    const grown = big();
    const after = layoutGraph(buildGraph({ ...grown, tiles: [...grown.tiles, tile("src/cart/new.ts", "ENG-2", "read")] }), W, H, before);
    const shifts = [...before].map(([id, point]) => Math.hypot(after.get(id)!.x - point.x, after.get(id)!.y - point.y));
    expect(shifts.reduce((sum, shift) => sum + shift, 0) / shifts.length).toBeLessThan(12);
  });
});
