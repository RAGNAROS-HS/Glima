import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../util/retry.js";

// Speed up delay for tests
vi.mock("../util/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("withRetry", () => {
  it("returns immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 1);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts and throws last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(withRetry(fn, 3, 1)).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("succeeds on second attempt", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      if (++calls < 2) throw new Error("not yet");
      return "success";
    });
    const result = await withRetry(fn, 3, 1);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on immediate success", async () => {
    const fn = vi.fn().mockResolvedValue(99);
    await withRetry(fn, 5, 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
