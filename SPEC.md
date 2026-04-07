# Glima — Technical Specification

## 1. Overview

Glima is a GitHub App that hardens an existing codebase autonomously. It finds real problems,
fixes them minimally, reviews its own work adversarially, and hands every change to the human
for final approval. It does not add features.

### Pipeline Stages

```
Scout ──► Fix ──► Adversarial Review ──► Human Merge
                       ▲      │
                       └──────┘ (loop, max N iterations)
```

Each stage is described in full below.

1. **Scout** — Nightly scan. Files atomic GitHub issues for bugs, security gaps, missing tests,
   inefficiencies, and documentation gaps.
2. **Fix** — Immediately picks up each Scout issue, implements a minimal fix, updates docs, and
   opens a PR.
3. **Adversarial Review** — A separate reviewer LLM scrutinises the PR diff. Incorporates Qodo's
   automated comments. Loops with the Fixer until satisfied or until the iteration ceiling is hit.
4. **Human Merge** — Glima never merges. Every PR requires explicit human approval.
5. **Documentation** — Happens inside the Fix PR (changelog, README, in-code docs), not post-merge.

### Explicit Non-Goals

- No new features. Glima only improves existing code — it never introduces new features, even when reviewing a human-authored PR.
- No autonomous merges.

---

## 2. Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript 5.x |
| HTTP server | Express.js |
| GitHub SDK | `@octokit/app`, `@octokit/webhooks`, `@octokit/rest` |
| Git operations | `simple-git` |
| Scheduler | `node-cron` |
| Validation | `zod` |
| LLM — Anthropic | `@anthropic-ai/sdk` |
| LLM — OpenAI | `openai` |
| Process manager | PM2 |

---

## 3. Directory Structure

```
glima/
├── src/
│   ├── index.ts                    # Entry: Express server + cron registration
│   ├── config.ts                   # Zod env validation; process exits if invalid
│   ├── github/
│   │   ├── app.ts                  # Octokit App instantiation + installation auth
│   │   ├── webhooks.ts             # Webhook signature check + event routing
│   │   ├── labels.ts               # Label constants + ensureLabels() bootstrap
│   │   └── types.ts                # GitHub payload type aliases
│   ├── llm/
│   │   ├── interface.ts            # LLMProvider interface + LLMRequest/Response types
│   │   ├── anthropic.ts            # AnthropicProvider
│   │   ├── openai.ts               # OpenAIProvider
│   │   ├── factory.ts              # createProvider(config) factory
│   │   └── schemas/
│   │       ├── scout.schema.ts
│   │       ├── fixer.schema.ts
│   │       ├── reviewer.schema.ts
│   │       └── documenter.schema.ts
│   ├── agents/
│   │   ├── scout.ts                # ScoutAgent
│   │   ├── fixer.ts                # FixerAgent
│   │   ├── reviewer.ts             # ReviewerAgent
│   │   └── documenter.ts          # DocumenterAgent
│   ├── workspace/
│   │   ├── manager.ts              # withWorkspace() — clone, run fn, rm -rf
│   │   └── git.ts                  # simple-git wrappers
│   ├── pipeline/
│   │   ├── scout.pipeline.ts       # Scout orchestration
│   │   ├── fix.pipeline.ts         # Fix + Doc orchestration
│   │   └── review.pipeline.ts      # Adversarial review loop
│   └── util/
│       ├── logger.ts               # Structured JSON logger
│       ├── retry.ts                # Exponential backoff
│       └── concurrency.ts          # withLock(key, fn) — in-process job lock
├── prompts/
│   ├── scout.txt
│   ├── fixer.txt
│   ├── reviewer.txt
│   └── documenter.txt
├── workspace/                      # .gitignored — transient clones only
├── pm2.config.cjs
├── tsconfig.json
├── package.json
└── .env.example
```

---

## 4. Flow Diagrams

### 4a. Scout Pipeline

