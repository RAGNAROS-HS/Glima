import { z } from "zod";

export const ReviewCommentSchema = z.object({
  file_path: z.string().optional(),
  line: z.number().optional(),
  comment: z.string(),
  severity: z.enum(["blocking", "suggestion"]),
});

export const ReviewerOutputSchema = z.object({
  verdict: z.enum(["APPROVE", "REQUEST_CHANGES"]),
  comments: z.array(ReviewCommentSchema),
  summary: z.string(),
  qodo_comments_addressed: z.boolean(),
});

export type ReviewerOutput  = z.infer<typeof ReviewerOutputSchema>;
export type ReviewComment   = z.infer<typeof ReviewCommentSchema>;
