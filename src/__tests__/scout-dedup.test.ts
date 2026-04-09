import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMProvider, LLMResponse } from "../llm/interface.js";
import type { Config } from "../config.js";

vi.mock("../util/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../workspace/git.js", () => ({
  openRepo: vi.fn().mockReturnValue({}),
  getRecentFiles: vi.fn().mockResolvedValue([]),
}));

// Mock fs functions used inside scout agent
vi.mock("fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn(),
  readFile: vi.fn().mockResolvedValue(""),
}));

function makeConfig(): Config {
  return {
    GITHUB_APP_ID: 1,
    GITHUB_PRIVATE_KEY: "key",
    GITHUB_PRIVATE_KEY_PEM: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
    GITHUB_WEBHOOK_SECRET: "secret",
    GITHUB_INSTALLATION_ID: 1,
    GITHUB_REPO_OWNER: "owner",
    GITHUB_REPO_NAME: "repo",
    BOT_GITHUB_LOGIN: "glima[bot]",
    LLM_PROVIDER: "anthropic",
    LLM_API_KEY: "k",
    LLM_MODEL_SCOUT: "m",
    LLM_MODEL_FIXER: "m",
    LLM_MODEL_REVIEWER: "m",
    LLM_MODEL_DOCUMENTER: "m",
    SCOUT_CRON: "0 2 * * *",
    MAX_FIX_ITERATIONS: 3,
    QODO_BOT_USERNAME: "qodo[bot]",
    LLM_TOKEN_BUDGET_SCOUT: 80000,
    PORT: 3000,
  };
}

function makeLLM(scoutOutput: object): LLMProvider {
  return {
    name: "mock",
    complete: vi.fn().mockResolvedValue({
      content: JSON.stringify(scoutOutput),
      inputTokens: 10,
      outputTokens: 10,
      stopReason: "end_turn",
    } satisfies LLMResponse),
  };
}

function makeOctokit(existingIssues: Array<{ title: string; body: string }>) {
  const createIssue = vi.fn().mockResolvedValue({ data: { number: 99 } });
  return {
    paginate: vi.fn().mockResolvedValue(
      existingIssues.map((i, idx) => ({
        number: idx + 1,
        title: i.title,
        body: i.body,
        state: "open",
        labels: [{ name: "glima:scout" }],
      })),
    ),
    issues: { create: createIssue },
    _createIssue: createIssue,
  };
}

describe("Scout deduplication", () => {
  it("files a new issue when no existing issues", async () => {
    const octokit = makeOctokit([]);
    const llm = makeLLM({
      issues: [
        {
          title: "Missing null check in auth",
          body: "Problem in `src/auth.ts` line 10",
          category: "bug",
          severity: "high",
          file_paths: ["src/auth.ts"],
        },
      ],
      repo_is_clean: false,
      reasoning: "Found bug",
    });

    const { runScoutAgent } = await import("../agents/scout.js");
    await runScoutAgent(octokit as never, llm, makeConfig(), "/workspace/test");
    expect(octokit._createIssue).toHaveBeenCalledTimes(1);
  });

  it("skips issue with matching fingerprint", async () => {
    // fingerprint = sha256(sorted file_paths + category).slice(0,16)
    // We simulate an existing issue that has the matching fingerprint
    const { createHash } = await import("crypto");
    const fp = createHash("sha256")
      .update("src/auth.ts|bug")
      .digest("hex")
      .slice(0, 16);

    const octokit = makeOctokit([
      {
        title: "Some existing issue",
        body: `Existing body\n\n<!-- glima-fingerprint: ${fp} -->`,
      },
    ]);

    const llm = makeLLM({
      issues: [
        {
          title: "Missing null check in auth",
          body: "Problem in `src/auth.ts` line 10",
          category: "bug",
          severity: "high",
          file_paths: ["src/auth.ts"],
        },
      ],
      repo_is_clean: false,
      reasoning: "Found bug",
    });

    const { runScoutAgent } = await import("../agents/scout.js");
    await runScoutAgent(octokit as never, llm, makeConfig(), "/workspace/test");
    expect(octokit._createIssue).not.toHaveBeenCalled();
  });

  it("skips issue with similar title (Levenshtein > 0.85)", async () => {
    const octokit = makeOctokit([
      {
        title: "Missing null check in auth",  // same title
        body: "no fingerprint",
      },
    ]);

    const llm = makeLLM({
      issues: [
        {
          title: "Missing null check in auth",
          body: "Problem in `src/auth.ts`",
          category: "bug",
          severity: "high",
          file_paths: ["src/other.ts"],  // different path = different fingerprint
        },
      ],
      repo_is_clean: false,
      reasoning: "Found bug",
    });

    const { runScoutAgent } = await import("../agents/scout.js");
    await runScoutAgent(octokit as never, llm, makeConfig(), "/workspace/test");
    expect(octokit._createIssue).not.toHaveBeenCalled();
  });

  it("files issue with sufficiently different title", async () => {
    const octokit = makeOctokit([
      { title: "SQL injection in login route", body: "no fingerprint" },
    ]);

    const llm = makeLLM({
      issues: [
        {
          title: "Missing input validation on signup form",
          body: "Different issue entirely",
          category: "security",
          severity: "critical",
          file_paths: ["src/signup.ts"],
        },
      ],
      repo_is_clean: false,
      reasoning: "Found different security issue",
    });

    const { runScoutAgent } = await import("../agents/scout.js");
    await runScoutAgent(octokit as never, llm, makeConfig(), "/workspace/test");
    expect(octokit._createIssue).toHaveBeenCalledTimes(1);
  });
});
