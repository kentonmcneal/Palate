// One queue for this app process, independent of Supabase's optional locks.
// Do not await a queued transition from inside another queued transition or an
// auth-state subscriber. Subscribers must remain synchronous.
let tail: Promise<void> = Promise.resolve();

export function runAuthTransition<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation);
  // One rejected credential/cleanup attempt must not poison subsequent work.
  tail = result.then(() => undefined, () => undefined);
  return result;
}
