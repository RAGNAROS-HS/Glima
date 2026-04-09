import { z } from "zod";

export const DocChangeSchema = z.object({
  path: z.string(),
  operation: z.enum(["create", "modify"]),
  content: z.string(),
  change_summary: z.string(),
});

export const DocumenterOutputSchema = z.object({
  changes: z.array(DocChangeSchema),
  changelog_entry: z.string(),
});

export type DocumenterOutput = z.infer<typeof DocumenterOutputSchema>;
export type DocChange        = z.infer<typeof DocChangeSchema>;
