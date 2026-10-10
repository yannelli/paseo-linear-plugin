import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";

export interface JsonFile<T> {
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
