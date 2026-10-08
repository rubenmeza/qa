import type { Page } from "playwright";
import { JudgeUnavailableError, type ActionKind, type Judge, type JudgeRecord } from "./judge.ts";
import type { Journal } from "./journal.ts";
import { candidates, takeSnapshot } from "./page-snapshot.ts";
import { caseSummary, resolveVariables, stepRef, variableNames, type Step, type TestCase, type TestData } from "./test-case.ts";

export type Verdict = "Passed" | "Failed" | "Needs Review" | "Skipped";
/** A Verdict reached by running: only a whole Test Case can be Skipped, by the Run. */
export type JudgedVerdict = Exclude<Verdict, "Skipped">;

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

/** A Step's Verdict and the reason for it. */
export type StepVerdict = { n: number; verdict: JudgedVerdict; why: string };
export type CaseVerdict = { verdict: JudgedVerdict; steps: StepVerdict[] };
type Judged = Omit<StepVerdict, "n">;

/** What running one Test Case needs. */
export type CaseDeps = { page: Page; judge: Judge; testData: TestData; journal: Journal; options?: Partial<Options> };

/** What a Step needs while it runs: the Test Case's page and judge, and the Step's ref. */
type StepContext = CaseDeps & { opts: Options; ref: string; redact: (text: string) => string };

/** What each judgment is about, as recorded in the Journal. */
type Purpose = "action-kind" | "element" | "expectation";

const VERBS: [RegExp, ActionKind][] = [
  [/^(open|go to|navigate to|visit)\b/i, "open"],
  [/^(click|tap)\b/i, "click"],
  [/^(type|enter|fill)\b/i, "type"],
  [/^(select|choose)\b/i, "select"],
  [/^press\b/i, "press"],
  [/^wait for\b/i, "wait"],
];

/** Runs one Test Case in `page`, halting at the first Step that does not pass. */
export async function runTestCase(testCase: TestCase, deps: CaseDeps): Promise<CaseVerdict> {
  const { page } = deps;
  const redact = redactor(testCase, deps.testData);
  const journal: Journal = {
    record: (event, data) => deps.journal.record(event, JSON.parse(redact(JSON.stringify(data)))),
    attach: deps.journal.attach,
  };
  const ctx: StepContext = { ...deps, journal, opts: { ...DEFAULT_OPTIONS, ...deps.options }, redact, ref: "" };
  journal.record("case.started", caseSummary(testCase));

  const steps: StepVerdict[] = [];
  for (const step of testCase.steps) {
    ctx.ref = stepRef(testCase.file, step.n);
    journal.record("step.started", { step: ctx.ref, kind: step.kind, text: step.text });
    let judged: Judged;
    try {
      judged = step.kind === "do" ? await doAction(ctx, step) : await judgeExpectation(ctx, step);
    } catch (e) {
      const message = (e as Error).message.split("\n")[0];
      // A judge outage says nothing about the application.
      judged = e instanceof JudgeUnavailableError
        ? { verdict: "Needs Review", why: `judge unavailable: ${message}` }
        : { verdict: "Failed", why: `error: ${message}` };
    }
    const shot = await page.screenshot().catch(() => undefined);
    const screenshot = shot && journal.attach(`shots/${testCase.file.replace(/\W/g, "_")}-${step.n}.png`, shot);
    const pageSnapshot = await takeSnapshot(page).catch(() => undefined);
    journal.record("step.verdict", { step: ctx.ref, ...judged, evidence: { screenshot, pageSnapshot, url: page.url() } });
    steps.push({ n: step.n, ...judged });
    if (judged.verdict !== "Passed") break;
  }

  const verdict = steps.find((s) => s.verdict !== "Passed")?.verdict ?? "Passed";
  journal.record("case.verdict", { file: testCase.file, verdict });
  return { verdict, steps };
}

/**
 * Replaces every Test Data value this Test Case uses with its `{{variable}}`, so the
 * judge and the Journal never see secrets or fixtures (the Page Snapshot shows typed
 * values, password fields included). Values are matched raw and JSON-escaped.
 */
function redactor(testCase: TestCase, testData: TestData) {
  const pairs = variableNames(testCase)
    .filter((name) => testData[name])
    .flatMap((name) => [testData[name], JSON.stringify(testData[name]).slice(1, -1)].map((v) => [v, `{{${name}}}`] as const))
    .sort((a, b) => b[0].length - a[0].length);
  return (text: string) => pairs.reduce((t, [value, name]) => t.split(value).join(name), text);
}

/** Asks the judge and journals the judgment, including one that could not be answered. */
async function ask<T extends { record: JudgeRecord }>(ctx: StepContext, purpose: Purpose, question: () => Promise<T>): Promise<T> {
  try {
    const answer = await question();
    ctx.journal.record("judgment", { step: ctx.ref, purpose, ...answer.record });
    return answer;
  } catch (e) {
    ctx.journal.record("judgment.failed", { step: ctx.ref, purpose, error: (e as Error).message });
    throw e;
  }
}

