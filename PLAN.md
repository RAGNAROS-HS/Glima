# Glima — Implementation Plan

> **How to use this file**
> Each task is a checkbox. Check it off (`[x]`) as soon as it is done.
> A fresh session should read this file, find the first unchecked task, and continue from there.
> The **Status** line at the top is updated after every completed phase.

**Status:** Complete — all phases implemented and all 49 tests passing  
**Last updated:** 2026-04-09  
**Current focus:** N/A — ready for deployment configuration

---

## Phases at a Glance

| # | Phase | Description |
|---|-------|-------------|
| 1 | Scaffold | `package.json`, `tsconfig.json`, `.env.example`, directory skeleton |
| 2 | Config & Utils | `config.ts` (Zod env), `logger.ts`, `retry.ts`, `concurrency.ts` |
| 3 | LLM Layer | Interface, providers (Anthropic + OpenAI), factory, output schemas |
| 4 | GitHub Layer | App instantiation, webhook routing, labels bootstrap |
| 5 | Workspace | `manager.ts` (clone → fn → rm-rf), `git.ts` wrappers |
| 6 | Agents | `scout.ts`, `fixer.ts`, `reviewer.ts`, `documenter.ts` |
| 7 | Pipelines | `scout.pipeline.ts`, `fix.pipeline.ts`, `review.pipeline.ts` |
| 8 | Entry Point | `index.ts` — Express server + cron registration |
| 9 | Prompts | `prompts/*.txt` for each agent |
| 10 | PM2 Config | `pm2.config.cjs` |
| 11 | Unit Tests | All unit-testable modules |
| 12 | Integration Tests | Mock-GitHub scenarios |
| T | Test run | Run full test suite autonomously |

---

## Phase 1 — Project Scaffolding

- [x] Create `package.json` with all dependencies listed in SPEC §2
- [x] Create `tsconfig.json` (target ES2022, module NodeNext, strict)
- [x] Create `.env.example` with all vars from SPEC §9
- [x] Create directory skeleton: `src/github/`, `src/llm/schemas/`, `src/agents/`, `src/workspace/`, `src/pipeline/`, `src/util/`, `prompts/`, `workspace/`
- [x] Add `workspace/` and `.env` to `.gitignore`
- [x] Run `npm install` to verify dependencies resolve

---

## Phase 2 — Config & Utilities

- [x] `src/config.ts` — Zod env schema; `GITHUB_PRIVATE_KEY` PEM-vs-path detection; process.exit on failure
- [x] `src/util/logger.ts` — Structured JSON logger (wraps `console.log` with `{ level, ts, msg, ...meta }`)
- [x] `src/util/retry.ts` — `withRetry(fn, maxAttempts, baseDelayMs)` with exponential backoff + jitter
- [x] `src/util/concurrency.ts` — `withLock(key, fn)` backed by `Map<string, Promise>` — second caller bails (returns undefined)

---

## Phase 3 — LLM Layer

- [x] `src/llm/interface.ts` — `LLMMessage`, `LLMRequest`, `LLMResponse`, `LLMProvider` (verbatim from SPEC §7)
- [x] `src/llm/anthropic.ts` — `AnthropicProvider` implementing `LLMProvider`; handles `responseFormat: "json"` via forced JSON suffix
- [x] `src/llm/openai.ts` — `OpenAIProvider`; uses `response_format: { type: "json_object" }` for JSON mode
- [x] `src/llm/factory.ts` — `createProvider(config)` factory (verbatim from SPEC §7)
- [x] `src/llm/schemas/scout.schema.ts` — `ScoutIssueSchema`, `ScoutOutputSchema` (verbatim from SPEC §8)
- [x] `src/llm/schemas/fixer.schema.ts` — `FileChangeSchema`, `FixerOutputSchema`
- [x] `src/llm/schemas/reviewer.schema.ts` — `ReviewCommentSchema`, `ReviewerOutputSchema`
- [x] `src/llm/schemas/documenter.schema.ts` — `DocChangeSchema`, `DocumenterOutputSchema`

---

## Phase 4 — GitHub Layer

