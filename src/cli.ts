#!/usr/bin/env -S node --import tsx
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { JEV_MODEL, jevJudge } from "./judge.ts";
import { fileJournal, JOURNAL_FILE, type Journal, type JournalEvent } from "./journal.ts";
import { buildReport, skipReason } from "./report.ts";
import { planRun, RunPlanError, runTestCases, type TestCaseVerdict } from "./run.ts";
import { DEFAULT_OPTIONS, type Verdict } from "./run-test-case.ts";
import { missingVariables, parseTestCase, variableNames, type TestData } from "./test-case.ts";

const USAGE = `Usage: qa run <folder> [--out <dir>]

Runs every Test Case (*.md) in <folder> and writes the Journal and report.html
to <out>/<run id>/ (default <folder>/../qa-runs).

Test Data: <folder>/test-data.json; an environment variable of the same name wins.
Needs TYPESAFE_API_KEY.`;

const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: "string" } } });
const [command, folderArg] = positionals;
if (command !== "run" || !folderArg) {
  console.error(USAGE);
  process.exit(2);
}

if (!process.env.TYPESAFE_API_KEY) fail("Set TYPESAFE_API_KEY: Jev judges every Step.");

const folder = resolve(folderArg);
const files = readdirSync(folder).filter((f) => f.endsWith(".md")).sort();
const testCases = files.map((f) => parseTestCase(f, readFileSync(join(folder, f), "utf8")));
if (testCases.length === 0) fail(`No Test Cases (*.md) in ${folder}`);

const dataFile = join(folder, "test-data.json");
const fileData: TestData = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, "utf8")) : {};
const testData: TestData = { ...fileData };
for (const tc of testCases) {
  for (const name of variableNames(tc)) if (process.env[name] !== undefined) testData[name] = process.env[name]!;
}
const missing = testCases.flatMap((tc) => missingVariables(tc, testData).map((v) => `{{${v}}} in ${tc.file}`));
if (missing.length) fail(`No Test Data for ${missing.join(", ")}.\nAdd it to ${dataFile} or set an environment variable of that name.`);
try {
  planRun(testCases);
} catch (e) {
  if (e instanceof RunPlanError) fail(e.message);
  throw e;
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(resolve(values.out ?? join(folder, "..", "qa-runs")), runId);
const journal = printing(fileJournal(runDir));
const judge = jevJudge();
journal.record("run.started", {
  runId, model: JEV_MODEL, thresholds: { pass: DEFAULT_OPTIONS.pass, fail: DEFAULT_OPTIONS.fail }, cases: files,
});

const browser = await chromium.launch();
let verdicts: TestCaseVerdict[] = [];
try {
  verdicts = await runTestCases(testCases, { browser, judge, testData, journal });
} finally {
  await browser.close();
  journal.record("run.finished", { runId });
}

const events: JournalEvent[] = readFileSync(join(runDir, JOURNAL_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l));
writeFileSync(join(runDir, "report.html"), buildReport(events));
console.log(`\nJournal: ${join(runDir, JOURNAL_FILE)}\nReport:  ${join(runDir, "report.html")}`);
process.exit(verdicts.every((v) => v.verdict === "Passed") ? 0 : 1);

/** Prints each Test Case and Step as the Journal records it (values already redacted). */
function printing(journal: Journal): Journal {
  const ICON: Record<Verdict, string> = { Passed: "✓", Failed: "✗", "Needs Review": "?", Skipped: "-" };
  const stepText = new Map<string, string>();
  return {
    attach: journal.attach,
    record(event, data) {
      journal.record(event, data);
      if (event === "case.started" || event === "case.skipped") console.log(`\n▶ ${data.title}  (${data.file})`);
      if (event === "step.started") stepText.set(data.step as string, data.text as string);
      if (event === "step.verdict") {
        console.log(`  ${ICON[data.verdict as Verdict]} ${stepText.get(data.step as string)}\n      ${data.verdict}: ${data.why}`);
      }
      if (event === "case.verdict") {
        const because = data.verdict === "Skipped" ? `: ${skipReason(data)}` : "";
        console.log(`  = ${data.verdict}${because}`);
      }
    },
  };
}

function fail(message: string): never {
  console.error(`qa: ${message}`);
  process.exit(2);
}
