import type { Octokit } from "@octokit/rest";

export const LABELS = {
  SCOUT:   "glima:scout",
  FIX:     "glima:fix",
  HALTED:  "glima:halted",
  DONE:    "glima:done",
} as const;

const LABEL_DEFS: Array<{ name: string; color: string; description: string }> = [
  { name: LABELS.SCOUT,  color: "0075ca", description: "Issue filed by Scout" },
  { name: LABELS.FIX,    color: "e4e669", description: "PR opened by Glima" },
  { name: LABELS.HALTED, color: "d93f0b", description: "Iteration limit hit — needs human" },
  { name: LABELS.DONE,   color: "0e8a16", description: "Repo is clean per Scout" },
];

export async function ensureLabels(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<void> {
  for (const label of LABEL_DEFS) {
    try {
      await octokit.issues.createLabel({ owner, repo, ...label });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status !== 422) throw err;
      // 422 = label already exists — treat as success
    }
  }
}
