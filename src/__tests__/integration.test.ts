import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMProvider } from "../llm/interface.js";
import type { Config } from "../config.js";

// ─── Top-level mocks (hoisted, stable across all tests) ───────────────────────

vi.mock("../util/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockWithWorkspace = vi.fn();
vi.mock("../workspace/manager.js", () => ({
  withWorkspace: (...args: unknown[]) => mockWithWorkspace(...args),
}));

const mockOpenRepo = vi.fn();
const mockCreateBranch    = vi.fn().mockResolvedValue(undefined);
const mockCommitAll       = vi.fn().mockResolvedValue(undefined);
const mockPushBranch      = vi.fn().mockResolvedValue(undefined);
const mockGetHeadSha      = vi.fn().mockResolvedValue("abc123");
const mockGetRecentFiles  = vi.fn().mockResolvedValue([]);
const mockCountCommits    = vi.fn().mockResolvedValue(0);
const mockGetDefaultBranch = vi.fn().mockResolvedValue("main");

vi.mock("../workspace/git.js", () => ({
  openRepo:              (...a: unknown[]) => mockOpenRepo(...a),
  createBranch:          (...a: unknown[]) => mockCreateBranch(...a),
  commitAll:             (...a: unknown[]) => mockCommitAll(...a),
  pushBranch:            (...a: unknown[]) => mockPushBranch(...a),
  getHeadSha:            (...a: unknown[]) => mockGetHeadSha(...a),
  getRecentFiles:        (...a: unknown[]) => mockGetRecentFiles(...a),
  countMatchingCommits:  (...a: unknown[]) => mockCountCommits(...a),
  getDefaultBranch:      (...a: unknown[]) => mockGetDefaultBranch(...a),
}));

const mockGetInstallationOctokit = vi.fn();
const mockGetInstallationToken   = vi.fn().mockResolvedValue("inst-token");
vi.mock("../github/app.js", () => ({
  getApp:                   vi.fn(),
  getInstallationOctokit:   (...a: unknown[]) => mockGetInstallationOctokit(...a),
  getInstallationToken:     (...a: unknown[]) => mockGetInstallationToken(...a),
}));

const mockRunScoutAgent     = vi.fn();
const mockRunFixerAgent     = vi.fn();
const mockRunDocumenterAgent = vi.fn();
const mockRunReviewerAgent  = vi.fn();

vi.mock("../agents/scout.js",      () => ({ runScoutAgent:     (...a: unknown[]) => mockRunScoutAgent(...a) }));
vi.mock("../agents/fixer.js",      () => ({ runFixerAgent:     (...a: unknown[]) => mockRunFixerAgent(...a) }));
vi.mock("../agents/documenter.js", () => ({ runDocumenterAgent:(...a: unknown[]) => mockRunDocumenterAgent(...a) }));
vi.mock("../agents/reviewer.js",   () => ({ runReviewerAgent:  (...a: unknown[]) => mockRunReviewerAgent(...a) }));

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    GITHUB_APP_ID: 1,
    GITHUB_PRIVATE_KEY: "key",
    GITHUB_PRIVATE_KEY_PEM: "-----BEGIN RSA PRIVATE KEY-----\nfake",
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
    QODO_BOT_USERNAME: "qodo-merge[bot]",
    LLM_TOKEN_BUDGET_SCOUT: 80000,
    PORT: 3000,
    ...overrides,
  };
}

const fakeLLM: LLMProvider = { name: "mock", complete: vi.fn() };

/** A fake git object with all methods pipelines may call */
function fakeGit(overrides: Record<string, unknown> = {}) {
  return {
    checkout:  vi.fn().mockResolvedValue(undefined),
    diff:      vi.fn().mockResolvedValue("diff content"),
    ...overrides,
  };
}

/** withWorkspace mock: calls fn synchronously with a fake context */
function setupWorkspace(gitOverrides: Record<string, unknown> = {}) {
  const git = fakeGit(gitOverrides);
  mockWithWorkspace.mockImplementation(async (_t: unknown, _o: unknown, _r: unknown, fn: Function) =>
    fn({ path: "/ws/test", git }),
  );
  mockOpenRepo.mockReturnValue(git);
  return git;
}

// ─── Scout Pipeline ────────────────────────────────────────────────────────────

