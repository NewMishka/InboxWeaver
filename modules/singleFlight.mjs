export function createSingleFlight() {
  const inFlight = new Map();

  function run(key, operation) {
    const normalizedKey = String(key);
    const existing = inFlight.get(normalizedKey);
    if (existing) return existing;

    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (inFlight.get(normalizedKey) === promise) inFlight.delete(normalizedKey);
      });
    inFlight.set(normalizedKey, promise);
    return promise;
  }

  return {
    run,
    has(key) {
      return inFlight.has(String(key));
    },
    get size() {
      return inFlight.size;
    }
  };
}
