// PROTOTYPE (slice 1): throwaway. Builds the report from the Journal alone, nothing else,
// to check the Journal is enough (design.md #11).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const runId = process.argv[2] ?? readdirSync("runs").sort().at(-1)!;
const dir = join("runs", runId);
const events = readFileSync(join(dir, "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const COLOR: Record<string, string> = { Passed: "#1a7f37", Failed: "#cf222e", "Needs Review": "#9a6700", "Not run": "#888" };
const badge = (v: string) => `<b style="color:${COLOR[v]}">${esc(v)}</b>`;

const cases = events.filter((e) => e.event === "case.started").map((c) => {
  const verdict = events.find((e) => e.event === "case.verdict" && e.file === c.file)?.verdict ?? "Not run";
  const steps = c.steps.map((s: any) => {
    const ref = `${c.file}#${s.n}`;
    const v = events.find((e) => e.event === "step.verdict" && e.step === ref);
    const judgments = events.filter((e) => e.event === "judgment.answered" && e.step === ref);
    const snaps = events.filter((e) => e.event === "snapshot" && e.step === ref);
    const lastAsk = events.filter((e) => e.event === "judgment.asked" && e.step === ref).at(-1);
    const snap = snaps.at(-1)?.snapshot ?? lastAsk?.state?.page_snapshot;
    return `<tr>
      <td>${s.n}</td><td><code>${s.kind}:</code> ${esc(s.text)}</td>
      <td>${badge(v?.verdict ?? "Not run")}<br><small>${esc(v?.why ?? "")}</small></td>
      <td><small>${judgments.map((j) => `${esc(j.purpose)} ${j.ms}ms<br><code>${esc(JSON.stringify(j.answers))}</code>`).join("<hr>")}</small>
        ${snap ? `<details><summary>Page Snapshot</summary><pre>${esc(snap)}</pre></details>` : ""}</td>
      <td>${v ? `<a href="${esc(v.evidence.screenshot)}"><img src="${esc(v.evidence.screenshot)}" width="200"></a>` : ""}</td>
    </tr>`;
  }).join("");
  return `<section><h2>${badge(verdict)} ${esc(c.title)}</h2>
    <p><small>${esc(c.file)} · covers ${esc(c.covers.join(", ") || "nothing")}</small></p>
    <table><tr><th>#</th><th>Step</th><th>Verdict</th><th>Judgments</th><th>Evidence</th></tr>${steps}</table></section>`;
}).join("");

const tokens = events.filter((e) => e.event === "judgment.answered").reduce((n, e) => n + e.usage.input_tokens, 0);
const asked = events.filter((e) => e.event === "judgment.answered").length;
writeFileSync(join(dir, "report.html"), `<!doctype html><meta charset="utf-8"><title>QA Run ${esc(runId)}</title>
<style>body{font:14px system-ui;margin:2rem;max-width:1200px}table{border-collapse:collapse;width:100%}td,th{border-top:1px solid #ddd;padding:.4rem;vertical-align:top;text-align:left}pre{white-space:pre-wrap;font-size:11px;max-height:300px;overflow:auto;background:#f6f8fa}code{font-size:11px}</style>
<h1>PROTOTYPE · Run ${esc(runId)}</h1>
<p>${asked} Jev judgments · ${tokens} input tokens · model ${esc(events[0].model)} · pass ≥ ${events[0].thresholds.pass}, fail ≤ ${events[0].thresholds.fail}</p>
${cases}`);
console.log(`Report: ${join(dir, "report.html")}`);
