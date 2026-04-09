import { readFile, readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import type { Octokit } from "@octokit/rest";
import type { LLMProvider } from "../llm/interface.js";
import type { Config } from "../config.js";
import { ScoutOutputSchema, type ScoutIssue, type ScoutOutput } from "../llm/schemas/scout.schema.js";
import { LABELS } from "../github/labels.js";
import { getRecentFiles } from "../workspace/git.js";
import { openRepo } from "../workspace/git.js";
import { logger } from "../util/logger.js";

const PROMPT = readFileSync(new URL("../../prompts/scout.txt", import.meta.url), "utf8");
const FINGERPRINT_RE = /<!-- glima-fingerprint: ([a-f0-9]+) -->/;
const TITLE_NORMALIZE = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

function levenshteinRatio(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

function fingerprintIssue(issue: ScoutIssue): string {
  const key = [...issue.file_paths].sort().join("|") + "|" + issue.category;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

async function collectFiles(
  workspacePath: string,
  tokenBudget: number,
  recentFiles: string[],
): Promise<string> {
  const recentSet = new Set(recentFiles);
  const allFiles: Array<{ rel: string; size: number; isRecent: boolean }> = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const rel = relative(workspacePath, full);
        const s = await stat(full);
        allFiles.push({ rel, size: s.size, isRecent: recentSet.has(rel) });
      }
    }
  }
  await walk(workspacePath);

  // File tree listing (always included)
  const tree = allFiles.map((f) => f.rel).join("\n");
  let budget = tokenBudget - Math.ceil(tree.length / 4);

  // Sort: recent first, then by size ascending
  allFiles.sort((a, b) => {
    if (a.isRecent !== b.isRecent) return a.isRecent ? -1 : 1;
    return a.size - b.size;
  });

  const chunks: string[] = [`## File tree\n\`\`\`\n${tree}\n\`\`\``];
  for (const f of allFiles) {
    if (budget <= 0) break;
    try {
      const content = await readFile(join(workspacePath, f.rel), "utf8");
      if (content.length > 200_000) continue; // skip very large files
      const chunk = `\n## ${f.rel}\n\`\`\`\n${content}\n\`\`\``;
      budget -= Math.ceil(chunk.length / 4);
      chunks.push(chunk);
    } catch {
      // binary or unreadable — skip
    }
  }

  return chunks.join("\n");
}

export async function runScoutAgent(
  octokit: Octokit,
  llm: LLMProvider,
  config: Config,
  workspacePath: string,
): Promise<ScoutOutput> {
  const git = openRepo(workspacePath);
  const recentFiles = await getRecentFiles(git);

  const codeContext = await collectFiles(
    workspacePath,
    config.LLM_TOKEN_BUDGET_SCOUT,
    recentFiles,
  );

  const response = await llm.complete({
    model: config.LLM_MODEL_SCOUT,
    messages: [
      { role: "system", content: PROMPT },
      { role: "user",   content: codeContext },
    ],
    responseFormat: "json",
    maxTokens: 4096,
  });

  const parsed = ScoutOutputSchema.parse(JSON.parse(response.content));

  // Fetch existing scout issues for deduplication
  const existing = await octokit.paginate(octokit.issues.listForRepo, {
    owner:  config.GITHUB_REPO_OWNER,
    repo:   config.GITHUB_REPO_NAME,
    state:  "open",
    labels: LABELS.SCOUT,
    per_page: 100,
  });

  const existingTitles = existing.map((i) => TITLE_NORMALIZE(i.title));
  const existingFingerprints = new Set(
    existing.map((i) => {
      const m = (i.body ?? "").match(FINGERPRINT_RE);
      return m ? m[1] : null;
    }).filter(Boolean),
  );

  let filed = 0;
  for (const issue of parsed.issues) {
    const fp = fingerprintIssue(issue);

    // Fingerprint dedup
    if (existingFingerprints.has(fp)) {
      logger.info("Scout: skipping duplicate (fingerprint)", { phase: "scout" });
      continue;
    }

    // Title similarity dedup
    const normTitle = TITLE_NORMALIZE(issue.title);
    const isDupTitle = existingTitles.some(
      (t) => levenshteinRatio(normTitle, t) > 0.85,
    );
    if (isDupTitle) {
      logger.info("Scout: skipping duplicate (title similarity)", { phase: "scout" });
      continue;
    }

    const body = `${issue.body}\n\n<!-- glima-fingerprint: ${fp} -->`;
    await octokit.issues.create({
      owner:  config.GITHUB_REPO_OWNER,
      repo:   config.GITHUB_REPO_NAME,
      title:  issue.title,
      body,
      labels: [LABELS.SCOUT],
    });
    logger.info("Scout: filed issue", { phase: "scout" });
    filed++;
  }

  logger.info(`Scout: filed ${filed} new issues`, { phase: "scout" });
  return parsed;
}