async function doAction(ctx: StepContext, step: Step): Promise<Judged> {
  const { page, judge, opts } = ctx;
  let kind = VERBS.find(([re]) => re.test(step.text))?.[1];
  if (!kind) {
    const judgedKind = await ask(ctx, "action-kind", () => judge.actionKind(step.text));
    if (judgedKind.p < opts.pass) {
      return { verdict: "Needs Review", why: `unsure which Action this is (${judgedKind.choice}, p=${judgedKind.p})` };
    }
    kind = judgedKind.choice as ActionKind;
  }
  const value = step.literals[0] === undefined ? undefined : resolveVariables(step.literals[0], ctx.testData);

  if (kind === "open") {
    if (!value) return { verdict: "Failed", why: "open needs a quoted URL" };
    await page.goto(value);
    await settle(ctx);
    return { verdict: "Passed", why: `opened ${value}` };
  }
  if (kind === "press") {
    const key = value ?? step.text.replace(/^press\s+/i, "").trim();
    const before = await takeSnapshot(page);
    await page.keyboard.press(key);
    return { verdict: "Passed", why: `pressed ${key}${await afterAction(ctx, before)}` };
  }
  if (kind === "wait") {
    if (!value) return { verdict: "Failed", why: "wait for needs quoted text" };
    await page.getByText(value).first().waitFor({ timeout: opts.stepTimeoutMs });
    return { verdict: "Passed", why: `saw "${value}"` };
  }

  // click, type, select: the judge picks the element among the Page Snapshot's candidates.
  // It reads the Step as written: Variables stay `{{names}}`, so no Test Data value leaks.
  const pageSnapshot = await takeSnapshot(page);
  const elements = candidates(pageSnapshot);
  const picked = await ask(ctx, "element", () => judge.element(
    step.text,
    ctx.redact(pageSnapshot),
    elements.map((c) => ({ ...c, name: ctx.redact(c.name), label: ctx.redact(c.label) })),
  ));
  if (picked.choice === "none") {
    return picked.p >= opts.pass
      ? { verdict: "Failed", why: `no element matches (p=${picked.p})` }
      : { verdict: "Needs Review", why: `unsure whether any element matches (p=${picked.p})` };
  }
  const el = elements.find((c) => c.id === picked.choice);
  if (!el) return { verdict: "Needs Review", why: `judge picked unknown element ${picked.choice}` };
  if (picked.p < opts.pass) return { verdict: "Needs Review", why: `unsure of element: ${el.label} (p=${picked.p})` };

  const locator = page.getByRole(el.role as Parameters<Page["getByRole"]>[0], { name: el.name, exact: true }).nth(el.nth);
  const timeout = opts.stepTimeoutMs;
  if (kind === "click") await locator.click({ timeout });
  if (kind === "type") await locator.fill(value ?? "", { timeout });
  if (kind === "select") await locator.selectOption({ label: value ?? "" }, { timeout });
  return { verdict: "Passed", why: `${kind} ${el.label} (p=${picked.p})${await afterAction(ctx, pageSnapshot)}` };
}

/**
 * Waits for the Action to change the page, then for it to settle, so the next Step is
 * not judged against the page as it was before (an Expectation also true of the old
 * page would otherwise Pass too early). Returns a note for the Step's reason.
 */
async function afterAction(ctx: StepContext, before: string) {
  const changed = await nextSnapshot(ctx.page, before, Date.now() + ctx.opts.changeTimeoutMs);
  await settle(ctx);
  return changed === undefined ? `; page did not change within ${ctx.opts.changeTimeoutMs} ms` : "";
}

/** Waits for network idle, then for the Page Snapshot to stay unchanged for `settleMs`. */
async function settle({ page, opts }: StepContext) {
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
async function judgeExpectation(ctx: StepContext, step: Step): Promise<Judged> {
  const { page, judge, opts } = ctx;
  const deadline = Date.now() + opts.stepTimeoutMs;
  let pageSnapshot = await takeSnapshot(page);
  for (let attempt = 1; ; attempt++) {
    // Unresolved statement against a redacted page: "greets {{name}}" vs "Welcome, {{name}}".
    const shown = { url: ctx.redact(page.url()), pageSnapshot: ctx.redact(pageSnapshot) };
    const { p } = await ask(ctx, "expectation", () => judge.expectation(step.text, shown));
    if (p >= opts.pass) return { verdict: "Passed", why: `p=${p} (attempt ${attempt})` };
    const next = await nextSnapshot(page, pageSnapshot, deadline);
    if (next === undefined) {
      if (p <= opts.fail) return { verdict: "Failed", why: `p=${p}` };
      return { verdict: "Needs Review", why: `p=${p}, between ${opts.fail} and ${opts.pass}` };
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
