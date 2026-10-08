import { describe, expect, it } from "vitest";
import { JudgeUnavailableError } from "../src/judge.ts";
import { runTestCase } from "../src/runner.ts";
import { parseTestCase } from "../src/test-case.ts";
import { byName, fakeJudge, memoryJournal, useBrowserPage, useFixtureServer } from "./helpers.ts";

const server = useFixtureServer();
const browser = useBrowserPage();
const testData = { email: "ada@example.com", password: "hunter2" };

const signIn = (extra: string) => parseTestCase("qa/sign-in.md", `# Sign in
- do: open "${server.url}/billing"
- do: type "{{email}}" into the email field
- do: type "{{password}}" into the password field
- do: click the sign in button
${extra}`);

describe("runTestCase", () => {
  it("Passes a Test Case whose page renders after a client-side delay", async () => {
    const judge = fakeJudge({
      target: byName,
      expectation: (_, snap) => (snap.includes("Welcome back") ? 0.99 : 0.02),
    });
    const result = await runTestCase(signIn("- expect: the user is greeted by name"), {
      page: browser.page, judge, testData, journal: memoryJournal(),
    });
    expect(result.steps.map((s) => s.verdict)).toEqual(["Passed", "Passed", "Passed", "Passed", "Passed"]);
    expect(result.verdict).toBe("Passed");
  });

  it("does not Pass an Expectation that was only true before the Action took effect", async () => {
    const judge = fakeJudge({
      target: byName,
      expectation: (_, snap) => (snap.includes("INV-") ? 0.02 : 0.99),
    });
    const result = await runTestCase(signIn("- expect: no invoices are shown"), {
      page: browser.page, judge, testData, journal: memoryJournal(), options: { stepTimeoutMs: 1500 },
    });
    expect(result.steps.at(-1)).toMatchObject({ n: 5, verdict: "Failed" });
  });

  it("never shows Test Data values to the judge or the Journal", async () => {
    const judge = fakeJudge({
      target: byName,
      expectation: (_, snap) => (snap.includes("Welcome back") ? 0.99 : 0.02),
    });
    const journal = memoryJournal();
    await runTestCase(signIn("- expect: the user is greeted by name"), {
      page: browser.page, judge, testData, journal,
    });
    const shown = JSON.stringify([judge.seen, journal.events]);
    expect(shown).not.toContain("hunter2");
    expect(shown).not.toContain("ada@example.com");
    expect(shown).toContain('textbox \\"Password\\": {{password}}');
  });

  it("gives Needs Review, not Failed, when the judge is unavailable", async () => {
    const judge = fakeJudge({
      target: () => { throw new JudgeUnavailableError("Jev: 503 Service Unavailable"); },
    });
    const result = await runTestCase(signIn(""), { page: browser.page, judge, testData, journal: memoryJournal() });
    expect(result.verdict).toBe("Needs Review");
    expect(result.steps.at(-1)).toMatchObject({ n: 2, verdict: "Needs Review", why: expect.stringContaining("503") });
  });

  it.each([
    { answer: { choice: "none", p: 0.97 }, verdict: "Failed" },
    { answer: { choice: "none", p: 0.6 }, verdict: "Needs Review" },
    { answer: { choice: "e0", p: 0.6 }, verdict: "Needs Review" },
  ])("gives $verdict when the judge answers $answer.choice at p=$answer.p, and halts", async ({ answer, verdict }) => {
    const judge = fakeJudge({ target: () => answer });
    const journal = memoryJournal();
    const result = await runTestCase(signIn("- expect: the user is greeted by name"), {
      page: browser.page, judge, testData, journal,
    });
    expect(result).toMatchObject({ verdict, steps: [{ n: 1, verdict: "Passed" }, { n: 2, verdict }] });
    expect(journal.events.filter((e) => e.event === "step.started")).toHaveLength(2);
  });

  it("gives Needs Review when an Expectation stays between the thresholds", async () => {
    const judge = fakeJudge({ expectation: () => 0.5 });
    const tc = parseTestCase("qa/x.md", `# X\n- do: open "${server.url}/billing"\n- expect: the page looks finished`);
    const result = await runTestCase(tc, { page: browser.page, judge, testData, journal: memoryJournal(), options: { stepTimeoutMs: 500 } });
    expect(result.steps.at(-1)).toMatchObject({ n: 2, verdict: "Needs Review" });
  });

  it("runs every core Action, asking the judge for the kind only when the verb is unknown", async () => {
    const shows: Record<string, string> = {
      "the Pro plan is selected": 'option "Pro" [selected]',
      "the newsletter box is ticked": 'checkbox "Newsletter" [checked]',
    };
    const judge = fakeJudge({
      target: byName,
      actionKind: () => ({ choice: "click", p: 0.95 }),
      expectation: (statement, snap) => (snap.includes(shows[statement]) ? 0.99 : 0.02),
    });
    const tc = parseTestCase("qa/shop.md", `# Shop
- do: open "${server.url}/shop"
- do: select "Pro" from the plan dropdown
- expect: the Pro plan is selected
- do: type "shoes" into the search box
- do: press "Enter"
- do: wait for "Results for shoes"
- do: tick the newsletter checkbox
- expect: the newsletter box is ticked`);
    const journal = memoryJournal();
    const result = await runTestCase(tc, { page: browser.page, judge, testData, journal });
    expect(result.steps.filter((s) => s.verdict !== "Passed")).toEqual([]);
    expect(result.steps).toHaveLength(8);
    expect(journal.events.filter((e) => e.purpose === "action-kind").map((e) => e.step)).toEqual(["qa/shop.md#7"]);
  });

  it("journals every Step with its judgments and a screenshot as Evidence", async () => {
    const judge = fakeJudge({ target: byName, expectation: (_, snap) => (snap.includes("Welcome back") ? 0.99 : 0.02) });
    const journal = memoryJournal();
    await runTestCase(signIn("- expect: the user is greeted by name"), { page: browser.page, judge, testData, journal });

    expect(journal.events.map((e) => e.event)).toEqual([
      "case.started",
      ...["step.started", "step.verdict"],
      ...Array(3).fill(["step.started", "judgment", "step.verdict"]).flat(),
      "step.started", "judgment", "step.verdict", // one judgment: the click's change was awaited
      "case.verdict",
    ]);
    const judgment = journal.events.find((e) => e.event === "judgment")!;
    expect(judgment).toMatchObject({ step: "qa/sign-in.md#2", purpose: "action-target", model: "fake" });
    const verdicts = journal.events.filter((e) => e.event === "step.verdict");
    for (const v of verdicts) expect(journal.attachments.has((v.evidence as { screenshot: string }).screenshot)).toBe(true);
  });
});