```mermaid
flowchart TD
    A([Nightly cron fires]) --> B{glima:done issue open\nAND HEAD SHA matches\nlast scan SHA?}
    B -- Yes --> Z([Skip — repo is clean])
    B -- No --> C[Acquire scout job lock]
    C --> D[withWorkspace: clone repo]
    D --> E[Read file tree + file contents\nup to LLM_TOKEN_BUDGET_SCOUT\nprioritised by recency + size]
    E --> F[LLM: ScoutAgent]
    F --> G{ScoutOutput.issues empty?}
    G -- Yes --> H{glima:done issue exists?}
    H -- Yes --> I[Update issue body\nwith current HEAD SHA + timestamp]
    H -- No --> J[Create glima:done issue\nwith HEAD SHA + timestamp]
    I --> Z2([Done])
    J --> Z2
    G -- No --> K[Close glima:done issue\nif open]
    K --> L[For each issue in ScoutOutput]
    L --> M{Duplicate check:\ntitle similarity + body fingerprint}
    M -- Duplicate --> N([Skip])
    M -- New --> O[Create GitHub issue\nLabel: glima:scout\nEmbed fingerprint as HTML comment]
    O --> P{More issues?}
    P -- Yes --> L
    P -- No --> Q[Release scout job lock]
    Q --> R([Done])
```

### 4b. Fix Pipeline

```mermaid
flowchart TD
    A([Webhook: issues.opened\nor issues.labeled = glima:scout]) --> B{PR already exists\nfor issue #N?}
    B -- Yes --> Z([Ignore — already in flight])
    B -- No --> C[Acquire fix lock: fix:issue:N]
    C --> D[withWorkspace: clone repo]
    D --> E[Create branch: glima/fix-N]
    E --> F[LLM: FixerAgent\ninput: issue body + relevant file contents]
    F --> G[Apply FixerOutput.changes\nto workspace files]
    G --> H[LLM: DocumenterAgent\ninput: issue + applied diff]
    H --> I[Apply DocumenterOutput.changes\nto workspace files]
    I --> J[git commit:\nglima: fix #N — title]
    J --> K[git push branch]
    K --> L[Open PR\nLabel: glima:fix\nBody: Closes #N + PR template]
    L --> M[Release fix lock]
    M --> N([Done — review pipeline takes over])
```

### 4c. Adversarial Review Loop

```mermaid
flowchart TD
    A([Webhook: pull_request.opened\nor pull_request.synchronize\nany PR author]) --> B[Count glima: apply review\ncommits on branch]
    B --> C{count >= MAX_FIX_ITERATIONS?}
    C -- Yes --> D[Close PR\nLabel issue: glima:halted\nPost escalation comment]
    D --> E([Halted — needs human])
    C -- No --> F[Fetch PR diff]
    F --> G[Poll for Qodo comments\nevery 15s up to 90s]
    G --> H[LLM: ReviewerAgent\ninput: diff + Qodo comments]
    H --> I{ReviewerOutput.verdict}
    I -- APPROVE --> J[Post approval review]
    J --> K([Done — awaiting human merge])
    I -- REQUEST_CHANGES --> L[Post inline review comments]
    L --> M[Acquire review lock: review:pr:N]
    M --> N[withWorkspace: clone branch]
    N --> O[LLM: FixerAgent\ninput: review comments + current diff]
    O --> P[Apply patch]
    P --> Q[LLM: DocumenterAgent\nif docs need updating]
    Q --> R[git commit:\nglima: apply review #N iter K]
    R --> S[git push]
    S --> T([push triggers synchronize\n→ loop back to top])
```

### 4d. Stopping Condition

```mermaid
flowchart TD
    A([Scout fires]) --> B[Fetch open issues with label glima:done]
    B --> C{Issue found?}
    C -- No --> D[Run Scout analysis]
    C -- Yes --> E[Extract last scan SHA\nfrom issue body HTML comment]
    E --> F[Fetch repo HEAD SHA]
    F --> G{HEAD SHA == stored SHA?}
    G -- Yes --> H([Skip entirely — repo unchanged])
    G -- No --> D
    D --> I{Issues found?}
    I -- Yes --> J[Close glima:done issue if open\nFile new scout issues]
    I -- No --> K[Upsert glima:done issue\nStore HEAD SHA + timestamp]
    J --> L([Done])
    K --> L
```

---

## 5. GitHub Labels

| Label | Hex | Meaning |
|---|---|---|
| `glima:scout` | `#0075ca` | Issue filed by Scout |
| `glima:fix` | `#e4e669` | PR opened by Glima |
| `glima:halted` | `#d93f0b` | Iteration limit hit — needs human |
| `glima:done` | `#0e8a16` | Repo is clean per Scout |

