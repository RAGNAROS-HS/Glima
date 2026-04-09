import type { Octokit } from "@octokit/rest";
import type { LLMProvider } from "../llm/interface.js";
import type { Config } from "../config.js";
import { withLock } from "../util/concurrency.js";
import { withWorkspace } from "../workspace/manager.js";
import { getInstallationToken, getInstallationOctokit } from "../github/app.js";
import { runScoutAgent } from "../agents/scout.js";
import { LABELS } from "../github/labels.js";
import { getHeadSha } from "../workspace/git.js";
import { openRepo } from "../workspace/git.js";
import { logger } from "../util/logger.js";

const DONE_ISSUE_TITLE = "glima: repository is clean";
const SHA_RE = /<!-- glima-done-sha: ([a-f0-9]+) -->/;

async function getDoneIssue(octokit: Octokit, config: Config) {
  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner:  config.GITHUB_REPO_OWNER,
    repo:   config.GITHUB_REPO_NAME,
    state:  "open",
    labels: LABELS.DONE,
    per_page: 10,
  });
  return issues.find((i) => i.title === DONE_ISSUE_TITLE) ?? null;
}

export async function runScoutPipeline(
  llm: LLMProvider,
  config: Config,
): Promise<void> {
  await withLock("scout", async () => {
    const octokit = await getInstallationOctokit(config);
    const token   = await getInstallationToken(config);

    // Check stopping condition before cloning
    const doneIssue = await getDoneIssue(octokit, config);

    await withWorkspace(token, config.GITHUB_REPO_OWNER, config.GITHUB_REPO_NAME, async (ctx) => {
      const headSha = await getHeadSha(openRepo(ctx.path));

      if (doneIssue) {
        const m = (doneIssue.body ?? "").match(SHA_RE);
        const storedSha = m ? m[1] : null;
        if (storedSha === headSha) {
          logger.info("Scout: repo unchanged since last clean scan — skipping", {
            phase: "scout",
            sha: headSha,
          });
          return;
        }
      }

      const result = await runScoutAgent(octokit, llm, config, ctx.path);

      if (result.issues.length === 0 || result.repo_is_clean) {
        // Upsert glima:done issue
        const body = `The Scout agent found no issues in the repository.\n\n<!-- glima-done-sha: ${headSha} -->`;
        if (doneIssue) {
          await octokit.issues.update({
            owner:      config.GITHUB_REPO_OWNER,
            repo:       config.GITHUB_REPO_NAME,
            issue_number: doneIssue.number,
            body,
          });
          logger.info("Scout: updated glima:done issue", { phase: "scout", sha: headSha });
        } else {
          await octokit.issues.create({
            owner:  config.GITHUB_REPO_OWNER,
            repo:   config.GITHUB_REPO_NAME,
            title:  DONE_ISSUE_TITLE,
            body,
            labels: [LABELS.DONE],
          });
          logger.info("Scout: created glima:done issue", { phase: "scout", sha: headSha });
        }
      } else {
        // Close any existing done issue
        if (doneIssue) {
          await octokit.issues.update({
            owner:        config.GITHUB_REPO_OWNER,
            repo:         config.GITHUB_REPO_NAME,
            issue_number: doneIssue.number,
            state:        "closed",
          });
        }
        logger.info(`Scout: filed issues, repo not clean`, { phase: "scout" });
      }
    });
  });
}
