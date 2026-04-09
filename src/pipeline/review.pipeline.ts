import type { LLMProvider } from "../llm/interface.js";
import type { Config } from "../config.js";
import type { PRPayload, GitHubComment } from "../github/types.js";
import { withLock } from "../util/concurrency.js";
import { withWorkspace } from "../workspace/manager.js";
import { getInstallationToken, getInstallationOctokit } from "../github/app.js";
import { runReviewerAgent } from "../agents/reviewer.js";
import { runFixerAgent } from "../agents/fixer.js";
import { runDocumenterAgent } from "../agents/documenter.js";
import { LABELS } from "../github/labels.js";
import { commitAll, pushBranch, countMatchingCommits, getDefaultBranch } from "../workspace/git.js";
import { openRepo } from "../workspace/git.js";
import simpleGit from "simple-git";
import { logger } from "../util/logger.js";

const APPLY_REVIEW_PREFIX = "glima: apply review";
const QODO_POLL_INTERVAL_MS = 15_000;
const QODO_POLL_MAX_MS = 90_000;

async function pollQodoComments(
  octokit: ReturnType<typeof import("../github/app.js").getInstallationOctokit> extends Promise<infer T> ? T : never,
  config: Config,
  prNumber: number,
): Promise<GitHubComment[]> {
  const start = Date.now();
  let qodoComments: GitHubComment[] = [];

  while (Date.now() - start < QODO_POLL_MAX_MS) {
    const { data: comments } = await octokit.issues.listComments({
      owner:        config.GITHUB_REPO_OWNER,
      repo:         config.GITHUB_REPO_NAME,
      issue_number: prNumber,
    });
    const qodo = comments.filter(
      (c) => c.user?.login === config.QODO_BOT_USERNAME,
    ) as GitHubComment[];
    if (qodo.length > 0) {
      return qodo;
    }
    await new Promise((r) => setTimeout(r, QODO_POLL_INTERVAL_MS));
  }

  return qodoComments;
}

async function getPRDiff(
  octokit: ReturnType<typeof import("../github/app.js").getInstallationOctokit> extends Promise<infer T> ? T : never,
  config: Config,
  prNumber: number,
): Promise<string> {
  const { data } = await octokit.pulls.get({
    owner:       config.GITHUB_REPO_OWNER,
    repo:        config.GITHUB_REPO_NAME,
    pull_number: prNumber,
    mediaType:   { format: "diff" },
  });
  return data as unknown as string;
}

async function getIssueNumberFromPR(
  octokit: ReturnType<typeof import("../github/app.js").getInstallationOctokit> extends Promise<infer T> ? T : never,
  config: Config,
  pr: PRPayload["pull_request"],
): Promise<number | null> {
  const match = (pr.body ?? "").match(/Closes #(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

export async function runReviewPipeline(
  llm: LLMProvider,
  config: Config,
  payload: PRPayload,
): Promise<void> {
  const pr = payload.pull_request;
  const lockKey = `review:pr:${pr.number}`;

  await withLock(lockKey, async () => {
    const octokit = await getInstallationOctokit(config);
    const token   = await getInstallationToken(config);

    // Check iteration ceiling before any LLM call
    const tmpGit = simpleGit();
    const tempCloneResult = await new Promise<number>(async (resolve) => {
      await withWorkspace(token, config.GITHUB_REPO_OWNER, config.GITHUB_REPO_NAME, async (ctx) => {
        const git = openRepo(ctx.path);
        await git.checkout(pr.head.ref);
        const defaultBranch = await getDefaultBranch(git);
        const count = await countMatchingCommits(
          git,
          defaultBranch,
          config.BOT_GITHUB_LOGIN,
          APPLY_REVIEW_PREFIX,
        );
        resolve(count);
      });
    });

    if (tempCloneResult >= config.MAX_FIX_ITERATIONS) {
      logger.warn("Review: iteration ceiling hit — halting", {
        phase: "review",
        prNumber: pr.number,
      });
      await octokit.pulls.update({
        owner:       config.GITHUB_REPO_OWNER,
        repo:        config.GITHUB_REPO_NAME,
        pull_number: pr.number,
        state:       "closed",
      });
      const issueNumber = await getIssueNumberFromPR(octokit, config, pr);
      if (issueNumber) {
        await octokit.issues.addLabels({
          owner:        config.GITHUB_REPO_OWNER,
          repo:         config.GITHUB_REPO_NAME,
          issue_number: issueNumber,
          labels:       [LABELS.HALTED],
        });
      }
      await octokit.issues.createComment({
        owner:        config.GITHUB_REPO_OWNER,
        repo:         config.GITHUB_REPO_NAME,
        issue_number: pr.number,
        body:         `Glima has reached the maximum review iteration limit (${config.MAX_FIX_ITERATIONS}). This PR requires human attention to resolve the outstanding review feedback.`,
      });
      return;
    }

    // Fetch diff and poll for Qodo
    const [diff, qodoComments] = await Promise.all([
      getPRDiff(octokit, config, pr.number),
      pollQodoComments(octokit, config, pr.number),
    ]);

    const reviewOutput = await runReviewerAgent(llm, config, pr.number, diff, qodoComments);

    if (reviewOutput.verdict === "APPROVE") {
      await octokit.pulls.createReview({
        owner:       config.GITHUB_REPO_OWNER,
        repo:        config.GITHUB_REPO_NAME,
        pull_number: pr.number,
        event:       "APPROVE",
        body:        reviewOutput.summary,
      });
      logger.info("Review: approved", { phase: "review", prNumber: pr.number });
      return;
    }

    // REQUEST_CHANGES — post inline comments, then apply fixes
    const reviewComments = reviewOutput.comments
      .filter((c) => c.file_path && c.line)
      .map((c) => ({
        path:     c.file_path!,
        position: c.line!,
        body:     c.comment,
      }));

    await octokit.pulls.createReview({
      owner:       config.GITHUB_REPO_OWNER,
      repo:        config.GITHUB_REPO_NAME,
      pull_number: pr.number,
      event:       "REQUEST_CHANGES",
      body:        reviewOutput.summary,
      comments:    reviewComments,
    });

    // Apply fixes in a new workspace
    const issueNumber = await getIssueNumberFromPR(octokit, config, pr);

    await withWorkspace(token, config.GITHUB_REPO_OWNER, config.GITHUB_REPO_NAME, async (ctx) => {
      const git = openRepo(ctx.path);
      await git.checkout(pr.head.ref);

      // Build a synthetic issue from review comments for the fixer
      const reviewIssue = {
        number: pr.number,
        title:  `Apply review feedback for PR #${pr.number}`,
        body:   reviewOutput.comments.map((c) => `- ${c.comment}`).join("\n"),
        state:  "open" as const,
        labels: [],
        html_url: "",
      };

      await runFixerAgent(octokit, llm, config, ctx.path, reviewIssue);

      const currentDiff = await git.diff(["HEAD"]);

      if (issueNumber !== null) {
        const sourceIssue = {
          number: issueNumber,
          title:  pr.title,
          body:   pr.body ?? "",
          state:  "open" as const,
          labels: [],
          html_url: "",
        };
        await runDocumenterAgent(llm, config, ctx.path, sourceIssue, currentDiff);
      }

      const iterCount = tempCloneResult + 1;
      await commitAll(git, `${APPLY_REVIEW_PREFIX} #${pr.number} iter ${iterCount}`);
      await pushBranch(git, pr.head.ref);

      logger.info(`Review: applied fixes, iter ${iterCount}`, {
        phase: "review",
        prNumber: pr.number,
      });
    });
  });
}
