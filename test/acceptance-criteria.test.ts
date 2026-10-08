import { describe, expect, it } from "vitest";
import { evaluateCriteria, parseAcceptanceCriteria, readCoveredIssues, type IssueReader } from "../src/acceptance-criteria.ts";
import { parseTestCase } from "../src/test-case.ts";
import { memoryJournal } from "./helpers.ts";

const ISSUE_BODY = `## What to build

- [ ] [not-a-criterion] a checklist item outside the section

## Acceptance criteria

- [ ] [read-criteria] Tagged checklist items are read
- [x] [criterion-status] Each one is Met, Unmet or Unverified
- [ ] An item someone forgot to tag
Some prose between items.
  - [ ] [nested] indented items count too

### Notes
- [ ] [after-section] not a criterion either
`;

describe("parseAcceptanceCriteria", () => {
  it("reads the checklist items under the Acceptance criteria heading, tagged or not", () => {
    expect(parseAcceptanceCriteria(ISSUE_BODY)).toEqual([
      { tag: "read-criteria", text: "Tagged checklist items are read" },
      { tag: "criterion-status", text: "Each one is Met, Unmet or Unverified" },
      { tag: undefined, text: "An item someone forgot to tag" },
      { tag: "nested", text: "indented items count too" },
    ]);
  });

  it("finds nothing when the issue has no Acceptance criteria section", () => {
    expect(parseAcceptanceCriteria("## What to build\n- [ ] [x] item\n")).toEqual([]);
  });
});

const ts = "2026-10-08T10:00:00.000Z";
const issue7 = {
  ts, event: "issue.read", issue: 7, repo: "acme/billing", title: "Invoices", url: "https://github.com/acme/billing/issues/7",
  body: `## Acceptance criteria
- [ ] [list] Invoices are listed
- [ ] [export] Invoices export as PDF
- [ ] [filter] Invoices filter by customer
- [ ] [paging] Invoices page by 50
- [ ] Totals look right`,
};
const ran = (file: string, covers: string[], verdict?: string) => [
  { ts, event: "case.started", file, covers },
  ...(verdict ? [{ ts, event: "case.verdict", file, verdict }] : []),
];

describe("evaluateCriteria", () => {
  const { criteria, problems } = evaluateCriteria([
    issue7,
    ...ran("list.md", ["#7/list"], "Passed"),
    ...ran("list-again.md", ["#7/list", "#7/export"], "Passed"),
    ...ran("export.md", ["#7/export"], "Failed"),
    ...ran("filter.md", ["#7/filter"], "Needs Review"),
    { ts, event: "case.skipped", file: "filter-2.md", covers: ["#7/filter"] },
    { ts, event: "case.verdict", file: "filter-2.md", verdict: "Skipped" },
    ...ran("crashed.md", ["#7/list"]),
  ]);
  const status = Object.fromEntries(criteria.map((c) => [c.tag ?? c.text, c.status]));

  it("is Met only when every covering Test Case Passed", () => {
    expect(status["list"]).toBe("Unverified"); // crashed.md has no Verdict
    expect(evaluateCriteria([issue7, ...ran("list.md", ["#7/list"], "Passed")]).criteria[0])
      .toMatchObject({ issue: 7, tag: "list", status: "Met", coveredBy: [{ file: "list.md", verdict: "Passed" }] });
  });

  it("is Unmet when any covering Test Case Failed", () => {
    expect(status["export"]).toBe("Unmet");
  });

  it("is otherwise Unverified, including with no Coverage", () => {
    expect(status["filter"]).toBe("Unverified");
    expect(status["paging"]).toBe("Unverified");
    expect(criteria.find((c) => c.tag === "paging")!.coveredBy).toEqual([]);
  });

  it("reports an untagged item as Unverified with a needs-tag warning", () => {
    expect(criteria.at(-1)).toMatchObject({ tag: undefined, text: "Totals look right", status: "Unverified", warning: "needs tag" });
    expect(problems).toEqual([]);
  });

  it("reports covers: entries that point at nothing", () => {
    const result = evaluateCriteria([
      issue7,
      { ts, event: "issue.unreadable", issue: 9, repo: "acme/billing", error: "404 Not Found" },
      ...ran("x.md", ["#7/nope", "export-pdf", "#9/login"], "Passed"),
    ]);
    expect(result.problems).toEqual([
      { file: "x.md", cover: "#7/nope", problem: "#7 has no Acceptance Criterion tagged [nope]" },
      { file: "x.md", cover: "export-pdf", problem: "not an Acceptance Criterion ID like #123/tag" },
    ]);
    expect(result.criteria.find((c) => c.issue === 9)).toMatchObject({
      tag: "login", status: "Unverified", warning: "could not read #9: 404 Not Found", coveredBy: [{ file: "x.md", verdict: "Passed" }],
    });
  });
});

describe("readCoveredIssues", () => {
  const covering = (file: string, covers: string) => parseTestCase(file, `---\ncovers: ${covers}\n---\n# ${file}\n`);

  it("reads each covered issue once into the Journal, and records the ones it could not read", async () => {
    const asked: number[] = [];
    const reader: IssueReader = {
      repo: "acme/billing",
      async read(issue) {
        asked.push(issue);
        if (issue === 9) throw new Error("404 Not Found");
        return { title: `Issue ${issue}`, body: "## Acceptance criteria\n- [ ] [a] A", url: `https://github.com/acme/billing/issues/${issue}` };
      },
    };
    const journal = memoryJournal();
    await readCoveredIssues([covering("a.md", '["#7/a", "#9/b", "oops"]'), covering("b.md", '["#7/c"]')], reader, journal);

    expect(asked).toEqual([7, 9]);
    expect(journal.events).toMatchObject([
      { event: "issue.read", repo: "acme/billing", issue: 7, title: "Issue 7", body: "## Acceptance criteria\n- [ ] [a] A" },
      { event: "issue.unreadable", repo: "acme/billing", issue: 9, error: "404 Not Found" },
    ]);
  });
});