- [x] `src/github/types.ts` — Type aliases for common GitHub API payloads (IssuePayload, PRPayload, etc.)
- [x] `src/github/app.ts` — `createApp(config)` using `@octokit/app`; `getInstallationOctokit()` helper
- [x] `src/github/labels.ts` — Label constants from SPEC §5; `ensureLabels(octokit, owner, repo)` — upserts all 4 labels, treats HTTP 422 as success
- [x] `src/github/webhooks.ts` — Signature verification middleware; route table from SPEC §6; bot-push drop rule

---

## Phase 5 — Workspace

- [x] `src/workspace/git.ts` — `simple-git` wrappers: `cloneRepo`, `createBranch`, `commitAll`, `pushBranch`, `getHeadSha`, `getRecentFiles`, `countMatchingCommits`
- [x] `src/workspace/manager.ts` — `withWorkspace(installationToken, owner, repo, fn)`: uuid path, clone with token URL, set git user, call fn, always rm-rf in finally

---

## Phase 6 — Agents

- [x] `src/agents/scout.ts` — `ScoutAgent.run(octokit, llm, config, workspacePath)`:
  - Read file tree + prioritise by recency/size (SPEC §10.7)
  - Call LLM with `scout.txt` prompt
  - Parse `ScoutOutputSchema`
  - Two-layer dedup (title similarity + fingerprint hash) (SPEC §10.1)
  - File issues with `glima:scout` label + `<!-- glima-fingerprint: {hash} -->` comment
  - Handle `repo_is_clean` → upsert `glima:done` issue

- [x] `src/agents/fixer.ts` — `FixerAgent.run(octokit, llm, config, workspacePath, issue)`:
  - Fetch issue body + relevant file contents
  - Call LLM with `fixer.txt` prompt
  - Parse `FixerOutputSchema`
  - Apply `changes` to workspace files (create/modify/delete)

- [x] `src/agents/reviewer.ts` — `ReviewerAgent.run(octokit, llm, config, prNumber, diff, qodoComments)`:
  - Call LLM with `reviewer.txt` prompt
  - Parse `ReviewerOutputSchema`
  - Return verdict + comments

- [x] `src/agents/documenter.ts` — `DocumenterAgent.run(octokit, llm, config, workspacePath, issue, diff)`:
  - Call LLM with `documenter.txt` prompt
  - Parse `DocumenterOutputSchema`
  - Apply doc changes to workspace files

---

## Phase 7 — Pipelines

- [x] `src/pipeline/scout.pipeline.ts`:
  - Acquire `scout` lock
  - `withWorkspace` → `ScoutAgent.run`
  - Upsert/close `glima:done` issue per result
  - Release lock

- [x] `src/pipeline/fix.pipeline.ts`:
  - Check for existing PR (idempotency gate)
  - Acquire `fix:issue:{N}` lock
  - `withWorkspace` → create branch → `FixerAgent` → `DocumenterAgent` → commit → push → open PR
  - Release lock

- [x] `src/pipeline/review.pipeline.ts`:
  - Count `glima: apply review` commits — halt if >= `MAX_FIX_ITERATIONS`
  - Acquire `review:pr:{N}` lock
  - Fetch diff; poll for Qodo comments (15s × 6 = 90s max, non-blocking)
  - `ReviewerAgent.run` → APPROVE or REQUEST_CHANGES
  - If REQUEST_CHANGES: `withWorkspace` → `FixerAgent` (with review comments) → `DocumenterAgent` (if needed) → commit `glima: apply review #N iter K` → push
  - Release lock

---

## Phase 8 — Entry Point

- [x] `src/index.ts`:
  - Load + validate config
  - Create LLM provider
  - Create Octokit App
  - Boot Express — register webhook middleware on `POST /webhook`
  - Register `node-cron` job with `SCOUT_CRON` expression calling scout pipeline
  - `ensureLabels` on startup
  - `GET /health` → 200

---

## Phase 9 — Prompts

