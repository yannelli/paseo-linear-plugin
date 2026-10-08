import { describe, expect, it } from "vitest";
import { labelBox, placeLabels, pointAt, route } from "../shared/graph-geometry";

describe("routes", () => {
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
    const offsets = route([{ x: 0, y: 0, dy: -10 }, { x: 0, y: 100, dy: -30 }])!;
    expect(pointAt(offsets, 0.5)).toEqual({ x: 0, y: 50, dy: -20 });
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
