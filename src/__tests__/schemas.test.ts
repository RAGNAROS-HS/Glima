import { describe, it, expect } from "vitest";
import { ScoutOutputSchema } from "../llm/schemas/scout.schema.js";
import { FixerOutputSchema } from "../llm/schemas/fixer.schema.js";
import { ReviewerOutputSchema } from "../llm/schemas/reviewer.schema.js";
import { DocumenterOutputSchema } from "../llm/schemas/documenter.schema.js";

describe("ScoutOutputSchema", () => {
  it("parses valid output", () => {
    const result = ScoutOutputSchema.parse({
      issues: [
        {
          title: "Missing null check",
          body: "File `src/foo.ts` line 10 dereferences without null check",
          category: "bug",
          severity: "high",
          file_paths: ["src/foo.ts"],
        },
      ],
      repo_is_clean: false,
      reasoning: "Found one bug",
    });
    expect(result.issues).toHaveLength(1);
    expect(result.repo_is_clean).toBe(false);
  });

  it("rejects invalid category", () => {
    expect(() =>
      ScoutOutputSchema.parse({
        issues: [{ title: "t", body: "b", category: "feature", severity: "low", file_paths: [] }],
        repo_is_clean: false,
        reasoning: "x",
      }),
    ).toThrow();
  });

  it("allows empty issues with repo_is_clean true", () => {
    const result = ScoutOutputSchema.parse({
      issues: [],
      repo_is_clean: true,
      reasoning: "All good",
    });
    expect(result.issues).toHaveLength(0);
  });
});

describe("FixerOutputSchema", () => {
  it("parses valid output", () => {
    const result = FixerOutputSchema.parse({
      changes: [{ path: "src/foo.ts", operation: "modify", content: "const x = 1;" }],
      commit_message: "fix: handle null pointer (#1)",
      explanation: "Added null check",
      is_complete: true,
    });
    expect(result.changes[0].operation).toBe("modify");
  });

  it("rejects empty changes array", () => {
    expect(() =>
      FixerOutputSchema.parse({
        changes: [],
        commit_message: "fix: something",
        explanation: "nothing",
        is_complete: true,
      }),
    ).toThrow();
  });

  it("allows delete without content", () => {
    const result = FixerOutputSchema.parse({
      changes: [{ path: "old.ts", operation: "delete" }],
      commit_message: "fix: remove dead code",
      explanation: "Deleted unused file",
      is_complete: true,
    });
    expect(result.changes[0].content).toBeUndefined();
  });
});

describe("ReviewerOutputSchema", () => {
  it("parses APPROVE verdict", () => {
    const result = ReviewerOutputSchema.parse({
      verdict: "APPROVE",
      comments: [],
      summary: "LGTM",
      qodo_comments_addressed: true,
    });
    expect(result.verdict).toBe("APPROVE");
  });

  it("parses REQUEST_CHANGES with comments", () => {
    const result = ReviewerOutputSchema.parse({
      verdict: "REQUEST_CHANGES",
      comments: [
        { file_path: "src/foo.ts", line: 10, comment: "Fix this", severity: "blocking" },
      ],
      summary: "Needs work",
      qodo_comments_addressed: false,
    });
    expect(result.comments[0].severity).toBe("blocking");
  });

  it("rejects invalid verdict", () => {
    expect(() =>
      ReviewerOutputSchema.parse({
        verdict: "COMMENT",
        comments: [],
        summary: "x",
        qodo_comments_addressed: false,
      }),
    ).toThrow();
  });
});

describe("DocumenterOutputSchema", () => {
  it("parses with changes", () => {
    const result = DocumenterOutputSchema.parse({
      changes: [
        { path: "CHANGELOG.md", operation: "modify", content: "## v0.1\n- fix: null", change_summary: "Added changelog entry" },
      ],
      changelog_entry: "- fix: handle null pointer (#1)",
    });
    expect(result.changes[0].path).toBe("CHANGELOG.md");
  });

  it("parses with empty changes", () => {
    const result = DocumenterOutputSchema.parse({
      changes: [],
      changelog_entry: "- fix: minor fix (#2)",
    });
    expect(result.changes).toHaveLength(0);
  });
});
