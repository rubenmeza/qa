import type { Browser, BrowserContextOptions } from "playwright";
import { runTestCase, type CaseDeps, type Verdict } from "./run-test-case.ts";
import { caseSummary, type TestCase } from "./test-case.ts";

type RunDeps = Omit<CaseDeps, "page"> & { browser: Browser };

export type TestCaseVerdict = { name: string; verdict: Verdict };

/** A Setup's cookies and local storage, as Playwright saves them. */
type StorageState = NonNullable<BrowserContextOptions["storageState"]>;

/**
 * Runs Test Cases in an order where each Setup comes before the Test Cases requiring it.
 * Each starts in a fresh browser context, loaded with its Setup's storage state when it
 * has one. A Test Case whose Setup did not pass is Skipped, down the chain.
 */
export async function runTestCases(testCases: TestCase[], deps: RunDeps): Promise<TestCaseVerdict[]> {
  const ordered = planRun(testCases);
  const setups = new Set(testCases.flatMap((tc) => tc.requires));
  const storageStates = new Map<string, StorageState>();
  /** For each Test Case that did not pass: the Setup that first failed upstream, or itself. */
  const failedAt = new Map<string, { failedSetup: string; failedSetupVerdict: Verdict }>();
  const verdicts: TestCaseVerdict[] = [];

  for (const tc of ordered) {
    const setup = tc.requires[0];
    const cause = setup ? failedAt.get(setup) : undefined;
    if (cause) {
      deps.journal.record("case.skipped", caseSummary(tc));
      deps.journal.record("case.verdict", { file: tc.file, verdict: "Skipped", setup, ...cause });
      failedAt.set(tc.name, cause);
      verdicts.push({ name: tc.name, verdict: "Skipped" });
      continue;
    }
    const context = await deps.browser.newContext(setup ? { storageState: storageStates.get(setup) } : {});
    try {
      const { verdict } = await runTestCase(tc, { ...deps, page: await context.newPage() });
      // Holds credentials: kept in memory for this Run only, never journalled.
      if (verdict === "Passed" && setups.has(tc.name)) storageStates.set(tc.name, await context.storageState());
      if (verdict !== "Passed") failedAt.set(tc.name, { failedSetup: tc.name, failedSetupVerdict: verdict });
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
    if (i === -1) {
      // Left over: the cycle and whatever depends on it. Name only the Setups in it.
      const stuck = pending.filter((tc) => pending.some((o) => o.requires.includes(tc.name)));
      throw new RunPlanError(`Setups require each other: ${stuck.map((tc) => `${tc.name}.md`).join(", ")}`);
    }
    ordered.push(...pending.splice(i, 1));
  }
  return ordered;
}
