import type { DirTouch, FileTouch } from "./activity";
import { type AreaRef, areaLabel, areaOf, whereLabel } from "./knowledge";
import { dirOf, type MapFile } from "./live";

// The Linear Live map: predicted files and touched files grouped into folder zones, and the
// column layout for those zones. Pure, so it runs in tests without React Native.

const MAX_GHOSTS = 4;
/** Listing chips are hidden once a zone has this many real tiles. */
const GHOSTS_UNTIL = 6;

export interface MapTile {
  path: string;
  name: string;
  owner: string | null;
  ghost: boolean;
  onMap: boolean;
  touch: "none" | "read" | "edited" | "created";
  added: number;
  removed: number;
}

export type ZoneExplored = "none" | "listed" | "searched";

export interface MapZone {
  dir: string;
  tiles: MapTile[];
  /** Files in the zone that are on the map. */
  predicted: number;
  /** Files in the zone the agent read or changed. */
  touched: number;
  /** Touched files that are on the map. */
  hits: number;
  explored: ZoneExplored;
  /** The service, package, or main folder the zone is in, from the project knowledge. */
  area: AreaRef | null;
}

/** Touched files the map did not predict, grouped by where they are. */
export interface OffMapGroup {
  where: string;
  files: number;
}

export interface MapModel {
  zones: MapZone[];
  touched: number;
  hits: number;
  offMap: OffMapGroup[];
}

// Search hits alone do not count: one broad search would flood the map with off-map tiles.
function isTouched(file: FileTouch): boolean {
  return file.reads + file.edits > 0;
}

function touchState(file: FileTouch | undefined): MapTile["touch"] {
  if (!file) return "none";
  if (file.created) return "created";
  return file.edits > 0 ? "edited" : "read";
}

interface Predictions {
  files: ReadonlyMap<string, string>;
  dirs: ReadonlyMap<string, string>;
}

// A map entry ending in "/" names a directory: it seeds a zone and owns the files inside.
function predictions(files: readonly MapFile[]): Predictions {
  const paths = new Map<string, string>();
  const dirs = new Map<string, string>();
  for (const file of files) {
    const target = file.path.endsWith("/") ? dirs : paths;
    if (!target.has(file.path)) target.set(file.path, file.issue.toUpperCase());
  }
  return { files: paths, dirs };
}

function ownerOf(path: string, predicted: Predictions): string | null {
  const direct = predicted.files.get(path);
  if (direct) return direct;
  for (const [dir, owner] of predicted.dirs) if (path.startsWith(dir)) return owner;
  return null;
}

/** Zone directories: predicted ones in map order, then touched ones by name. */
export function zoneDirs(files: readonly MapFile[], touches: readonly FileTouch[]): string[] {
  const dirs = new Set(files.map((file) => dirOf(file.path)));
  const extra = touches.filter(isTouched).map((file) => dirOf(file.path));
  for (const dir of [...new Set(extra)].sort()) dirs.add(dir);
  return [...dirs];
}

// A listed folder counts for itself; a recursive search counts for every folder under it,
// except a search of the whole repository, which would mark every zone.
function exploredState(dir: string, dirs: readonly DirTouch[]): ZoneExplored {
  let state: ZoneExplored = "none";
  for (const touch of dirs) {
    const covers = touch.path === dir || (touch.deep && touch.path !== "" && dir.startsWith(touch.path));
    if (covers && touch.deep) return "searched";
    if (covers) state = "listed";
  }
  return state;
}

