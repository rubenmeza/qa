import { describe, expect, it } from "vitest";
import { RunPlanError, runTestCases } from "../src/run.ts";
import { parseTestCase } from "../src/test-case.ts";
import { byName, fakeJudge, memoryJournal, useBrowser, useFixtureServer } from "./helpers.ts";

const server = useFixtureServer();
const chromium = useBrowser();
const testData = { email: "ada@example.com", password: "hunter2" };
const fast = { stepTimeoutMs: 1000 };

const testCase = (name: string, frontMatter: string, steps: string) =>
  parseTestCase(`qa/${name}.md`, `---\n${frontMatter}\n---\n# ${name}\n${steps}`);

const signIn = (expectation = "the user is greeted by name") => testCase("sign-in", "", `
- do: open "${server.url}/session"
- do: type "{{email}}" into the email field
- do: type "{{password}}" into the password field
- do: click the sign in button
- expect: ${expectation}`);

const greeted = (name: string, requires = "requires: [sign-in]") => testCase(name, requires, `
- do: open "${server.url}/session"
- expect: the user is greeted by name`);

/** A judge that answers from the page: greeted only when the page says so. */
const pageJudge = () => fakeJudge({
  element: byName,
  expectation: (statement, snap) =>
    statement === "the user is greeted by name" ? (snap.includes("Welcome back") ? 0.99 : 0.02) : 0.02,
});

describe("runTestCases", () => {
  it("runs a Setup once, first, and starts the Test Cases requiring it from its session", async () => {
    const journal = memoryJournal();
    const verdicts = await runTestCases(
      [greeted("invoices"), greeted("profile"), signIn(), greeted("not-signed-in", "")],
      { browser: chromium.browser, judge: pageJudge(), testData, journal, options: fast },
    );
    expect(verdicts).toEqual([
      { name: "sign-in", verdict: "Passed" },
      { name: "invoices", verdict: "Passed" },
      { name: "profile", verdict: "Passed" },
      { name: "not-signed-in", verdict: "Failed" },
    ]);
    const started = journal.events.filter((e) => e.event === "case.started").map((e) => e.file);
    expect(started).toEqual(["qa/sign-in.md", "qa/invoices.md", "qa/profile.md", "qa/not-signed-in.md"]);
  });

  it("Skips every Test Case downstream of a Setup that did not pass, without running it", async () => {
    const journal = memoryJournal();
    const verdicts = await runTestCases(
      [signIn("the page shows a two-factor prompt"), greeted("invoices"), greeted("export", "requires: [invoices]")],
      { browser: chromium.browser, judge: pageJudge(), testData, journal, options: fast },
    );
    expect(verdicts).toEqual([
      { name: "sign-in", verdict: "Failed" },
      { name: "invoices", verdict: "Skipped" },
      { name: "export", verdict: "Skipped" },
    ]);
    expect(journal.events.filter((e) => e.event === "case.started").map((e) => e.file)).toEqual(["qa/sign-in.md"]);
    expect(journal.events.filter((e) => e.event === "case.verdict" && e.verdict === "Skipped")).toMatchObject([
      { file: "qa/invoices.md", setup: "sign-in", failedSetup: "sign-in", failedSetupVerdict: "Failed" },
      { file: "qa/export.md", setup: "invoices", failedSetup: "sign-in", failedSetupVerdict: "Failed" },
    ]);
  });

  it.each([
    {
      why: "a Setup that does not exist",
      cases: () => [greeted("invoices", "requires: [sign-in-as-admin]")],
      error: 'invoices.md requires "sign-in-as-admin", but there is no sign-in-as-admin.md',
    },
    {
      why: "more than one Setup",
      cases: () => [signIn(), greeted("admin", ""), greeted("invoices", "requires: [sign-in, admin]")],
      error: "invoices.md requires 2 Setups (sign-in, admin); a Test Case starts from one",
    },
    {
      why: "Setups that require each other",
      cases: () => [greeted("a", "requires: [b]"), greeted("b", "requires: [a]"), greeted("c", "requires: [a]")],
      error: /^Setups require each other: a\.md, b\.md$/,
    },
  ])("stops the Run before any browser work when a Test Case requires $why", async ({ cases, error }) => {
    const journal = memoryJournal();
    const run = runTestCases(cases(), { browser: chromium.browser, judge: pageJudge(), testData, journal });
    await expect(run).rejects.toThrow(RunPlanError);
    await expect(run).rejects.toThrow(error);
    expect(journal.events).toEqual([]);
  });
});