describe("Scout Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstallationToken.mockResolvedValue("tok");
    setupWorkspace();
    mockGetHeadSha.mockResolvedValue("abc123");
  });

  it("creates glima:done issue when Scout returns no issues", async () => {
    const createIssue = vi.fn().mockResolvedValue({ data: { number: 10 } });
    const octokit = { paginate: vi.fn().mockResolvedValue([]), issues: { create: createIssue, update: vi.fn() } };
    mockGetInstallationOctokit.mockResolvedValue(octokit);
    mockRunScoutAgent.mockResolvedValue({ issues: [], repo_is_clean: true, reasoning: "ok" });

    const { runScoutPipeline } = await import("../pipeline/scout.pipeline.js");
    await runScoutPipeline(fakeLLM, makeConfig());

    expect(createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ labels: expect.arrayContaining(["glima:done"]) }),
    );
  });

  it("skips entirely when glima:done issue HEAD SHA matches current HEAD", async () => {
    const doneIssue = {
      number: 5,
      title: "glima: repository is clean",
      body: "Clean\n\n<!-- glima-done-sha: abc123 -->",
      state: "open",
      labels: [{ name: "glima:done" }],
    };
    const octokit = { paginate: vi.fn().mockResolvedValue([doneIssue]), issues: { create: vi.fn(), update: vi.fn() } };
    mockGetInstallationOctokit.mockResolvedValue(octokit);
    mockGetHeadSha.mockResolvedValue("abc123");

    const { runScoutPipeline } = await import("../pipeline/scout.pipeline.js");
    await runScoutPipeline(fakeLLM, makeConfig());

    expect(mockRunScoutAgent).not.toHaveBeenCalled();
    expect(octokit.issues.create).not.toHaveBeenCalled();
  });

  it("runs Scout and closes done issue when HEAD SHA differs", async () => {
    const doneIssue = {
      number: 5,
      title: "glima: repository is clean",
      body: "<!-- glima-done-sha: old-sha -->",
      state: "open",
      labels: [{ name: "glima:done" }],
    };
    const updateIssue = vi.fn().mockResolvedValue({});
    const octokit = { paginate: vi.fn().mockResolvedValue([doneIssue]), issues: { create: vi.fn(), update: updateIssue } };
    mockGetInstallationOctokit.mockResolvedValue(octokit);
    mockGetHeadSha.mockResolvedValue("newsha123");
    mockRunScoutAgent.mockResolvedValue({
      issues: [{ title: "Bug", body: "b", category: "bug", severity: "high", file_paths: [] }],
      repo_is_clean: false,
      reasoning: "Found issues",
    });

    const { runScoutPipeline } = await import("../pipeline/scout.pipeline.js");
    await runScoutPipeline(fakeLLM, makeConfig());

    expect(updateIssue).toHaveBeenCalledWith(expect.objectContaining({ state: "closed" }));
    expect(mockRunScoutAgent).toHaveBeenCalled();
  });
});

// ─── Fix Pipeline ──────────────────────────────────────────────────────────────

describe("Fix Pipeline", () => {
  function makePayload(issueNumber: number) {
    return {
      action: "opened",
      issue: { number: issueNumber, title: "Test bug", body: "Bug in `src/foo.ts`", state: "open" as const, labels: [{ name: "glima:scout" }], html_url: "" },
      sender: { login: "glima[bot]" },
      repository: { name: "repo", owner: { login: "owner" } },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstallationToken.mockResolvedValue("tok");
    setupWorkspace();
    mockRunFixerAgent.mockResolvedValue({
      changes: [{ path: "src/foo.ts", operation: "modify", content: "fixed" }],
      commit_message: "fix: null pointer (#7)",
      explanation: "Added null check",
      is_complete: true,
    });
    mockRunDocumenterAgent.mockResolvedValue({ changes: [], changelog_entry: "- fix (#7)" });
  });

  it("opens a PR when no existing PR for the issue", async () => {
    const createPR = vi.fn().mockResolvedValue({ data: { number: 42, html_url: "" } });
    const octokit = {
      pulls: { list: vi.fn().mockResolvedValue({ data: [] }), create: createPR },
    };
    mockGetInstallationOctokit.mockResolvedValue(octokit);

    const { runFixPipeline } = await import("../pipeline/fix.pipeline.js");
    await runFixPipeline(fakeLLM, makeConfig(), makePayload(7));

    expect(createPR).toHaveBeenCalledWith(
      expect.objectContaining({ head: "glima/fix-7", body: expect.stringContaining("Closes #7") }),
    );
  });

  it("skips when a PR already exists for the issue", async () => {
    const createPR = vi.fn();
    const octokit = {
      pulls: { list: vi.fn().mockResolvedValue({ data: [{ number: 20 }] }), create: createPR },
    };
    mockGetInstallationOctokit.mockResolvedValue(octokit);

    const { runFixPipeline } = await import("../pipeline/fix.pipeline.js");
    await runFixPipeline(fakeLLM, makeConfig(), makePayload(7));

    expect(createPR).not.toHaveBeenCalled();
  });
});

// ─── Review Pipeline ───────────────────────────────────────────────────────────

