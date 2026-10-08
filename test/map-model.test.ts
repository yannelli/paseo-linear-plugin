import { describe, expect, it } from "vitest";
import type { DirTouch, FileTouch } from "../shared/activity";
import { buildMapModel, hitRateLine, type MapZone, masonry } from "../shared/map-model";

const read = (path: string, order = 0): FileTouch => ({
  path,
  reads: 1,
  edits: 0,
  added: 0,
  removed: 0,
  created: false,
  order,
  last: "read",
});
const dir = (path: string, deep: boolean): DirTouch => ({ path, deep, order: 0 });
const files = [
  { path: "src/ui/a.tsx", issue: "ENG-2" },
  { path: "src/ui/b.tsx", issue: "ENG-2" },
  { path: "lib/x.ts", issue: "ENG-1" },
];
const NO_LISTING = new Map<string, string[]>();

describe("map zones", () => {
  it("counts predicted, touched, and on-map files per zone", () => {
    const model = buildMapModel(files, [read("src/ui/a.tsx"), read("README.md")], NO_LISTING);
    const byDir = new Map(model.zones.map((zone) => [zone.dir, zone]));
    expect(byDir.get("src/ui/")).toMatchObject({ predicted: 2, touched: 1, hits: 1 });
    expect(byDir.get("")).toMatchObject({ predicted: 0, touched: 1, hits: 0 });
    expect(hitRateLine(model)).toBe("2 files touched, 1 on the map");
  });

  it("marks listed folders, folders under a search, and not the whole repository", () => {
    const explored = (dirs: DirTouch[]) =>
      Object.fromEntries(
        buildMapModel(files, [], NO_LISTING, dirs).zones.map((zone) => [zone.dir, zone.explored]),
      );
    expect(explored([dir("lib/", false)])).toEqual({ "src/ui/": "none", "lib/": "listed" });
    expect(explored([dir("src/", true)])).toEqual({ "src/ui/": "searched", "lib/": "none" });
    expect(explored([dir("", true)])).toEqual({ "src/ui/": "none", "lib/": "none" });
  });

  it("hides listing chips once a zone has six real tiles", () => {
    const many = Array.from({ length: 6 }, (_, index) => ({ path: `src/f${index}.ts`, issue: "ENG-1" }));
    const listing = new Map([["src/", ["other.ts"]]]);
    expect(buildMapModel(many, [], listing).zones[0]?.tiles.some((tile) => tile.ghost)).toBe(false);
    const few = many.slice(0, 2);
    expect(buildMapModel(few, [], listing).zones[0]?.tiles.some((tile) => tile.ghost)).toBe(true);
  });
});

describe("zone columns", () => {
  const zone = (dir: string, tiles: number): MapZone => ({
    dir,
    tiles: Array.from({ length: tiles }, (_, index) => ({
      path: `${dir}file-${index}.ts`,
      name: `file-${index}.ts`,
      owner: null,
      ghost: false,
      onMap: true,
      touch: "none",
      added: 0,
      removed: 0,
    })),
    predicted: tiles,
    touched: 0,
    hits: 0,
    explored: "none",
  });
  const columnOf = (groups: MapZone[][]) =>
    Object.fromEntries(groups.flatMap((group, index) => group.map((entry) => [entry.dir, index])));

  it("keeps each zone in its column when an earlier zone grows", () => {
    const placed = new Map<string, number>();
    const first = masonry([zone("a/", 1), zone("b/", 1), zone("c/", 1)], 2, 600, placed);
    const second = masonry([zone("a/", 30), zone("b/", 1), zone("c/", 1), zone("d/", 1)], 2, 600, placed);
    const before = columnOf(first);
    const after = columnOf(second);
    expect({ a: after["a/"], b: after["b/"], c: after["c/"] }).toEqual({
      a: before["a/"],
      b: before["b/"],
      c: before["c/"],
    });
    expect(after["d/"]).toBe(1);
  });
});
