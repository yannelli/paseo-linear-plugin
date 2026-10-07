import { createHash } from "node:crypto";

export interface CachedValue<T> {
  value: T;
  fetchedAt: number;
}

export interface ResponseCache {
  get<T>(key: string): CachedValue<T> | null;
  set(key: string, value: unknown): void;
  /** Drops every entry whose key starts with `prefix`. */
  drop(prefix: string): void;
  clear(): void;
  size(): number;
}

// Entries are partitioned by a hash of the API key, so two Linear workspaces never share data.
export function keyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

export function cacheKey(fingerprint: string, kind: string, params: unknown = null): string {
  return `${fingerprint}:${kind}:${JSON.stringify(params)}`;
}

export function createResponseCache(options: {
  maxEntries: number;
  maxAgeMs: number;
  now?: () => number;
}): ResponseCache {
  const now = options.now ?? Date.now;
  const entries = new Map<string, CachedValue<unknown>>();

  return {
    get<T>(key: string) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (now() - entry.fetchedAt > options.maxAgeMs) {
        entries.delete(key);
        return null;
      }
      // Map order is insertion order; re-inserting marks the entry as recently used.
      entries.delete(key);
      entries.set(key, entry);
      return entry as CachedValue<T>;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, fetchedAt: now() });
      while (entries.size > options.maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    drop(prefix) {
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}