describe("Review Pipeline", () => {
  function makePRPayload(prNumber: number, body = "Closes #5") {
    return {
      action: "opened",
      pull_request: { number: prNumber, title: "glima: fix #5", body, state: "open" as const, head: { ref: "glima/fix-5", sha: "headsha" }, base: { ref: "main", sha: "basesha" }, user: { login: "glima[bot]" }, html_url: "" },
      sender: { login: "glima[bot]" },
      repository: { name: "repo", owner: { login: "owner" } },
    };
  }

  function buildOctokit() {
    return {
      pulls: {
        get: vi.fn().mockResolvedValue({ data: "diff content" }),
        createReview: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
      issues: {
        // Return a Qodo comment immediately so the poll loop exits on the first check
        // rather than waiting up to 90 seconds for the window to expire.
        listComments: vi.fn().mockResolvedValue({
          data: [{ body: "LGTM from Qodo", user: { login: "qodo-merge[bot]" }, id: 1, created_at: "" }],
        }),
        addLabels: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({}),
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstallationToken.mockResolvedValue("tok");
    setupWorkspace();
    mockCountCommits.mockResolvedValue(0);
    mockRunDocumenterAgent.mockResolvedValue({ changes: [], changelog_entry: "- fix" });
    mockRunFixerAgent.mockResolvedValue({
      changes: [{ path: "src/foo.ts", operation: "modify", content: "x" }],
      commit_message: "fix: apply review",
      explanation: "Fixed",
      is_complete: true,
    });
  });

  it("posts approval when reviewer returns APPROVE", async () => {
    const octokit = buildOctokit();
    mockGetInstallationOctokit.mockResolvedValue(octokit);
    mockRunReviewerAgent.mockResolvedValue({ verdict: "APPROVE", comments: [], summary: "LGTM", qodo_comments_addressed: true });

    const { runReviewPipeline } = await import("../pipeline/review.pipeline.js");
    await runReviewPipeline(fakeLLM, makeConfig(), makePRPayload(30));

    expect(octokit.pulls.createReview).toHaveBeenCalledWith(expect.objectContaining({ event: "APPROVE" }));
  });

  it("closes PR and labels issue when iteration ceiling is hit", async () => {
    mockCountCommits.mockResolvedValue(3); // >= MAX_FIX_ITERATIONS (3)
    const octokit = buildOctokit();
    mockGetInstallationOctokit.mockResolvedValue(octokit);

    const { runReviewPipeline } = await import("../pipeline/review.pipeline.js");
    await runReviewPipeline(fakeLLM, makeConfig(), makePRPayload(31));

    expect(octokit.pulls.update).toHaveBeenCalledWith(expect.objectContaining({ state: "closed" }));
    expect(octokit.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: expect.arrayContaining(["glima:halted"]) }));
    expect(octokit.issues.createComment).toHaveBeenCalled();
  });

  it("posts request-changes and applies fixer when reviewer returns REQUEST_CHANGES", async () => {
    const octokit = buildOctokit();
    mockGetInstallationOctokit.mockResolvedValue(octokit);
    mockRunReviewerAgent.mockResolvedValue({
      verdict: "REQUEST_CHANGES",
      comments: [{ file_path: "src/foo.ts", line: 10, comment: "Fix this", severity: "blocking" }],
      summary: "Needs fixes",
      qodo_comments_addressed: false,
    });

    const { runReviewPipeline } = await import("../pipeline/review.pipeline.js");
    await runReviewPipeline(fakeLLM, makeConfig(), makePRPayload(32));

    expect(octokit.pulls.createReview).toHaveBeenCalledWith(expect.objectContaining({ event: "REQUEST_CHANGES" }));
    expect(mockRunFixerAgent).toHaveBeenCalled();
  });
});

// ─── Fix Pipeline idempotency ──────────────────────────────────────────────────

describe("Fix Pipeline idempotency (duplicate webhook)", () => {
  it("runs fix only once when opened+labeled fire simultaneously for same issue", async () => {
    let resolveFirst!: () => void;
    const firstBlocker = new Promise<void>((r) => (resolveFirst = r));
    let wsCallCount = 0;

    mockWithWorkspace.mockImplementation(async (_t: unknown, _o: unknown, _r: unknown, fn: Function) => {
      wsCallCount++;
      const git = fakeGit();
      mockOpenRepo.mockReturnValue(git);
      if (wsCallCount === 1) await firstBlocker;
      return fn({ path: "/ws/test", git });
    });

    const createPR = vi.fn().mockResolvedValue({ data: { number: 50, html_url: "" } });
    const octokit = { pulls: { list: vi.fn().mockResolvedValue({ data: [] }), create: createPR } };
    mockGetInstallationOctokit.mockResolvedValue(octokit);
    mockGetInstallationToken.mockResolvedValue("tok");
    mockRunFixerAgent.mockResolvedValue({
      changes: [{ path: "src/foo.ts", operation: "modify", content: "x" }],
      commit_message: "fix: thing (#20)",
      explanation: "fixed",
      is_complete: true,
    });
    mockRunDocumenterAgent.mockResolvedValue({ changes: [], changelog_entry: "- fix" });

    const payload = {
      action: "opened",
      issue: { number: 20, title: "Bug", body: "", state: "open" as const, labels: [{ name: "glima:scout" }], html_url: "" },
      sender: { login: "glima[bot]" },
      repository: { name: "repo", owner: { login: "owner" } },
    };

    const { runFixPipeline } = await import("../pipeline/fix.pipeline.js");

    // Fire both simultaneously
    const p1 = runFixPipeline(fakeLLM, makeConfig(), payload);
    const p2 = runFixPipeline(fakeLLM, makeConfig(), payload);

    resolveFirst();
    await Promise.all([p1, p2]);

    expect(createPR).toHaveBeenCalledTimes(1);
  });
});
