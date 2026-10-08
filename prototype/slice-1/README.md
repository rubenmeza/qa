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

_Pending a live run with a real key._
