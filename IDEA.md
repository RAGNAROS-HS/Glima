Coordinating coding agents is horrible and impossible to keep up with. Everything should be done through the regular software dev routes — PRs, issues, reviews, tests. Doing this manually or via actions is crude and doesn't interact well with the agents that fix or test the code.

Introducing Glima — a GitHub app which hooks up to a repository and hardens it. The system is designed to not introduce any new features; rather it bugfixes, tests, documents, simplifies, and secures the existing codebase.

## Pipeline

1. **Scout** — proactively scours the codebase for bugs, security issues, missing tests, inefficiencies, and documentation gaps. Files them as GitHub issues. Each issue must be atomic, reproducible, and clearly not a feature request.

2. **Fix** — picks up a scout-filed issue, implements a minimal fix, and opens a PR. Changes are atomic, minimalist, and easy to understand.

3. **Adversarial Review** — a separate reviewer module scrutinizes the PR for correctness, security issues, regressions, and inefficiencies. Qodo also reviews every PR automatically; Glima must read and incorporate Qodo's comments as part of this stage. The fixer applies changes until both the adversarial reviewer and any Qodo feedback are resolved. This loop has a maximum iteration ceiling — if unresolved, the PR is closed with a note and the issue is flagged for human attention.

4. **Human Merge** — every PR requires explicit human approval before merging. Glima never merges autonomously.

5. **Documentation** — Glima updates the changelog, README, and in-code documentation as part of the PR itself, before merge. In-code docs are written to be AI-readable, so coding agents can easily digest the codebase. This allows the human and Qodo to review docs alongside the code change.

## Stopping condition

Glima stops when no glaring issues remain and only lateral (horizontal) moves are left — changes that trade one reasonable approach for another without a clear quality improvement. Glima identifies this condition itself.

## Explicit non-goals

- **No new features.** This is left entirely to the human engineer. PRs raised by humans that introduce features are not reviewed or touched by Glima.
- **No human PR review.** Glima only reviews its own PRs via the adversarial reviewer. Reviewing human PRs is a separate concern with a different trust model and scope — it belongs in a different tool.

## Principles

- Atomic changes only.
- High scrutiny on testing and review.
- Every change must be traceable to a filed issue.
- The human is always the final gate.
