import { readFile, writeFile, rm, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { readFileSync } from "fs";
import type { Octokit } from "@octokit/rest";
import type { LLMProvider } from "../llm/interface.js";
import type { Config } from "../config.js";
import { FixerOutputSchema, type FixerOutput } from "../llm/schemas/fixer.schema.js";
import type { GitHubIssue } from "../github/types.js";
import { logger } from "../util/logger.js";

const PROMPT = readFileSync(new URL("../../prompts/fixer.txt", import.meta.url), "utf8");

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function runFixerAgent(
  octokit: Octokit,
  llm: LLMProvider,
  config: Config,
  workspacePath: string,
  issue: GitHubIssue,
): Promise<FixerOutput> {
  // Build context from issue body file references
  const fileRefs = extractFilePaths(issue.body ?? "");
  const fileContents: string[] = [];
  for (const rel of fileRefs) {
    const content = await readFileSafe(join(workspacePath, rel));
    if (content !== null) {
      fileContents.push(`## ${rel}\n\`\`\`\n${content}\n\`\`\``);
    }
  }

  const userMessage = [
    `## Issue #${issue.number}: ${issue.title}`,
    "",
    issue.body ?? "",
    "",
    ...(fileContents.length ? ["## Relevant files", ...fileContents] : []),
  ].join("\n");

  const response = await llm.complete({
    model: config.LLM_MODEL_FIXER,
    messages: [
      { role: "system", content: PROMPT },
      { role: "user",   content: userMessage },
    ],
    responseFormat: "json",
    maxTokens: 8192,
  });

  const output = FixerOutputSchema.parse(JSON.parse(response.content));

  // Apply changes to workspace
  for (const change of output.changes) {
    const fullPath = join(workspacePath, change.path);
    if (change.operation === "delete") {
      await rm(fullPath, { force: true });
    } else {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, change.content ?? "", "utf8");
    }
    logger.info(`Fixer: ${change.operation} ${change.path}`, {
      phase: "fixer",
      issueNumber: issue.number,
    });
  }

  return output;
}

function extractFilePaths(body: string): string[] {
  // Match patterns like `src/foo/bar.ts` or path/to/file.ext in code blocks or backticks
  const matches = body.match(/`([^`\s]+\.[a-zA-Z]{1,10})`/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1, -1)))];
}
