/** Runs work for one key at a time, in call order. A failure does not stop the next run. */
export function createKeyQueue() {
  const queues = new Map<string, Promise<unknown>>();
  return function oneAtATime<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(run);
    queues.set(key, next);
    const forget = () => {
      if (queues.get(key) === next) queues.delete(key);
    };
    next.then(forget, forget);
    return next;
  };
}
