import type { Browser, BrowserContextOptions } from "playwright";
import type { Judge } from "./judge.ts";
import type { Journal } from "./journal.ts";
import { runTestCase, type Options, type Verdict } from "./runner.ts";
import type { TestCase, TestData } from "./test-case.ts";

type Deps = { browser: Browser; judge: Judge; testData: TestData; journal: Journal; options?: Partial<Options> };

export type CaseVerdictByName = { name: string; verdict: Verdict };

type Session = NonNullable<BrowserContextOptions["storageState"]>;

/**
 * Runs Test Cases in an order where each Setup comes before the Test Cases requiring it.
 * Each starts in a fresh browser context, loaded with its Setup's session when it has one.
 */
export async function runTestCases(testCases: TestCase[], deps: Deps): Promise<CaseVerdictByName[]> {
  const ordered = planRun(testCases);
  const setups = new Set(testCases.flatMap((tc) => tc.requires));
  const sessions = new Map<string, Session>();
  const verdicts: CaseVerdictByName[] = [];

  for (const tc of ordered) {
    const setup = tc.requires[0];
    const setupVerdict = setup && verdicts.find((v) => v.name === setup)!.verdict;
    if (setupVerdict && setupVerdict !== "Passed") {
      const { file, title, covers, requires, steps } = tc;
      deps.journal.record("case.skipped", { file, title, covers, requires, steps });
      deps.journal.record("case.verdict", { file, verdict: "Skipped", setup, setupVerdict });
      verdicts.push({ name: tc.name, verdict: "Skipped" });
      continue;
    }
    const context = await deps.browser.newContext(setup ? { storageState: sessions.get(setup) } : {});
    try {
      const { verdict } = await runTestCase(tc, { ...deps, page: await context.newPage() });
      // The session holds credentials: kept in memory for this Run only, never journalled.
      if (verdict === "Passed" && setups.has(tc.name)) sessions.set(tc.name, await context.storageState());
      verdicts.push({ name: tc.name, verdict });
    } finally {
      await context.close();
    }
  }
  return verdicts;
}

/** A `requires:` the Run cannot satisfy; raised before any browser work. */
export class RunPlanError extends Error {}

/**
 * Orders Test Cases so every Setup runs before the Test Cases requiring it, otherwise
 * keeping their order. Each Test Case starts from at most one Setup, which must exist.
 */
export function planRun(testCases: TestCase[]): TestCase[] {
  const names = new Set(testCases.map((tc) => tc.name));
  for (const tc of testCases) {
    if (tc.requires.length > 1) {
      throw new RunPlanError(`${tc.name}.md requires ${tc.requires.length} Setups (${tc.requires.join(", ")}); a Test Case starts from one`);
    }
    const missing = tc.requires.find((r) => !names.has(r));
    if (missing) throw new RunPlanError(`${tc.name}.md requires "${missing}", but there is no ${missing}.md`);
  }

  const ordered: TestCase[] = [];
  const pending = [...testCases];
  while (pending.length) {
    const i = pending.findIndex((tc) => tc.requires.every((r) => ordered.some((o) => o.name === r)));
    if (i === -1) throw new RunPlanError(`Setups require each other: ${pending.map((tc) => `${tc.name}.md`).join(", ")}`);
    ordered.push(...pending.splice(i, 1));
  }
  return ordered;
}
