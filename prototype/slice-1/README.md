# PROTOTYPE: slice 1 (throwaway, do not build on this)

**Question:** Given only the Page Snapshot (Playwright's accessibility tree as text), can Jev
pick the right element for each Action and judge each Expectation confidently enough
(pass ≥ 0.9, fail ≤ 0.1) to run Test Cases end to end? And is a JSONL Journal on its own
enough to build the report?

Scope, as agreed: one vertical slice. `do:` + `expect:` only, Jev only (no Escalation,
no `expect-visual:`), local Docker + Playwright, JSONL Journal, minimal HTML report.
No Setup / `requires:`, no GitHub Acceptance Criteria, no calibration.

## Run

```sh
export TYPESAFE_API_KEY=...
pnpm proto:slice-1          # from the repo root
```

Builds `mcr.microsoft.com/playwright:v1.63.0-noble`, serves `demo-app/` inside the
container on `localhost:4173`, runs every Test Case in `qa/`, prints each Step's Verdict
and probability, then writes `runs/<run>/journal.jsonl`, `shots/` and `report.html`.

## What's in it

- `run.ts`: parse Test Cases → Playwright acts → Jev judges → Journal. Action kind comes
  from the leading verb (Jev Choice only if no verb matches); the target is a Jev Choice
  over interactive elements parsed from the same Page Snapshot; Literals and Variables
  are resolved by code, and Literals are stripped from what Jev reads. Expectations are
  one Noul; when not Passed, re-judged on each snapshot change until 5 s.
- `report.ts`: reads only `journal.jsonl`.
- `qa/`: three Test Cases against the demo app: one should pass, one checks an
  error message, one should fail (`export-pdf`, the app has no such button).

## Verdict

**Yes, the approach works.** Live run 2026-10-08 (`jev-1.13.0`) gave the Verdicts we expected:
sign-in Passed, wrong-password Passed, export-pdf Failed at the right Step (p=0.02).

- **Action targets:** all 9 picks correct, p ≥ 0.99, including the short "click sign in".
- **Expectations:** clear calls (0.98–0.99 or 0.02). 19 judgments, 150–480 ms each,
  ~420–550 input tokens each, ~9k tokens for the whole Run.
- **Settling alone is not enough.** "Network idle + snapshot unchanged 300 ms" returned
  before the app's 600 ms client-side delay, so 3 Expectations were first judged against
  the old page (p 0.02–0.27) and only Passed on the re-judge after the page changed.
  The re-judge-on-change loop (design.md #8) carries the load. Risk: an Expectation that
  is *also true of the old page* (e.g. "no invoices are shown") can Pass before the
  Action takes effect.
- **Negative statements score lower.** "no invoices are shown" got 0.91, just over the
  0.9 pass threshold, while positive statements got 0.98–0.99.
- **The Journal is enough.** `report.ts` builds the report from `journal.jsonl` alone.

Not tested here: Escalation, `expect-visual:`, Setup, a large real-app snapshot (Jev
accuracy drops as state grows), ambiguous targets (several similar buttons).
