import { describe, it, expect } from "vitest";
import { withLock } from "../util/concurrency.js";

describe("withLock", () => {
  it("runs the function and returns its value", async () => {
    const result = await withLock("key-a", async () => 42);
    expect(result).toBe(42);
  });

  it("second call with same key bails (returns undefined) while first is in flight", async () => {
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((res) => (resolveFirst = res));
    const firstStarted = new Promise<void>((res) => {
      withLock("key-b", async () => {
        res();
        await firstDone;
        return "first";
      });
    });

    await firstStarted;
    const secondResult = await withLock("key-b", async () => "second");
    expect(secondResult).toBeUndefined();

    resolveFirst();
  });

  it("different keys run in parallel", async () => {
    const log: string[] = [];
    const p1 = withLock("key-c", async () => {
      await new Promise((r) => setTimeout(r, 10));
      log.push("c");
    });
    const p2 = withLock("key-d", async () => {
      log.push("d");
    });
    await Promise.all([p1, p2]);
    expect(log).toContain("c");
    expect(log).toContain("d");
  });

  it("lock is released after fn completes, allowing a new call", async () => {
    const first  = await withLock("key-e", async () => "first");
    const second = await withLock("key-e", async () => "second");
    expect(first).toBe("first");
    expect(second).toBe("second");
  });

  it("lock is released even when fn throws", async () => {
    await expect(withLock("key-f", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // Should be able to acquire the lock again
    const result = await withLock("key-f", async () => "recovered");
    expect(result).toBe("recovered");
  });
});