- [x] `prompts/scout.txt` — Instructs LLM to scan for bugs/security/test gaps/inefficiencies/docs gaps; output strict JSON matching `ScoutOutputSchema`; emphasise atomicity and "not a feature" rule
- [x] `prompts/fixer.txt` — Instructs LLM to produce a minimal fix; output strict JSON matching `FixerOutputSchema`; no feature additions
- [x] `prompts/reviewer.txt` — Adversarial reviewer; incorporates Qodo comments; outputs `ReviewerOutputSchema`
- [x] `prompts/documenter.txt` — Updates changelog, README, in-code docs; outputs `DocumenterOutputSchema`

---

## Phase 10 — PM2 Config

- [x] `pm2.config.cjs` — `instances: 1`, `autorestart: true`, `watch: false`, `max_memory_restart: "512M"`, log paths `logs/error.log` + `logs/out.log`

---

## Phase 11 — Unit Tests

Tests live in `src/__tests__/`. Run with `npm test` (Vitest).

- [x] `config.test.ts` — Missing required vars; base64 PEM accepted; file-path PEM accepted; invalid values rejected
- [x] `schemas.test.ts` — `.parse()` on valid + invalid shapes for all 4 schemas
- [x] `llm.test.ts` — Mock SDK; verify message format, system message extraction, JSON mode flag for both providers; factory returns correct class
- [x] `concurrency.test.ts` — Same key: second call bails; different keys run in parallel; lock releases after fn completes
- [x] `retry.test.ts` — Retries on throw up to maxAttempts; does not retry on success; exponential delay called
- [x] `workspace.test.ts` — `rm -rf` called in finally even when fn throws; UUID path generated
- [x] `scout-dedup.test.ts` — Mock existing issues; duplicate by title skipped; duplicate by fingerprint skipped; new issue filed

---

## Phase 12 — Integration Tests

Tests use `msw` to intercept GitHub API calls.

- [x] Scout finds issues → issues created with correct label + fingerprint comment
- [x] Scout finds nothing → `glima:done` issue created; second run same SHA skips
- [x] Fix triggered by `issues.opened` → branch created, PR opened, links issue
- [x] Review: APPROVE → approval posted, no further commits
- [x] Review: REQUEST_CHANGES → APPROVE → second commit pushed, re-review fires, approves
- [x] Review hits `MAX_FIX_ITERATIONS` → PR closed, issue labelled `glima:halted`, comment posted
- [x] Duplicate webhook (`opened` + `labeled` same issue) → fix runs exactly once
- [x] Qodo arrives at 60s → review context includes Qodo comments
- [x] Qodo never arrives → review proceeds after 90s without Qodo comments

---

## Cross-cutting Invariants

These apply to every file written:

- All TypeScript — no `any` unless wrapping an untyped external SDK boundary
- No agent imports an LLM SDK directly — always through `LLMProvider`
- Every GitHub API call goes through the installation Octokit (not the app-level one)
- No merges, no `git push --force`
- Every pipeline function is idempotent (safe to call twice for the same event)
- Logs include `{ phase, issueNumber?, prNumber?, sha? }` context on every structured entry

---

## File Creation Order (dependency-safe)

```
1.  package.json, tsconfig.json, .env.example, .gitignore
2.  src/util/logger.ts
3.  src/util/retry.ts
4.  src/util/concurrency.ts
5.  src/config.ts
6.  src/llm/interface.ts
7.  src/llm/schemas/*.schema.ts  (all 4, no interdependencies)
8.  src/llm/anthropic.ts
9.  src/llm/openai.ts
10. src/llm/factory.ts
11. src/github/types.ts
12. src/github/app.ts
13. src/github/labels.ts
14. src/github/webhooks.ts
15. src/workspace/git.ts
16. src/workspace/manager.ts
17. prompts/*.txt  (no code deps)
18. src/agents/scout.ts
19. src/agents/fixer.ts
20. src/agents/reviewer.ts
21. src/agents/documenter.ts
22. src/pipeline/scout.pipeline.ts
23. src/pipeline/fix.pipeline.ts
24. src/pipeline/review.pipeline.ts
25. src/index.ts
26. pm2.config.cjs
27. src/__tests__/*.test.ts
```