All labels are bootstrapped by `ensureLabels()` on startup and on the `installation.created`
webhook. HTTP 422 (label exists) is treated as success.

---

## 6. Webhook Routing Table

| Event | Action | Condition | Handler |
|---|---|---|---|
| `issues` | `opened` | labels include `glima:scout` | `fix.pipeline` |
| `issues` | `labeled` | label name = `glima:scout` | `fix.pipeline` (idempotent) |
| `pull_request` | `opened` | — | `review.pipeline` |
| `pull_request` | `synchronize` | — | `review.pipeline` |
| `push` | any | `sender.login === BOT_GITHUB_LOGIN` | Drop immediately |
| `installation` | `created` | — | `labels.ensureLabels()` |
| `ping` | — | — | 200 OK |

**Not handled:** `pull_request_review` events; `issues` events where the action is not `opened` or `labeled`.

**Idempotency:** Both `issues.opened` and `issues.labeled` can fire for the same issue when
Scout creates and labels it in a single API call (GitHub behaviour varies). Both handlers must
check for an existing open PR for the issue before acquiring a lock.

---

## 7. LLM Interface and Adapter Pattern

### `src/llm/interface.ts`

```typescript
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  responseFormat?: "json";  // provider must enforce structured JSON output
}

export interface LLMResponse {
  content: string;           // raw text, or JSON string if responseFormat=json
  inputTokens: number;
  outputTokens: number;
  stopReason: "end_turn" | "max_tokens" | string;
}

export interface LLMProvider {
  readonly name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}
```

### `src/llm/factory.ts`

```typescript
import type { Config } from "../config.js";
import type { LLMProvider } from "./interface.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";

export function createProvider(config: Config): LLMProvider {
  switch (config.LLM_PROVIDER) {
    case "anthropic": return new AnthropicProvider(config.LLM_API_KEY);
    case "openai":    return new OpenAIProvider(config.LLM_API_KEY);
    default: throw new Error(`Unknown LLM provider: ${config.LLM_PROVIDER}`);
  }
}
```

Agents receive an `LLMProvider` instance. No agent imports an LLM SDK directly.

---

## 8. LLM Output Schemas (Zod)

### `src/llm/schemas/scout.schema.ts`

```typescript
import { z } from "zod";

export const ScoutIssueSchema = z.object({
  title: z.string().max(200),
  body: z.string(),          // Markdown: problem, location (file+line), evidence, why not a feature
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
```

### `src/llm/schemas/fixer.schema.ts`

```typescript
import { z } from "zod";

export const FileChangeSchema = z.object({
  path: z.string(),
  operation: z.enum(["create", "modify", "delete"]),
  content: z.string().optional(),   // full new file content for create/modify
});

export const FixerOutputSchema = z.object({
  changes: z.array(FileChangeSchema).min(1),
  commit_message: z.string().max(100),
  explanation: z.string(),
  is_complete: z.boolean(),         // false = LLM thinks the fix is partial
});

export type FixerOutput = z.infer<typeof FixerOutputSchema>;
```

### `src/llm/schemas/reviewer.schema.ts`

```typescript
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

export type ReviewerOutput = z.infer<typeof ReviewerOutputSchema>;
```

### `src/llm/schemas/documenter.schema.ts`

```typescript
import { z } from "zod";

export const DocChangeSchema = z.object({
  path: z.string(),
  operation: z.enum(["create", "modify"]),
  content: z.string(),           // full file content after changes
  change_summary: z.string(),
});

export const DocumenterOutputSchema = z.object({
  changes: z.array(DocChangeSchema),   // empty = no doc changes needed
  changelog_entry: z.string(),         // single markdown line for CHANGELOG
});

export type DocumenterOutput = z.infer<typeof DocumenterOutputSchema>;
```

---

## 9. Environment Variables

All validated at startup via Zod. Missing required vars cause an immediate process exit with a
clear error message.

