import type { JournalEvent } from "./journal.ts";
import type { Verdict } from "./run-test-case.ts";
import { stepRef } from "./test-case.ts";

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const COLOR: Record<Verdict, string> = { Passed: "#1a7f37", Failed: "#cf222e", "Needs Review": "#9a6700", Skipped: "#6e7781" };
/** Why a Test Case was Skipped, from its `case.verdict` event. */
export const skipReason = (e: { failedSetup?: unknown; failedSetupVerdict?: unknown }) =>
  `Setup ${e.failedSetup} ${e.failedSetupVerdict}`;

const badge = (verdict?: Verdict) =>
  verdict ? `<b style="color:${COLOR[verdict]}">${esc(verdict)}</b>` : `<span style="color:#6e7781">not attempted</span>`;

type StepDef = { n: number; kind: string; text: string };

/** A static HTML report built from the Journal alone. */
export function buildReport(journal: JournalEvent[]): string {
  // The Journal is read back as plain JSON; fields are as the Run wrote them.
  const events = journal as Array<Record<string, any>>;
  const eventsNamed = (name: string) => events.filter((e) => e.event === name);
  const run = eventsNamed("run.started")[0] ?? {};

  // Test Cases in Journal order: the ones that ran, and the ones Skipped because of their Setup.
  const cases = events.filter((e) => e.event === "case.started" || e.event === "case.skipped").map((c) => {
    const caseVerdict = eventsNamed("case.verdict").find((e) => e.file === c.file);
    const verdict = caseVerdict?.verdict;
    const skippedBecause = verdict === "Skipped" ? `<p>Skipped: ${esc(skipReason(caseVerdict!))}</p>` : "";
    const startsFrom = c.requires?.length ? ` · starts from ${esc(c.requires.join(", "))}` : "";
    const rows = (c.steps as StepDef[]).map((s) => {
      const ref = stepRef(c.file, s.n);
      const v = eventsNamed("step.verdict").find((e) => e.step === ref);
      const judgments = eventsNamed("judgment").filter((e) => e.step === ref);
      const snapshot: string | undefined = v?.evidence?.pageSnapshot;
      const shot: string | undefined = v?.evidence?.screenshot;
      return `<tr>
  <td>${s.n}</td>
  <td><code>${esc(s.kind)}:</code> ${esc(s.text)}</td>
  <td>${badge(v?.verdict)}<br><small>${esc(v?.why ?? "")}</small></td>
  <td><small>${judgments.map((j) => `${esc(j.purpose)} · ${esc(j.model)} · ${j.ms} ms<br><code>${esc(JSON.stringify(j.response?.answers ?? j.response))}</code>`).join("<hr>")}</small>
    ${snapshot ? `<details><summary>Page Snapshot</summary><pre>${esc(snapshot)}</pre></details>` : ""}</td>
  <td>${shot ? `<a href="${esc(shot)}"><img src="${esc(shot)}" width="240" alt="Step ${s.n}"></a>` : ""}</td>
</tr>`;
    }).join("\n");
    const covers = (c.covers as string[]).join(", ") || "nothing";
    return `<section>
<h2>${badge(verdict)} ${esc(c.title)}</h2>
<p><small>${esc(c.file)} · covers ${esc(covers)}${startsFrom}</small></p>
${skippedBecause}
<table><tr><th>#</th><th>Step</th><th>Verdict</th><th>Judgments</th><th>Evidence</th></tr>
${rows}
</table>
</section>`;
  }).join("\n");

  const t = run.thresholds;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>QA Run ${esc(run.runId ?? "")}</title>
<style>
body{font:14px system-ui;margin:2rem;max-width:1200px}
table{border-collapse:collapse;width:100%}
td,th{border-top:1px solid #d0d7de;padding:.4rem;vertical-align:top;text-align:left}
pre{white-space:pre-wrap;font-size:11px;max-height:300px;overflow:auto;background:#f6f8fa}
code{font-size:11px}
</style></head><body>
<h1>Run ${esc(run.runId ?? "")}</h1>
<p>${eventsNamed("judgment").length} judgments${t ? ` · pass ≥ ${t.pass}, fail ≤ ${t.fail}` : ""}</p>
${cases}
</body></html>
`;
}
