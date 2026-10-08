# Design decisions

Settled in a grilling session on 2026-10-07. Vocabulary is defined in [GLOSSARY.md](../GLOSSARY.md); the two hard-to-reverse choices have ADRs in [docs/adr/](./adr/). Nothing is built yet.

## Goal

Replace manual QA of the user's web apps: plain-language Test Cases run against an Application Under Test, each Step judged by a decision model, results rolled up into which Acceptance Criteria are Met, Unmet or Unverified. Inspired by [ThePrimeagen/Oligarchy](https://github.com/ThePrimeagen/Oligarchy) (QEMU + agents testing the Omarchy desktop), adapted to web apps.

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Input | Test Cases written in plain language by the user |
| 2 | Step format | Tagged lines; each line is exactly one of `do:`, `expect:`, `expect-visual:` |
| 3 | Values | Literals in `"quotes"`; secrets and fixtures as `{{variables}}` resolved from Test Data (env / data file). Code extracts values; models never generate them |
| 4 | Judging | Jev on the Page Snapshot (accessibility tree as text) for Actions and Expectations; `gpt-6-luna-decisions` via OpenRouter's alpha Decisions API on a screenshot for Visual Expectations. See ADR 0001 |
| 5 | Actions | Core 6: open URL, click, type, select option, press key, wait-for-text. Code takes the kind from the leading verb; Jev Choice only when ambiguous. Jev Choice picks the target element from Page Snapshot candidates |
| 6 | Uncertainty | Verdicts Passed / Failed / Needs Review / Skipped. Below threshold → Escalation to a slow reasoning LLM (OpenRouter, typed tool call, sees snapshot + screenshot + Step) → still unsure or refused → Needs Review; the Test Case halts and Evidence is kept |
| 7 | Calibration | Start conservative (e.g. pass ≥ 0.9, fail ≤ 0.1). Every Review is saved with the model probabilities to `qa/.labels.jsonl`; `qa calibrate` suggests thresholds from them |
| 8 | Timing | After an Action, wait for the page to settle (network idle + snapshot unchanged ~300 ms), judge; if not Passed, re-snapshot and re-judge on change until timeout (5 s default, per-Step override) |
| 9 | Isolation | Docker, official `mcr.microsoft.com/playwright` image, headless Chromium, fresh browser context per Test Case. Browser extension rejected (shares the real profile, MV3 limits, no CI); QEMU only makes sense for whole-OS testing |
| 10 | Start state | Setup Test Cases run once per Run; their browser session (Playwright storage state) is saved. Test Cases declare `requires:`; a failed Setup makes its dependents Skipped |
| 11 | Shape | CLI (`qa run`) + static HTML report (step replay, Evidence, Needs Review queue, Acceptance Criteria table). Journal written as JSONL + screenshots, designed so an Oligarchy-style queue / worker fleet / dashboard can read it later |
| 12 | Files | Test Cases are Markdown in each app's repo under `qa/`: `# Title`, front-matter (`requires:`, `covers:`), then `- do: …` / `- expect: …` lines. The tool is a separate package / image pointed at that folder |
| 13 | Acceptance Criteria | Read from GitHub issues: tagged checklist items under `## Acceptance criteria`, ID `#123/export-pdf`. See ADR 0002 |
| 14 | Write-back | Read-only by default; `qa run --publish` posts / updates one results comment per issue. Never ticks checkboxes |
| 15 | App data | The app owns its data; optional `reset` shell command in config runs before each Run (e.g. `pnpm db:seed`, `docker compose up` a fresh stack) |
| 16 | Stack | TypeScript + pnpm, Playwright, TypeSafe JS SDK, OpenRouter for Luna Decisions and the slow LLM |

## Out of scope for v1

- Exploratory crawling (no Test Case input)
- Generating Test Cases from specs or issues
- Pixel-baseline screenshot diffs
- Queue, worker fleet, live dashboard (seam only, via the Journal)
- Trackers other than GitHub

## Facts gathered (verify before building, they move)

- Jev 1.13 (`jev-1.13.0`, aliases `jev-latest`, `jev-preview`) is text only; endpoint `POST /v1/systemone`. Docs: https://docs.typesafe.ai/llms.txt
- OpenRouter's Decisions API (`/alpha/decisions`) takes the same Noul / Choice / Score shape and accepts images as `image_url` parts in `state`; Oligarchy verified it against `openai/gpt-6-luna-decisions` on 2026-10-07 (`packages/openrouter/README.md`, `packages/decision-api`).
- Oligarchy patterns worth reading before building: `field-guide/drive-harness.md` (journal, layered model decisions, tools as reply contract), `v2/next/4-decision-loop.md` (cheap model first, thresholds `doneAbove` / `notDoneBelow`, band escalates), `packages/drive-harness/src/steps.ts` (ActionList parsing).

## Prototype findings

Slice 1 (`do:` + `expect:`, Jev only, Docker + Playwright, JSONL Journal, HTML report) ran live on 2026-10-08; the code is kept on branch `prototype/slice-1`, see its README.

- Jev on the Page Snapshot works: correct targets at p ≥ 0.99 and clear Expectation probabilities, ~150–480 ms and ~500 tokens per judgment. A report built from the Journal alone is enough.
- Settling (#8) alone does not catch client-side delays; the re-judge-on-change loop is required, not optional. An Expectation also true of the page before the Action can Pass too early: the real build must deal with this, e.g. by waiting for the page to change after an Action.
- Negative Expectations ("no X is shown") score lower (0.91 vs 0.98–0.99). Watch for them when calibrating (#7).

## Next

Break this into GitHub issues (one vertical slice first: one Test Case, `do:` + `expect:` only, Jev only, local report), then implement on explicit request.
