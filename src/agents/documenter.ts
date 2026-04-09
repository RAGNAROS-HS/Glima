import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { readFileSync } from "fs";
import type { LLMProvider } from "../llm/interface.js";
import type { Config } from "../config.js";
import { DocumenterOutputSchema, type DocumenterOutput } from "../llm/schemas/documenter.schema.js";
import type { GitHubIssue } from "../github/types.js";
import { logger } from "../util/logger.js";

const PROMPT = readFileSync(new URL("../../prompts/documenter.txt", import.meta.url), "utf8");

export async function runDocumenterAgent(
  llm: LLMProvider,
  config: Config,
  workspacePath: string,
  issue: GitHubIssue,
  diff: string,
): Promise<DocumenterOutput> {
  const userMessage = [
    `## Issue #${issue.number}: ${issue.title}`,
    "",
    issue.body ?? "",
    "",
    "## Applied diff",
    "```diff",
    diff,
    "```",
  ].join("\n");

  const response = await llm.complete({
    model: config.LLM_MODEL_DOCUMENTER,
    messages: [
      { role: "system", content: PROMPT },
      { role: "user",   content: userMessage },
    ],
    responseFormat: "json",
    maxTokens: 4096,
  });

  const output = DocumenterOutputSchema.parse(JSON.parse(response.content));

  for (const change of output.changes) {
    const fullPath = join(workspacePath, change.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, change.content, "utf8");
    logger.info(`Documenter: ${change.operation} ${change.path}`, {
      phase: "documenter",
      issueNumber: issue.number,
    });
  }

  return output;
}
