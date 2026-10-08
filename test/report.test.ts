import { describe, expect, it } from "vitest";
import { buildReport } from "../src/report.ts";

const ts = "2026-10-08T10:00:00.000Z";
const events = [
  { ts, event: "run.started", runId: "r1", thresholds: { pass: 0.9, fail: 0.1 } },
  { ts, event: "case.started", file: "qa/export.md", title: "Export invoices", covers: ["#2/export-pdf"],
    steps: [{ n: 1, kind: "expect", text: "an Export PDF button is shown" }, { n: 2, kind: "do", text: "click Export PDF" }] },
  { ts, event: "step.started", step: "qa/export.md#1" },
  { ts, event: "judgment", step: "qa/export.md#1", purpose: "expectation", model: "jev-1.13.0", ms: 180,
    request: {}, response: { answers: { q: { noul: 0.02 } } } },
  { ts, event: "step.verdict", step: "qa/export.md#1", verdict: "Failed", why: "p=0.02",
    evidence: { screenshot: "shots/qa_export_md-1.png", url: "http://localhost/",
      pageSnapshot: '- heading "Invoices <script>alert(1)</script>"' } },
  { ts, event: "case.verdict", file: "qa/export.md", verdict: "Failed" },
  { ts, event: "run.finished", runId: "r1" },
];

describe("buildReport", () => {
  const html = buildReport(events);

  it("shows each Test Case with its Verdict, Coverage and Steps", () => {
    expect(html).toContain("Export invoices");
    expect(html).toContain("#2/export-pdf");
    expect(html).toMatch(/Failed[\s\S]*an Export PDF button is shown[\s\S]*p=0\.02/);
  });

  it("shows Steps after a halt as not attempted", () => {
    expect(html).toMatch(/click Export PDF[\s\S]*not attempted/);
  });

  it("shows each judgment and the Evidence: Page Snapshot and screenshot", () => {
    expect(html).toContain("jev-1.13.0");
    expect(html).toContain("&quot;noul&quot;:0.02");
    expect(html).toContain('<img src="shots/qa_export_md-1.png"');
    expect(html).toContain("Invoices &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)");
  });
});

describe("buildReport with Setups", () => {
  const html = buildReport([
    { ts, event: "run.started", runId: "r2" },
    { ts, event: "case.started", file: "qa/sign-in.md", title: "Sign in", covers: [], requires: [], steps: [] },
    { ts, event: "case.verdict", file: "qa/sign-in.md", verdict: "Failed" },
    { ts, event: "case.skipped", file: "qa/invoices.md", title: "List invoices", covers: ["#3/list"], requires: ["sign-in"],
      steps: [{ n: 1, kind: "expect", text: "invoices are listed" }] },
    { ts, event: "case.verdict", file: "qa/invoices.md", verdict: "Skipped", setup: "sign-in", failedSetup: "sign-in", failedSetupVerdict: "Failed" },
  ]);

  it("shows a Skipped Test Case with its Steps and the Setup that caused it", () => {
    expect(html).toMatch(/Skipped[\s\S]*List invoices/);
    expect(html).toContain("Skipped: Setup sign-in Failed");
    expect(html).toContain("invoices are listed");
  });

  it("shows which Setup a Test Case started from", () => {
    expect(html).toMatch(/List invoices[\s\S]*starts from sign-in/);
  });
});

describe("buildReport with Acceptance Criteria", () => {
  const html = buildReport([
    { ts, event: "run.started", runId: "r3" },
    { ts, event: "issue.read", repo: "acme/billing", issue: 7, title: "Invoices", url: "https://github.com/acme/billing/issues/7",
      body: "## Acceptance criteria\n- [ ] [list] Invoices are listed\n- [ ] Totals look right" },
    { ts, event: "case.started", file: "list.md", title: "List invoices", covers: ["#7/list", "#7/nope"], requires: [], steps: [] },
    { ts, event: "case.verdict", file: "list.md", verdict: "Passed" },
  ]);

  it("has a row per Acceptance Criterion with its status and covering Test Cases", () => {
    expect(html).toMatch(/<a href="https:\/\/github.com\/acme\/billing\/issues\/7">#7\/list<\/a>[\s\S]*Invoices are listed[\s\S]*Met[\s\S]*<a href="#case-list\.md">List invoices<\/a>/);
    expect(html).toContain('id="case-list.md"');
  });

  it("flags untagged items and covers: entries that point at nothing", () => {
    expect(html).toMatch(/Totals look right[\s\S]*Unverified[\s\S]*needs tag/);
    expect(html).toContain("list.md covers #7/nope: #7 has no Acceptance Criterion tagged [nope]");
  });

  it("leaves the table out when no Test Case covers anything", () => {
    expect(buildReport([{ ts, event: "run.started", runId: "r4" }])).not.toContain("Acceptance Criteria");
  });
});
