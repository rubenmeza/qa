# qa

Runs plain-language Test Cases against a web app and reports a Verdict per Step.
Playwright acts in Docker; Jev judges each Step from the Page Snapshot.
Vocabulary: [GLOSSARY.md](GLOSSARY.md). Design: [docs/design.md](docs/design.md).

## Run

```sh
export TYPESAFE_API_KEY=...
pnpm qa:docker path/to/app/qa     # builds the image, runs every *.md Test Case
```

The container shares the host network, so Test Cases can open `http://localhost:…`.
Each Run writes `qa-runs/<run id>/` next to the folder: `journal.jsonl`, `shots/` and
`report.html`. Exit code 0 means every Test Case Passed.

Try it on the example app:

```sh
python3 -m http.server 4173 -d examples/billing/app &
pnpm qa:docker examples/billing/qa
```

## Test Cases

```markdown
---
covers: ["#1/sign-in"]
---
# Sign in with valid credentials

- do: open "http://localhost:4173/"
- do: type "{{email}}" into the email field
- do: click the sign in button
- expect: the user is greeted by name
```

- Each Step is `do:` (an Action) or `expect:` (an Expectation).
- Actions: open, click, type, select, press, wait for. The first word decides.
- `"quoted"` Literals are used verbatim. `{{variables}}` come from `test-data.json`
  in the folder or an env file (`QA_ENV_FILE=.env.qa`). Their values are replaced by
  `{{name}}` before anything reaches Jev or the Journal.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm test:docker    # tests need Chromium; the Playwright image has it
pnpm test           # works too if `pnpm exec playwright install chromium` succeeded
```

`test/jev.live.test.ts` calls the real Jev API and only runs with `TYPESAFE_API_KEY` set.
