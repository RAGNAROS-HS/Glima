import type { LLMProvider } from "../llm/interface.js";
import type { Config } from "../config.js";
import type { IssuePayload } from "../github/types.js";
import { withLock } from "../util/concurrency.js";
import { withWorkspace } from "../workspace/manager.js";
import { getInstallationToken, getInstallationOctokit } from "../github/app.js";
import { runFixerAgent } from "../agents/fixer.js";
import { runDocumenterAgent } from "../agents/documenter.js";
import { LABELS } from "../github/labels.js";
import { createBranch, commitAll, pushBranch } from "../workspace/git.js";
import { openRepo } from "../workspace/git.js";
import { logger } from "../util/logger.js";
import simpleGit from "simple-git";

const PR_BODY_TEMPLATE = (
  issueNumber: number,
  explanation: string,
  changePaths: string[],
  changelogEntry: string,
) => `Closes #${issueNumber}

## Summary
${explanation}

## Changes
${changePaths.map((p) => `- \`${p}\``).join("\n")}

## Documentation
${changelogEntry}

---
*This PR was opened automatically by Glima. Do not merge until you have reviewed the changes.*`;

async function getExistingPR(
  octokit: ReturnType<typeof import("../github/app.js").getInstallationOctokit> extends Promise<infer T> ? T : never,
  config: Config,
  issueNumber: number,
): Promise<boolean> {
  const prs = await octokit.pulls.list({
    owner: config.GITHUB_REPO_OWNER,
    repo:  config.GITHUB_REPO_NAME,
    state: "open",
    head:  `${config.GITHUB_REPO_OWNER}:glima/fix-${issueNumber}`,
  });
  return prs.data.length > 0;
}

export async function runFixPipeline(
  llm: LLMProvider,
  config: Config,
  payload: IssuePayload,
): Promise<void> {
  const issue = payload.issue;
  const lockKey = `fix:issue:${issue.number}`;

  await withLock(lockKey, async () => {
    const octokit = await getInstallationOctokit(config);

    // Idempotency check
    if (await getExistingPR(octokit, config, issue.number)) {
      logger.info("Fix: PR already exists, skipping", {
        phase: "fix",
        issueNumber: issue.number,
      });
      return;
    }

    const token = await getInstallationToken(config);
    const branchName = `glima/fix-${issue.number}`;

    await withWorkspace(token, config.GITHUB_REPO_OWNER, config.GITHUB_REPO_NAME, async (ctx) => {
      const git = openRepo(ctx.path);

      await createBranch(git, branchName);

      const fixOutput = await runFixerAgent(octokit, llm, config, ctx.path, issue);

      // Generate diff for documenter
      const diffRaw = await git.diff(["HEAD"]);

      const docOutput = await runDocumenterAgent(
        llm,
        config,
        ctx.path,
        issue,
        diffRaw,
      );

      const commitMsg = fixOutput.commit_message.includes(`#${issue.number}`)
        ? fixOutput.commit_message
        : `${fixOutput.commit_message} (#${issue.number})`;

      await commitAll(git, commitMsg);
      await pushBranch(git, branchName);

      const changePaths = fixOutput.changes.map((c) => c.path);

      await octokit.pulls.create({
        owner:  config.GITHUB_REPO_OWNER,
        repo:   config.GITHUB_REPO_NAME,
        title:  `glima: fix #${issue.number} — ${issue.title}`,
        body:   PR_BODY_TEMPLATE(issue.number, fixOutput.explanation, changePaths, docOutput.changelog_entry),
        head:   branchName,
        base:   "main",
        labels: [LABELS.FIX],
      });

      logger.info("Fix: PR opened", { phase: "fix", issueNumber: issue.number });
    });
  });
}
