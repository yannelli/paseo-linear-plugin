import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ZodType, z } from "zod";
import { type IssueMap, IssueMapSchema, type LaunchInput, LaunchInputSchema } from "../shared/live";

const MAX_MAPS = 200;
/** A launch still waiting after this long is dropped, so a stale one never starts by surprise. */
export const PENDING_LAUNCH_MAX_AGE_MS = 60 * 60_000;

interface JsonFile<T> {
  read(): Promise<T>;
  /** Changes run one at a time, so a read, change, and write never interleave. */
  update<R>(change: (current: T) => { next: T; result: R }): Promise<R>;
}

export function createJsonFile<T>(file: string, schema: ZodType<T>, empty: () => T): JsonFile<T> {
  let value: T | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  async function load(): Promise<T> {
    if (value !== null) return value;
    try {
      value = schema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch {
      value = empty();
    }
    return value;
  }
  async function save(next: T) {
    value = next;
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await rename(temporary, file);
  }
  return {
    read: load,
    update(change) {
      const run = queue
        .catch(() => undefined)
        .then(async () => {
          const { next, result } = change(await load());
          await save(next);
          return result;
        });
      queue = run;
      return run;
    },
  };
}

export interface MapStore {
  get(identifier: string): Promise<IssueMap | null>;
  set(map: IssueMap): Promise<void>;
  delete(identifier: string): Promise<void>;
}

/** Explore maps survive daemon restarts, so a finished explore run is never paid for twice. */
export function createMapStore(file: string): MapStore {
  const store = createJsonFile<Record<string, IssueMap>>(
    file,
    z.record(z.string(), IssueMapSchema),
    () => ({}),
  );
  return {
    async get(identifier) {
      return (await store.read())[identifier] ?? null;
    },
    set(map) {
      return store.update((current) => {
        const kept = Object.values({ ...current, [map.identifier]: map })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, MAX_MAPS);
        return { next: Object.fromEntries(kept.map((entry) => [entry.identifier, entry])), result: undefined };
      });
    },
    delete(identifier) {
      return store.update((current) => {
        const { [identifier]: _removed, ...rest } = current;
        return { next: rest, result: undefined };
      });
    },
  };
}

const PendingLaunchSchema = LaunchInputSchema.extend({ queuedAt: z.number() });
type PendingLaunch = z.infer<typeof PendingLaunchSchema>;

export interface LaunchQueue {
  add(launch: LaunchInput): Promise<void>;
  /** Removes and returns the issue's waiting launches, so each one starts at most once. */
  claim(identifier: string): Promise<LaunchInput[]>;
}

// Agents that wait for an explore run are saved to disk, so a plugin reload or daemon
// restart while the run works still starts them once the map is ready.
export function createLaunchQueue(file: string, now = () => Date.now()): LaunchQueue {
  const store = createJsonFile<Record<string, PendingLaunch[]>>(
    file,
    z.record(z.string(), z.array(PendingLaunchSchema)),
    () => ({}),
  );
  return {
    add(launch) {
      return store.update((current) => ({
        next: {
          ...current,
          [launch.identifier]: [...(current[launch.identifier] ?? []), { ...launch, queuedAt: now() }],
        },
        result: undefined,
      }));
    },
    claim(identifier) {
      return store.update((current) => {
        const { [identifier]: waiting = [], ...others } = current;
        const fresh = waiting.filter((launch) => now() - launch.queuedAt < PENDING_LAUNCH_MAX_AGE_MS);
        if (fresh.length < waiting.length) {
          console.error(`Dropped ${waiting.length - fresh.length} stale Linear launch for ${identifier}`);
        }
        return {
          next: others,
          result: fresh.map(({ queuedAt: _queuedAt, ...launch }: PendingLaunch) => launch),
        };
      });
    },
  };
}
