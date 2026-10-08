// Points, routes along them, and label placement for the Linear Live graph. Pure, so tests can
// check them without a renderer.

export interface Point {
  x: number;
  y: number;
}

export interface Route<P extends Point = Point> {
  points: P[];
  /** Each point's share of the whole distance, from 0 to 1. */
  stops: number[];
  length: number;
}

/** Where a route is at a share of its distance, from 0 to 1. Mixes every number of the points. */
export function pointAt<P extends Point>(path: Route<P>, share: number): P {
  const at = Math.min(1, Math.max(0, share));
  for (let index = 1; index < path.stops.length; index += 1) {
    const stop = path.stops[index] as number;
    if (at > stop) continue;
    const before = path.stops[index - 1] as number;
    const from = path.points[index - 1] as P;
    const to = path.points[index] as P;
    const part = stop > before ? (at - before) / (stop - before) : 1;
    const mixed: Record<string, unknown> = { ...(to as object) };
    for (const [key, value] of Object.entries(to as object)) {
      const start = (from as Record<string, unknown>)[key];
      if (typeof value === "number" && typeof start === "number") mixed[key] = start + (value - start) * part;
    }
    return mixed as P;
  }
  return path.points[path.points.length - 1] as P;
}

/** A route through the points without zero-length steps, or null when there is nowhere to go. */
export function route<P extends Point>(points: readonly P[]): Route<P> | null {
  const kept: P[] = [];
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

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Places labels in request order at the first spot that overlaps no node, other obstacle, or
// placed label, moved inside the box when it would cross an edge. Others are hidden.
export function placeLabels(
  requests: readonly LabelRequest[],
  width: number,
  height: number,
  obstacles: readonly ({ at: Point; radius: number } | Rect)[] = [],
  gap = 3,
): Map<string, PlacedLabel> {
  const placed: Rect[] = obstacles.map((shape) =>
    "at" in shape
      ? { left: shape.at.x - shape.radius, right: shape.at.x + shape.radius, top: shape.at.y - shape.radius, bottom: shape.at.y + shape.radius }
      : { ...shape },
  );
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
