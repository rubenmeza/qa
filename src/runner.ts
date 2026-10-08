import type { Page } from "playwright";
import { JudgeUnavailableError, type ActionKind, type Judge, type JudgeRecord } from "./judge.ts";
import type { Journal } from "./journal.ts";
import { candidates, takeSnapshot } from "./page-snapshot.ts";
import { resolveVariables, type Step, type TestCase, type TestData } from "./test-case.ts";

export type Verdict = "Passed" | "Failed" | "Needs Review";

export type Options = {
  /** Probability at or above which a judgment counts as yes. */
  pass: number;
  /** Probability at or below which an Expectation counts as no. */
  fail: number;
  /** How long an Expectation may be re-judged as the page changes. */
  stepTimeoutMs: number;
  /** How long the page must stay unchanged to count as settled. */
  settleMs: number;
  /** How long to wait for an Action to change the page before judging anyway. */
  changeTimeoutMs: number;
};

export const DEFAULT_OPTIONS: Options = { pass: 0.9, fail: 0.1, stepTimeoutMs: 5000, settleMs: 300, changeTimeoutMs: 2000 };

export type StepResult = { n: number; verdict: Verdict; why: string };
export type CaseResult = { verdict: Verdict; steps: StepResult[] };

type Deps = { page: Page; judge: Judge; testData: TestData; journal: Journal; options?: Partial<Options> };

const VERBS: [RegExp, ActionKind][] = [
  [/^(open|go to|navigate to|visit)\b/i, "open"],
  [/^(click|tap)\b/i, "click"],
  [/^(type|enter|fill)\b/i, "type"],
  [/^(select|choose)\b/i, "select"],
  [/^press\b/i, "press"],
  [/^wait for\b/i, "wait"],
];

/** Runs one Test Case in `page`, halting at the first Step that does not pass. */
export async function runTestCase(testCase: TestCase, deps: Deps): Promise<CaseResult> {
  const { page } = deps;
  const opts = { ...DEFAULT_OPTIONS, ...deps.options };
  const redact = redactor(testCase, deps.testData);
  const journal: Journal = {
    record: (event, data) => deps.journal.record(event, JSON.parse(redact(JSON.stringify(data)))),
    attach: (name, bytes) => deps.journal.attach(name, bytes),
  };
  const run: Run = { ...deps, journal, opts, redact, ref: "" };
  journal.record("case.started", { file: testCase.file, title: testCase.title, covers: testCase.covers, steps: testCase.steps });

  const steps: StepResult[] = [];
  for (const step of testCase.steps) {
    run.ref = `${testCase.file}#${step.n}`;
    journal.record("step.started", { step: run.ref, kind: step.kind, text: step.text });
    let r: Omit<StepResult, "n">;
    try {
      r = step.kind === "do" ? await doAction(run, step) : await checkExpectation(run, step);
    } catch (e) {
      const message = (e as Error).message.split("\n")[0];
      // A judge outage says nothing about the application.
      r = e instanceof JudgeUnavailableError
        ? { verdict: "Needs Review", why: `judge unavailable: ${message}` }
        : { verdict: "Failed", why: `error: ${message}` };
    }
    const shot = await page.screenshot().catch(() => undefined);
    const screenshot = shot && journal.attach(`shots/${testCase.file.replace(/\W/g, "_")}-${step.n}.png`, shot);
    journal.record("step.verdict", { step: run.ref, ...r, evidence: { screenshot, url: page.url() } });
    steps.push({ n: step.n, ...r });
    if (r.verdict !== "Passed") break;
  }

  const verdict = steps.find((s) => s.verdict !== "Passed")?.verdict ?? "Passed";
  journal.record("case.verdict", { file: testCase.file, verdict });
  return { verdict, steps };
}

type Run = Deps & { opts: Options; ref: string; redact: (text: string) => string };

/**
 * Replaces every Test Data value this Test Case uses with its `{{variable}}`, so the
 * judge and the Journal never see secrets or fixtures (the Page Snapshot shows typed
 * values, password fields included). Values are matched raw and JSON-escaped.
 */
function redactor(testCase: TestCase, testData: TestData) {
  const used = new Set(testCase.steps.flatMap((s) => [...s.text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])));
  const pairs = [...used]
    .filter((name) => testData[name])
    .flatMap((name) => [testData[name], JSON.stringify(testData[name]).slice(1, -1)].map((v) => [v, `{{${name}}}`] as const))
    .sort((a, b) => b[0].length - a[0].length);
  return (text: string) => pairs.reduce((t, [value, name]) => t.split(value).join(name), text);
}

function recordJudgment(run: Run, purpose: string, record: JudgeRecord) {
  run.journal.record("judgment", { step: run.ref, purpose, ...record });
}

