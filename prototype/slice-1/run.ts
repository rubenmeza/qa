// PROTOTYPE (slice 1): throwaway. Answers the question in README.md.
// One file on purpose: parse Test Cases, drive Playwright, ask Jev, write the Journal.
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { choice, noul, TypeSafeClient, TypeSafeError } from "@typesafe-ai/sdk";

const PASS = 0.9; // design.md #7: start conservative
const FAIL = 0.1;
const STEP_TIMEOUT_MS = 5000; // design.md #8
const SETTLE_MS = 300;
const MODEL = "jev-1.13.0"; // pinned, thresholds are per version

// ---------- Journal ----------
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join("runs", runId);
mkdirSync(join(runDir, "shots"), { recursive: true });
const journal = (event: string, data: Record<string, unknown> = {}) => {
  appendFileSync(join(runDir, "journal.jsonl"), JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n");
};

// ---------- Test Case parsing ----------
type Step = { n: number; kind: "do" | "expect"; text: string };
type TestCase = { file: string; title: string; covers: string[]; steps: Step[] };

function parseTestCase(file: string): TestCase {
  const src = readFileSync(file, "utf8");
  const fm = src.match(/^---\n([\s\S]*?)\n---/);
  const covers = fm?.[1].match(/covers:\s*(\[.*\])/)?.[1];
  const title = src.match(/^# (.+)$/m)?.[1] ?? file;
  const steps: Step[] = [];
  for (const line of src.split("\n")) {
    const m = line.match(/^- (do|expect):\s*(.+)$/);
    if (m) steps.push({ n: steps.length + 1, kind: m[1] as Step["kind"], text: m[2].trim() });
  }
  return { file, title, covers: covers ? JSON.parse(covers) : [], steps };
}

// Test Data: data file, env wins. Code resolves Variables; Jev never sees secret values.
const testData: Record<string, string> = { ...JSON.parse(readFileSync("qa/test-data.json", "utf8")), ...process.env };
const resolve = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (!(k in testData)) throw new Error(`Variable {{${k}}} has no Test Data`);
  return testData[k];
});
const literals = (text: string) => [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

// ---------- Page Snapshot ----------
const snapshot = (page: Page) => page.locator("body").ariaSnapshot();

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: STEP_TIMEOUT_MS }).catch(() => {});
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let prev = await snapshot(page);
  while (Date.now() < deadline) {
    await page.waitForTimeout(SETTLE_MS);
    const next = await snapshot(page);
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

// Interactive elements, read from the snapshot itself so Jev picks from what it was shown.
const INTERACTIVE = new Set(["button", "link", "textbox", "checkbox", "radio", "combobox", "listbox", "option", "menuitem", "tab", "switch", "searchbox", "spinbutton", "slider"]);
type Candidate = { id: string; role: string; name: string; nth: number; label: string };
function candidates(snap: string): Candidate[] {
  const seen = new Map<string, number>();
  const out: Candidate[] = [];
  for (const line of snap.split("\n")) {
    const m = line.match(/^\s*- (\w+)(?: "((?:[^"\\]|\\.)*)")?/);
    if (!m || !INTERACTIVE.has(m[1])) continue;
    const role = m[1], name = (m[2] ?? "").replace(/\\"/g, '"');
    const key = `${role}|${name}`;
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    out.push({ id: `e${out.length}`, role, name, nth, label: line.trim().slice(2) });
  }
  return out;
}

// ---------- Jev ----------
const jev = new TypeSafeClient({ defaultModel: MODEL });
async function ask(stepRef: string, purpose: string, state: unknown, questions: Record<string, any>) {
  journal("judgment.asked", { step: stepRef, purpose, model: MODEL, state, questions });
  const t0 = Date.now();
  const res = await jev.systemOne({ state: state as any, questions });
  journal("judgment.answered", { step: stepRef, purpose, model: res.model, answers: res.answers, usage: res.usage, ms: Date.now() - t0 });
  return res.answers as Record<string, any>;
}

// ---------- Actions ----------
type Verdict = "Passed" | "Failed" | "Needs Review";
type ActionKind = "open" | "click" | "type" | "select" | "press" | "wait";
const VERBS: [RegExp, ActionKind][] = [
  [/^(open|go to|navigate to|visit)\b/i, "open"],
  [/^(click|tap)\b/i, "click"],
  [/^(type|enter|fill)\b/i, "type"],
  [/^(select|choose)\b/i, "select"],
  [/^press\b/i, "press"],
  [/^wait for\b/i, "wait"],
];

async function doAction(page: Page, ref: string, text: string): Promise<{ verdict: Verdict; why: string }> {
  let kind = VERBS.find(([re]) => re.test(text))?.[1];
  if (!kind) {
    // design.md #5: Jev Choice only when the leading verb is ambiguous
    const a = await ask(ref, "action-kind", { step: text }, {
      kind: choice("Which kind of browser action does `step` describe?", {
        open: "Open or navigate to a URL",
        click: "Click or tap an element",
        type: "Type text into a field",
        select: "Pick an option from a dropdown",
        press: "Press a keyboard key",
        wait: "Wait until some text appears",
      }),
    });
    if (a.kind.probabilities[a.kind.choice] < PASS) return { verdict: "Needs Review", why: `unsure which action (${a.kind.choice} p=${a.kind.probabilities[a.kind.choice]})` };
    kind = a.kind.choice as ActionKind;
  }
  const lits = literals(text);
  const value = lits[0] !== undefined ? resolve(lits[0]) : undefined;

  if (kind === "open") {
    if (!value) return { verdict: "Failed", why: "open needs a quoted URL Literal" };
    await page.goto(value);
    return { verdict: "Passed", why: `opened ${value}` };
  }
  if (kind === "press" && !/\b(button|link|field|box)\b/i.test(text)) {
    const key = value ?? text.replace(/^press\s+/i, "").trim();
    await page.keyboard.press(key);
    return { verdict: "Passed", why: `pressed ${key}` };
  }
  if (kind === "wait") {
    if (!value) return { verdict: "Failed", why: "wait for needs a quoted text Literal" };
    await page.getByText(value).first().waitFor({ timeout: STEP_TIMEOUT_MS });
    return { verdict: "Passed", why: `saw "${value}"` };
  }

  // click / type / select: Jev picks the target among snapshot candidates.
  const snap = await snapshot(page);
  const cands = candidates(snap).slice(0, 250);
  // Strip Literals from what Jev reads: it judges the target, code owns the value.
  const target = text.replace(/"[^"]*"/g, "the given value");
  const criteria: Record<string, string> = Object.fromEntries(cands.map((c) => [c.id, c.label]));
  criteria.none = "No element on the page matches what the step describes";
  const a = await ask(ref, "action-target", { step: target, page_snapshot: snap }, {
    target: choice("Which element in `page_snapshot` does `step` act on?", criteria),
  });
  const pick = a.target.choice as string;
  const p = a.target.probabilities[pick] as number;
  if (pick === "none") return { verdict: p >= PASS ? "Failed" : "Needs Review", why: `no matching element (p=${p})` };
  if (p < PASS) return { verdict: "Needs Review", why: `unsure of target: ${criteria[pick]} (p=${p})` };
  const c = cands.find((x) => x.id === pick)!;
  const loc = page.getByRole(c.role as any, { name: c.name, exact: true }).nth(c.nth);
  if (kind === "click") await loc.click({ timeout: STEP_TIMEOUT_MS });
  if (kind === "type") await loc.fill(value ?? "", { timeout: STEP_TIMEOUT_MS });
  if (kind === "select") await loc.selectOption({ label: value ?? "" }, { timeout: STEP_TIMEOUT_MS });
  if (kind === "press") await loc.press(value ?? "Enter", { timeout: STEP_TIMEOUT_MS });
  return { verdict: "Passed", why: `${kind} ${c.label} (p=${p})` };
}

// ---------- Expectations ----------
async function checkExpectation(page: Page, ref: string, text: string): Promise<{ verdict: Verdict; why: string }> {
  const statement = resolve(text);
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let snap = await snapshot(page);
  let p = 0;
  for (let attempt = 1; ; attempt++) {
    journal("snapshot", { step: ref, attempt, url: page.url(), snapshot: snap });
    const a = await ask(ref, "expectation", { url: page.url(), page_snapshot: snap }, {
      holds: noul(`Is this statement true of the page described in \`page_snapshot\`? Statement: ${statement}`, {
        true: "The page snapshot clearly shows the statement is true",
        false: "The page snapshot shows the statement is false, or shows nothing that makes it true",
      }),
    });
    p = a.holds.noul;
    if (p >= PASS) return { verdict: "Passed", why: `p=${p} (attempt ${attempt})` };
    // design.md #8: not Passed → re-judge only when the page changes, until timeout
    let changed = false;
    while (Date.now() < deadline && !changed) {
      await page.waitForTimeout(200);
      const next = await snapshot(page);
      if (next !== snap) { snap = next; changed = true; }
    }
    if (!changed) break;
  }
  if (p <= FAIL) return { verdict: "Failed", why: `p=${p}` };
  return { verdict: "Needs Review", why: `p=${p} in uncertain band (${FAIL}, ${PASS}); no Escalation in slice 1` };
}

// ---------- Run ----------
// Serve the demo Application Under Test inside the container.
const html = readFileSync("demo-app/index.html");
const server = createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); }).listen(4173);

