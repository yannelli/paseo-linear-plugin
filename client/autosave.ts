// Debounced, single-flight saving for one text value. Pure so the tests can drive it
// with fake timers. Only the latest value is kept, and one save runs at a time, so
// saves always reach the server in edit order.

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface AutosaveOptions {
  delayMs: number;
  save(value: string): Promise<void>;
  onStatus(status: SaveStatus, error?: unknown): void;
}

export interface Autosave {
  /** Queues `value` and saves it after `delayMs` (or the given delay) without changes. */
  schedule(value: string, delayMs?: number): void;
  /** Saves the queued value now. Resolves when nothing is left to save. */
  flush(): Promise<void>;
  /** Drops the queued value. A save in flight still finishes. */
  cancel(): void;
  /** True while a value is queued or saving. */
  busy(): boolean;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  let queued: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  // Starts the next save unless one is running. Rejects with the save error.
  function run(): Promise<void> {
    clearTimer();
    if (inFlight) return inFlight.then(() => (queued === null ? undefined : run()));
    if (queued === null) return Promise.resolve();
    const value = queued;
    queued = null;
    options.onStatus("saving");
    inFlight = options.save(value).then(
      () => {
        inFlight = null;
        if (queued === null) options.onStatus(timer === null ? "saved" : "pending");
        else if (timer === null) return run();
      },
      (error: unknown) => {
        inFlight = null;
        // Keep the failed value for a retry unless a newer edit replaced it.
        if (queued === null) queued = value;
        if (timer === null) options.onStatus("error", error);
        throw error;
      },
    );
    return inFlight;
  }

  function background() {
    run().catch(() => undefined);
  }

  return {
    schedule(value, delayMs = options.delayMs) {
      queued = value;
      clearTimer();
      options.onStatus("pending");
      timer = setTimeout(background, delayMs);
    },
    flush: run,
    cancel() {
      clearTimer();
      queued = null;
    },
    busy: () => queued !== null || inFlight !== null,
  };
}