```
# GitHub App
GITHUB_APP_ID             # integer
GITHUB_PRIVATE_KEY        # base64-encoded PEM, or absolute path to .pem file
GITHUB_WEBHOOK_SECRET     # HMAC secret configured in GitHub App settings
GITHUB_INSTALLATION_ID    # installation ID for the single target repo
GITHUB_REPO_OWNER         # e.g. "myorg"
GITHUB_REPO_NAME          # e.g. "myrepo"
BOT_GITHUB_LOGIN          # e.g. "glima[bot]"

# LLM
LLM_PROVIDER              # "anthropic" | "openai"
LLM_API_KEY
LLM_MODEL_SCOUT           # e.g. "claude-sonnet-4-6"
LLM_MODEL_FIXER           # e.g. "claude-sonnet-4-6"
LLM_MODEL_REVIEWER        # e.g. "claude-opus-4-6"
LLM_MODEL_DOCUMENTER      # e.g. "claude-sonnet-4-6"

# Behaviour
SCOUT_CRON                # cron expression, default "0 2 * * *"
MAX_FIX_ITERATIONS        # integer, default 3
QODO_BOT_USERNAME         # e.g. "qodo-merge[bot]"
LLM_TOKEN_BUDGET_SCOUT    # integer tokens, default 80000
PORT                      # default 3000
```

`GITHUB_PRIVATE_KEY` detection: if the value starts with `-----BEGIN`, treat as a raw PEM
string. Otherwise treat as a file path and read it.

---

## 10. Key Implementation Notes

### 10.1 Scout Issue Deduplication

Two-layer check before filing any issue:

1. **Title similarity** — fetch all open `glima:scout` issues; normalise titles (lowercase,
   strip punctuation); skip if Levenshtein distance ratio < 0.15.
2. **Body fingerprint** — derive a hash from `file_paths + category`. Store it in the issue
   body as `<!-- glima-fingerprint: {hash} -->`. Collect all existing fingerprints from open
   issues before each Scout run; skip any matching hash. The fingerprint must be stable across
   runs (no timestamps, no commit SHAs).

### 10.2 Qodo Comment Timing

Qodo posts its review comments asynchronously. On `pull_request.opened` or
`pull_request.synchronize`, Glima polls for Qodo comments every 15 seconds, up to 90 seconds.
If Qodo comments arrive within the window, they are fed into the Reviewer LLM context. If the
window expires, the Reviewer proceeds without them and notes: *"No Qodo review was available
at review time."* The 90-second wait is non-blocking inside the pipeline job.

### 10.3 Concurrency Control

An in-process `withLock(key: string, fn: () => Promise<T>)` utility backed by a `Map<string,
Promise>`:

- **Fix lock** — key `fix:issue:{N}`. Prevents double-fix from `issues.opened` +
  `issues.labeled` firing simultaneously for the same issue.
- **Review lock** — key `review:pr:{N}`. Prevents a new review run from starting while the
  previous one is still in its Qodo polling window.

If the lock is held, the incoming job bails (does not queue). At most one job per lock key
runs at any time. This is safe because Glima is a single-process, single-repo service.

### 10.4 Bot Loop Prevention

| Layer | Event | Rule |
|---|---|---|
| `webhooks.ts` | `push` | Drop if `sender.login === BOT_GITHUB_LOGIN` |
| `review.pipeline.ts` | `pull_request.*` | Handle all PRs regardless of author. `pull_request.synchronize` fired by Glima pushing to a PR branch still triggers re-review because the check is on `pull_request.user.login` (the PR author), not `sender.login`. |
| `fix.pipeline.ts` | `issues.*` | Do NOT block on `sender === BOT_GITHUB_LOGIN` — Scout creates issues as the bot, so fix MUST trigger. Check for existing PR instead. |

### 10.5 Iteration Count

Iteration ceiling is enforced by counting commits on the PR branch whose message starts with
`glima: apply review`. This excludes the initial fix commit. Check runs at the start of
`review.pipeline.ts` before any LLM call.

```
git log origin/{defaultBranch}..HEAD --oneline --author="{BOT_GITHUB_LOGIN}"
  | grep "^.* glima: apply review"
  | wc -l
```

If `count >= MAX_FIX_ITERATIONS`: close the PR, add label `glima:halted` to the issue, post
a human-escalation comment, exit.

### 10.6 Workspace Isolation

`withWorkspace(fn)` in `src/workspace/manager.ts`:

