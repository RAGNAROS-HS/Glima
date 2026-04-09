import { readFileSync } from "fs";
import type { LLMProvider } from "../llm/interface.js";
import type { Config } from "../config.js";
import { ReviewerOutputSchema, type ReviewerOutput } from "../llm/schemas/reviewer.schema.js";
import type { GitHubComment } from "../github/types.js";
import { logger } from "../util/logger.js";

const PROMPT = readFileSync(new URL("../../prompts/reviewer.txt", import.meta.url), "utf8");

export async function runReviewerAgent(
  llm: LLMProvider,
  config: Config,
  prNumber: number,
  diff: string,
  qodoComments: GitHubComment[],
): Promise<ReviewerOutput> {
  const qodoSection = qodoComments.length > 0
    ? [
        "## Qodo review comments",
        ...qodoComments.map((c) => `- ${c.body}`),
      ].join("\n")
    : "## Qodo review comments\n*No Qodo review was available at review time.*";

  const userMessage = [
    `## PR #${prNumber} diff`,
    "```diff",
    diff,
    "```",
    "",
    qodoSection,
  ].join("\n");

  const response = await llm.complete({
    model: config.LLM_MODEL_REVIEWER,
    messages: [
      { role: "system", content: PROMPT },
      { role: "user",   content: userMessage },
    ],
    responseFormat: "json",
    maxTokens: 4096,
  });

  const output = ReviewerOutputSchema.parse(JSON.parse(response.content));
  logger.info(`Reviewer: verdict=${output.verdict}`, { phase: "reviewer", prNumber });
  return output;
}