async function doAction(run: Run, step: Step): Promise<Omit<StepResult, "n">> {
  const { page, judge, opts } = run;
  let kind = VERBS.find(([re]) => re.test(step.text))?.[1];
  if (!kind) {
    const k = await judge.actionKind(step.text);
    recordJudgment(run, "action-kind", k.record);
    if (k.p < opts.pass) return { verdict: "Needs Review", why: `unsure which Action this is (${k.choice}, p=${k.p})` };
    kind = k.choice as ActionKind;
  }
  const value = step.literals[0] === undefined ? undefined : resolveVariables(step.literals[0], run.testData);

  if (kind === "open") {
    if (!value) return { verdict: "Failed", why: "open needs a quoted URL" };
    await page.goto(value);
    await settle(run);
    return { verdict: "Passed", why: `opened ${value}` };
  }
  if (kind === "press") {
    const key = value ?? step.text.replace(/^press\s+/i, "").trim();
    const before = await takeSnapshot(page);
    await page.keyboard.press(key);
    return { verdict: "Passed", why: `pressed ${key}${await afterAction(run, before)}` };
  }
  if (kind === "wait") {
    if (!value) return { verdict: "Failed", why: "wait for needs quoted text" };
    await page.getByText(value).first().waitFor({ timeout: opts.stepTimeoutMs });
    return { verdict: "Passed", why: `saw "${value}"` };
  }

  // click, type, select: the judge picks the target among the Page Snapshot's elements.
  const pageSnapshot = await takeSnapshot(page);
  const cands = candidates(pageSnapshot);
  // The judge reads what to act on, not the value: code owns Literals.
  const t = await judge.target(
    step.text.replace(/"[^"]*"/g, "the given value"),
    run.redact(pageSnapshot),
    cands.map((c) => ({ ...c, name: run.redact(c.name), label: run.redact(c.label) })),
  );
  recordJudgment(run, "action-target", t.record);
  if (t.choice === "none") {
    return t.p >= opts.pass
      ? { verdict: "Failed", why: `no element matches (p=${t.p})` }
      : { verdict: "Needs Review", why: `unsure whether any element matches (p=${t.p})` };
  }
  const c = cands.find((x) => x.id === t.choice);
  if (!c) return { verdict: "Needs Review", why: `judge picked unknown element ${t.choice}` };
  if (t.p < opts.pass) return { verdict: "Needs Review", why: `unsure of target: ${c.label} (p=${t.p})` };

  const target = page.getByRole(c.role as Parameters<Page["getByRole"]>[0], { name: c.name, exact: true }).nth(c.nth);
  const timeout = opts.stepTimeoutMs;
  if (kind === "click") await target.click({ timeout });
  if (kind === "type") await target.fill(value ?? "", { timeout });
  if (kind === "select") await target.selectOption({ label: value ?? "" }, { timeout });
  return { verdict: "Passed", why: `${kind} ${c.label} (p=${t.p})${await afterAction(run, pageSnapshot)}` };
}

/**
 * Waits for the Action to change the page, then for it to settle, so the next Step is
 * not judged against the page as it was before (an Expectation also true of the old
 * page would otherwise Pass too early). Returns a note for the Step's reason.
 */
async function afterAction(run: Run, before: string) {
  const changed = await nextSnapshot(run.page, before, Date.now() + run.opts.changeTimeoutMs);
  await settle(run);
  return changed === undefined ? `; page did not change within ${run.opts.changeTimeoutMs} ms` : "";
}

/** Waits for network idle, then for the Page Snapshot to stay unchanged for `settleMs`. */
async function settle({ page, opts }: Run) {
  await page.waitForLoadState("networkidle", { timeout: opts.stepTimeoutMs }).catch(() => {});
  const deadline = Date.now() + opts.stepTimeoutMs;
  let prev = await takeSnapshot(page);
  while (Date.now() < deadline) {
    await page.waitForTimeout(opts.settleMs);
    const next = await takeSnapshot(page);
    if (next === prev) return;
    prev = next;
  }
}

/** Judges the Expectation; while not Passed, re-judges on each page change until the step timeout. */
async function checkExpectation(run: Run, step: Step): Promise<Omit<StepResult, "n">> {
  const { page, judge, opts } = run;
  const deadline = Date.now() + opts.stepTimeoutMs;
  let pageSnapshot = await takeSnapshot(page);
  for (let attempt = 1; ; attempt++) {
    // Unresolved statement against a redacted page: "greets {{name}}" vs "Welcome, {{name}}".
    const e = await judge.expectation(step.text, { url: run.redact(page.url()), pageSnapshot: run.redact(pageSnapshot) });
    recordJudgment(run, "expectation", e.record);
    if (e.p >= opts.pass) return { verdict: "Passed", why: `p=${e.p} (attempt ${attempt})` };
    const next = await nextSnapshot(page, pageSnapshot, deadline);
    if (next === undefined) {
      if (e.p <= opts.fail) return { verdict: "Failed", why: `p=${e.p}` };
      return { verdict: "Needs Review", why: `p=${e.p}, between ${opts.fail} and ${opts.pass}` };
    }
    pageSnapshot = next;
  }
}

/** Resolves with the first Page Snapshot that differs from `current`, or undefined at the deadline. */
async function nextSnapshot(page: Page, current: string, deadline: number) {
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const next = await takeSnapshot(page);
    if (next !== current) return next;
  }
  return undefined;
}
