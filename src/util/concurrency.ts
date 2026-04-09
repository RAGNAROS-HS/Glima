const locks = new Map<string, Promise<unknown>>();

export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  if (locks.has(key)) {
    return undefined;
  }
  const promise = fn().finally(() => {
    locks.delete(key);
  });
  locks.set(key, promise);
  return promise;
}