1. Generate `uuid4()` → clone path `/workspace/{REPO_NAME}_{uuid}/`
2. Clone with authenticated remote URL:
   `https://x-access-token:{installationToken}@github.com/{owner}/{repo}.git`
3. Set local git config: `user.name = "glima[bot]"`,
   `user.email = "glima[bot]@users.noreply.github.com"`
4. Pass workspace path to `fn`
5. Always `rm -rf workspacePath` in a `finally` block

Installation tokens are fetched fresh per workspace invocation (they expire in 1 hour; a
clone + push completes well within that).

### 10.7 Scout Token Budget

Before sending file contents to the Scout LLM, rank files by:

1. Modified recently (`git log --since=30.days --name-only`)
2. Small size (< 200 lines preferred)
3. Not binary, not in `.gitignore`

Include file tree listing first (paths only, always included). Then fill file contents up to
`LLM_TOKEN_BUDGET_SCOUT` characters / 4 (approximate token count). Prioritise by category
relevance: for security scans prefer auth/middleware files; for test gaps prefer `*.test.*`
and `*.spec.*` adjacents.

### 10.8 PR Body Template

```markdown
Closes #{issue-number}

## Summary
{FixerOutput.explanation}

## Changes
{list of FixerOutput.changes paths and operations}

## Documentation
{DocumenterOutput.changelog_entry}

---
*This PR was opened automatically by Glima. Do not merge until you have reviewed the changes.*
```

### 10.9 PM2 Configuration

`pm2.config.cjs` must set `instances: 1` — the in-process lock model requires a single
process. Configure `autorestart: true`, `watch: false`, `max_memory_restart: "512M"`, and
direct logs to `logs/error.log` and `logs/out.log`.

---

## 11. Verification Plan

### Unit Tests

| Module | What to test |
|---|---|
| `config.ts` | Rejects missing vars; accepts base64 PEM; accepts file path PEM |
| `llm/schemas/*.schema.ts` | `.parse()` on valid + invalid shapes |
| `llm/anthropic.ts` / `openai.ts` | Mock SDK; verify message format, system message extraction, JSON mode flag |
| `llm/factory.ts` | Returns correct class per `LLM_PROVIDER` |
| `workspace/manager.ts` | `rm -rf` called in `finally` even when `fn` throws |
| `util/concurrency.ts` | Same-key calls: second bails; different keys run in parallel |
| `agents/scout.ts` | Deduplication: mock existing issues; verify new issues filed, duplicates skipped |

### Integration Tests (mock GitHub API via `nock` or `msw`)

| Scenario | Assertion |
|---|---|
| Scout finds issues | Issues created with correct labels + fingerprint HTML comment |
| Scout finds nothing | `glima:done` issue created; second run with same HEAD SHA skips |
| Fix triggered | Branch `glima/fix-N` created, PR opened, links issue |
| Review: APPROVE | Approval review posted, no further commits |
| Review: REQUEST_CHANGES → APPROVE | Second commit pushed, re-review fires, approves |
| Review: hits `MAX_FIX_ITERATIONS` | PR closed, issue labelled `glima:halted`, comment posted |
| Duplicate webhook (opened + labeled) | Fix runs exactly once |
| Qodo arrives at 60s | Review context includes Qodo comments |
| Qodo never arrives | Review proceeds after 90s without Qodo comments |

### End-to-End Smoke Test (real GitHub, private test repo)

1. Create a private test repo with intentional defects: a known bug, a missing input
   validation, an undocumented export.
2. Install the Glima GitHub App on the repo.
3. Run `npx ts-node src/scripts/trigger-scout.ts` to invoke Scout directly.
4. Verify: issues filed with `glima:scout`, fingerprint comment present, correct categories.
5. Verify: PRs opened on `glima/fix-*` branches within seconds of issue creation.
6. Verify: PR bodies link to issues; documentation section populated.
7. Verify: Reviewer posts a review within ~120s (accounting for Qodo wait).
8. Verify halt: set `MAX_FIX_ITERATIONS=1`; confirm PR is closed and issue labelled
   `glima:halted` after one review cycle.
9. Re-run Scout after all issues are closed; verify `glima:done` issue filed and subsequent
   run with unchanged HEAD SHA skips entirely.
