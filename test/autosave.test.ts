import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave, type SaveStatus } from "../client/autosave";

interface Call {
  value: string;
  resolve(): void;
  reject(error: Error): void;
}

function setup(delayMs = 1000) {
  const calls: Call[] = [];
  const statuses: SaveStatus[] = [];
  const autosave = createAutosave({
    delayMs,
    save: (value) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ value, resolve, reject });
      }),
    onStatus: (status) => statuses.push(status),
  });
  return { autosave, calls, statuses };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createAutosave", () => {
  it("saves the latest value once typing pauses", async () => {
    const { autosave, calls, statuses } = setup();
    autosave.schedule("a");
    await vi.advanceTimersByTimeAsync(600);
    autosave.schedule("ab");
    await vi.advanceTimersByTimeAsync(600);
    autosave.schedule("abc");
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((call) => call.value)).toEqual(["abc"]);
    calls[0]?.resolve();
    await settle();
    expect(statuses.at(-1)).toBe("saved");
    expect(autosave.busy()).toBe(false);
  });

  it("runs one save at a time and sends edits in order", async () => {
    const { autosave, calls, statuses } = setup(100);
    autosave.schedule("one");
    await vi.advanceTimersByTimeAsync(100);
    autosave.schedule("two");
    await vi.advanceTimersByTimeAsync(100);
    autosave.schedule("three");
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.map((call) => call.value)).toEqual(["one"]);
    calls[0]?.resolve();
    await settle();
    expect(calls.map((call) => call.value)).toEqual(["one", "three"]);
    expect(statuses.at(-1)).toBe("saving");
    calls[1]?.resolve();
    await settle();
    expect(statuses.at(-1)).toBe("saved");
  });

  it("flush saves now and resolves after the save", async () => {
    const { autosave, calls } = setup();
    autosave.schedule("draft");
    let done = false;
    const flushed = autosave.flush().then(() => {
      done = true;
    });
    expect(calls.map((call) => call.value)).toEqual(["draft"]);
    await settle();
    expect(done).toBe(false);
    calls[0]?.resolve();
    await flushed;
    expect(done).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);
  });

  it("flush waits for a save in flight, then saves newer text", async () => {
    const { autosave, calls } = setup(100);
    autosave.schedule("old");
    await vi.advanceTimersByTimeAsync(100);
    autosave.schedule("new");
    const flushed = autosave.flush();
    expect(calls).toHaveLength(1);
    calls[0]?.resolve();
    await settle();
    expect(calls.map((call) => call.value)).toEqual(["old", "new"]);
    calls[1]?.resolve();
    await expect(flushed).resolves.toBeUndefined();
  });

  it("keeps a failed value so a retry can save it", async () => {
    const { autosave, calls, statuses } = setup(100);
    autosave.schedule("text");
    await vi.advanceTimersByTimeAsync(100);
    calls[0]?.reject(new Error("offline"));
    await settle();
    expect(statuses.at(-1)).toBe("error");
    expect(autosave.busy()).toBe(true);
    const retry = autosave.flush();
    expect(calls.map((call) => call.value)).toEqual(["text", "text"]);
    calls[1]?.resolve();
    await retry;
    expect(statuses.at(-1)).toBe("saved");
  });

  it("flush rejects when the save fails", async () => {
    const { autosave, calls } = setup();
    autosave.schedule("text");
    const flushed = autosave.flush();
    calls[0]?.reject(new Error("denied"));
    await expect(flushed).rejects.toThrow("denied");
  });

  it("prefers a newer edit over the failed value", async () => {
    const { autosave, calls, statuses } = setup(100);
    autosave.schedule("first");
    await vi.advanceTimersByTimeAsync(100);
    autosave.schedule("second");
    calls[0]?.reject(new Error("offline"));
    await settle();
    expect(statuses.at(-1)).toBe("pending");
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.map((call) => call.value)).toEqual(["first", "second"]);
  });

  it("cancel drops the queued value", async () => {
    const { autosave, calls } = setup();
    autosave.schedule("text");
    autosave.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    await autosave.flush();
    expect(calls).toHaveLength(0);
    expect(autosave.busy()).toBe(false);
  });
});
