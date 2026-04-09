import { z } from "zod";

export const ScoutIssueSchema = z.object({
  title: z.string().max(200),
  body: z.string(),
  category: z.enum(["bug", "security", "missing-test", "inefficiency", "documentation"]),
  severity: z.enum(["critical", "high", "medium", "low"]),
  file_paths: z.array(z.string()),
});

export const ScoutOutputSchema = z.object({
  issues: z.array(ScoutIssueSchema),
  repo_is_clean: z.boolean(),
  reasoning: z.string(),
});

export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;
export type ScoutIssue  = z.infer<typeof ScoutIssueSchema>;