export function buildMapModel(
  files: readonly MapFile[],
  touches: readonly FileTouch[],
  listing: ReadonlyMap<string, readonly string[]>,
  dirs: readonly DirTouch[] = [],
  areas: readonly AreaRef[] = [],
): MapModel {
  const predicted = predictions(files);
  const touched = new Map(touches.filter(isTouched).map((file) => [file.path, file]));
  const zones = zoneDirs(files, touches).map((dir): MapZone => {
    const inZone = (path: string) => dirOf(path) === dir;
    const real = new Set([...predicted.files.keys(), ...touched.keys()].filter(inZone));
    const tiles = [...real].sort().map((path): MapTile => {
      const touch = touched.get(path);
      const owner = ownerOf(path, predicted);
      return {
        path,
        name: path.slice(dir.length),
        owner,
        ghost: false,
        onMap: owner !== null,
        touch: touchState(touch),
        added: touch?.added ?? 0,
        removed: touch?.removed ?? 0,
      };
    });
    const ghosts = (tiles.length >= GHOSTS_UNTIL ? [] : (listing.get(dir) ?? []))
      .filter((name) => !real.has(`${dir}${name}`))
      .slice(0, MAX_GHOSTS)
      .map((name): MapTile => {
        const path = `${dir}${name}`;
        const owner = ownerOf(path, predicted);
        const onMap = owner !== null;
        return { path, name, owner, ghost: true, onMap, touch: "none", added: 0, removed: 0 };
      });
    return {
      dir,
      tiles: [...tiles, ...ghosts],
      predicted: tiles.filter((tile) => tile.onMap).length,
      touched: tiles.filter((tile) => tile.touch !== "none").length,
      hits: tiles.filter((tile) => tile.touch !== "none" && tile.onMap).length,
      explored: exploredState(dir, dirs),
      area: areaOf(dir, areas),
    };
  });
  let hits = 0;
  const off = new Map<string, number>();
  for (const path of touched.keys()) {
    if (ownerOf(path, predicted)) hits += 1;
    else off.set(whereLabel(path, areas), (off.get(whereLabel(path, areas)) ?? 0) + 1);
  }
  const offMap = [...off]
    .map(([where, count]) => ({ where, files: count }))
    .sort((a, b) => b.files - a.files || a.where.localeCompare(b.where));
  return { zones, touched: touched.size, hits, offMap };
}

export function hitRateLine(model: MapModel): string {
  if (model.touched === 0) return "No files touched yet";
  const noun = model.touched === 1 ? "file" : "files";
  return `${model.touched} ${noun} touched, ${model.hits} on the map`;
}

const OFF_MAP_SHOWN = 4;

/** Such as "Off the map: billing-api · service (3), docs (1)"; null when all are on it. */
export function offMapLine(model: MapModel): string | null {
  if (model.offMap.length === 0) return null;
  const shown = model.offMap.slice(0, OFF_MAP_SHOWN).map((group) => `${group.where} (${group.files})`);
  const more = model.offMap.length - OFF_MAP_SHOWN;
  return `Off the map: ${shown.join(", ")}${more > 0 ? `, ${more} more` : ""}`;
}

/** Where the file is when the agent touched it off the map; null on the map or untouched. */
export function offMapWhere(model: MapModel, path: string | null, areas: readonly AreaRef[]): string | null {
  if (!path) return null;
  for (const zone of model.zones) {
    const tile = zone.tiles.find((entry) => entry.path === path && !entry.ghost);
    if (tile) return tile.touch !== "none" && !tile.onMap ? whereLabel(path, areas) : null;
  }
  return null;
}

/** The area a zone header names; only the part its folder name does not already say. */
export function zoneAreaLabel(zone: MapZone): string | null {
  const area = zone.area;
  if (!area || area.path === "") return null;
  const folder = area.path.replace(/\/$/, "").split("/").pop();
  if (zone.dir !== area.path || area.name !== folder) return areaLabel(area);
  return area.role || (area.kind === "folder" ? null : area.kind);
}

export const ZONE_GAP = 10;

// Rough zone height from its tiles, so zones can go to the shortest column. Tiles wrap, so
// count how many fit per row by name length.
function zoneHeight(zone: MapZone, width: number): number {
  const inner = Math.max(120, width - 26);
  let rows = 1;
  let used = 0;
  for (const tile of zone.tiles) {
    const tileWidth = Math.min(inner, 32 + tile.name.length * 7);
    if (used > 0 && used + tileWidth > inner) {
      rows += 1;
      used = 0;
    }
    used += tileWidth + 6;
  }
  return 46 + rows * 32;
}

/**
 * Splits zones into columns in map order. A zone in `placed` keeps its column; a new zone
 * goes to the shortest column and is added to `placed`.
 */
export function masonry(
  zones: readonly MapZone[],
  columns: number,
  width: number,
  placed: Map<string, number>,
): MapZone[][] {
  const result: MapZone[][] = Array.from({ length: columns }, () => []);
  const heights: number[] = Array.from({ length: columns }, () => 0);
  const columnWidth = (width - ZONE_GAP * (columns - 1)) / columns;
  for (const zone of zones) {
    let column = placed.get(zone.dir);
    if (column === undefined || column >= columns) {
      column = heights.indexOf(Math.min(...heights));
      placed.set(zone.dir, column);
    }
    result[column]?.push(zone);
    heights[column] = (heights[column] ?? 0) + zoneHeight(zone, columnWidth) + ZONE_GAP;
  }
  return result;
}
