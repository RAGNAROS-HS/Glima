import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock simple-git so no real git ops happen
vi.mock("simple-git", () => ({
  default: vi.fn().mockReturnValue({
    clone: vi.fn().mockResolvedValue(undefined),
    addConfig: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock fs/promises
const rmMock = vi.fn().mockResolvedValue(undefined);
const mkdirMock = vi.fn().mockResolvedValue(undefined);

vi.mock("fs/promises", () => ({
  rm: rmMock,
  mkdir: mkdirMock,
}));

// Mock workspace/git cloneRepo
vi.mock("../workspace/git.js", () => ({
  cloneRepo: vi.fn().mockResolvedValue({
    addConfig: vi.fn().mockResolvedValue(undefined),
  }),
  openRepo: vi.fn(),
  createBranch: vi.fn(),
  commitAll: vi.fn(),
  pushBranch: vi.fn(),
  getHeadSha: vi.fn(),
  getRecentFiles: vi.fn().mockResolvedValue([]),
  countMatchingCommits: vi.fn().mockResolvedValue(0),
  getDefaultBranch: vi.fn().mockResolvedValue("main"),
}));

vi.mock("../util/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("withWorkspace", () => {
  beforeEach(() => {
    rmMock.mockClear();
    mkdirMock.mockClear();
  });

  it("calls fn with workspace context and cleans up in finally", async () => {
    const { withWorkspace } = await import("../workspace/manager.js");
    const fnResult = "done";
    const fn = vi.fn().mockResolvedValue(fnResult);

    const result = await withWorkspace("token", "owner", "repo", fn);
    expect(result).toBe(fnResult);
    expect(rmMock).toHaveBeenCalledTimes(1);
  });

  it("cleans up even when fn throws", async () => {
    const { withWorkspace } = await import("../workspace/manager.js");
    const fn = vi.fn().mockRejectedValue(new Error("fn error"));

    await expect(withWorkspace("token", "owner", "repo", fn)).rejects.toThrow("fn error");
    expect(rmMock).toHaveBeenCalledTimes(1);
  });

  it("generates a unique uuid path each invocation", async () => {
    const { withWorkspace } = await import("../workspace/manager.js");
    const paths: string[] = [];
    const fn = vi.fn().mockImplementation(async (ctx: { path: string }) => {
      paths.push(ctx.path);
    });

    await withWorkspace("token", "owner", "repo", fn);
    await withWorkspace("token", "owner", "repo", fn);

    expect(paths[0]).not.toBe(paths[1]);
  });
});
