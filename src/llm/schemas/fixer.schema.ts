import { z } from "zod";

export const FileChangeSchema = z.object({
  path: z.string(),
  operation: z.enum(["create", "modify", "delete"]),
  content: z.string().optional(),
});

export const FixerOutputSchema = z.object({
  changes: z.array(FileChangeSchema).min(1),
  commit_message: z.string().max(100),
  explanation: z.string(),
  is_complete: z.boolean(),
});

export type FixerOutput = z.infer<typeof FixerOutputSchema>;
export type FileChange  = z.infer<typeof FileChangeSchema>;
