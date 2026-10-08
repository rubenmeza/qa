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