const cases = readdirSync("qa").filter((f) => f.endsWith(".md")).sort().map((f) => parseTestCase(join("qa", f)));
journal("run.started", { runId, model: MODEL, thresholds: { pass: PASS, fail: FAIL }, cases: cases.map((c) => c.file) });
const browser = await chromium.launch();

for (const tc of cases) {
  console.log(`\n▶ ${tc.title}  (${tc.file})`);
  journal("case.started", { file: tc.file, title: tc.title, covers: tc.covers, steps: tc.steps });
  const context = await browser.newContext(); // fresh per Test Case, design.md #9
  const page = await context.newPage();
  let caseVerdict: Verdict = "Passed";
  for (const step of tc.steps) {
    const ref = `${tc.file}#${step.n}`;
    journal("step.started", { step: ref, kind: step.kind, text: step.text });
    let r: { verdict: Verdict; why: string };
    try {
      r = step.kind === "do" ? await doAction(page, ref, step.text) : await checkExpectation(page, ref, step.text);
      if (step.kind === "do" && r.verdict === "Passed") await settle(page);
    } catch (e) {
      // A judge outage says nothing about the app: don't call it Failed.
      const judgeDown = e instanceof TypeSafeError;
      r = { verdict: judgeDown ? "Needs Review" : "Failed", why: `${judgeDown ? "Jev error" : "error"}: ${(e as Error).message.split("\n")[0]}` };
    }
    const shot = join("shots", `${tc.file.replace(/\W/g, "_")}-${step.n}.png`);
    await page.screenshot({ path: join(runDir, shot) }).catch(() => {});
    journal("step.verdict", { step: ref, verdict: r.verdict, why: r.why, evidence: { screenshot: shot, url: page.url() } });
    console.log(`  ${r.verdict === "Passed" ? "✓" : r.verdict === "Failed" ? "✗" : "?"} ${step.kind}: ${step.text}\n      → ${r.verdict}: ${r.why}`);
    if (r.verdict !== "Passed") { caseVerdict = r.verdict; break; } // halts the Test Case
  }
  journal("case.verdict", { file: tc.file, verdict: caseVerdict });
  console.log(`  = ${caseVerdict}`);
  await context.close();
}

await browser.close();
server.close();
journal("run.finished", { runId });
console.log(`\nJournal: ${join(runDir, "journal.jsonl")}`);
