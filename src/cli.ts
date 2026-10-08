#!/usr/bin/env -S node --import tsx
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { evaluateCriteria, readCoveredIssues, type IssueReader, type Standing } from "./acceptance-criteria.ts";
import { githubIssueReader, repoFromRemote } from "./github.ts";
import { JEV_MODEL, jevJudge } from "./judge.ts";
import { fileJournal, JOURNAL_FILE, type Journal, type JournalEvent } from "./journal.ts";
import { buildReport, skipReason } from "./report.ts";
import { planRun, RunPlanError, runTestCases, type TestCaseVerdict } from "./run.ts";
import { DEFAULT_OPTIONS, type Verdict } from "./run-test-case.ts";
import { missingVariables, parseTestCase, variableNames, type TestData } from "./test-case.ts";

const USAGE = `Usage: qa run <folder> [--out <dir>] [--repo <owner/name>]

Runs every Test Case (*.md) in <folder> and writes the Journal and report.html
to <out>/<run id>/ (default <folder>/../qa-runs).

Test Data: <folder>/test-data.json; an environment variable of the same name wins.
Acceptance Criteria: \`covers: ["#123/tag"]\` reads issue 123 of --repo, else
QA_GITHUB_REPO, else the GitHub \`origin\` of the git repo holding <folder>.
Needs TYPESAFE_API_KEY; GITHUB_TOKEN for private repos and higher rate limits.`;

const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, repo: { type: "string" } } });
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
const repo = values.repo || process.env.QA_GITHUB_REPO || repoFromRemote(process.env.QA_GIT_REMOTE || gitRemote(folder));
journal.record("run.started", {
  runId, model: JEV_MODEL, thresholds: { pass: DEFAULT_OPTIONS.pass, fail: DEFAULT_OPTIONS.fail }, cases: files, repo,
});
if (testCases.some((tc) => tc.covers.length)) await readCoveredIssues(testCases, issueReader(repo), journal);

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
printCriteria(events);
console.log(`\nJournal: ${join(runDir, JOURNAL_FILE)}\nReport:  ${join(runDir, "report.html")}`);
process.exit(verdicts.every((v) => v.verdict === "Passed") ? 0 : 1);

function gitRemote(dir: string): string {
  try {
    return execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function issueReader(repo: string | undefined): IssueReader {
  if (repo) return githubIssueReader(repo);
  return {
    repo: "unknown",
    url: () => undefined,
    read: async () => { throw new Error("no GitHub repo: pass --repo owner/name or set QA_GITHUB_REPO"); },
  };
}

function printCriteria(events: JournalEvent[]) {
  const { criteria, problems } = evaluateCriteria(events);
  if (!criteria.length && !problems.length) return;
  const count = (standing: Standing) => criteria.filter((c) => c.standing === standing).length;
  console.log(`\nAcceptance Criteria: ${count("Met")} Met, ${count("Unmet")} Unmet, ${count("Unverified")} Unverified`);
  for (const c of criteria) {
    if (c.standing !== "Met") console.log(`  ${c.standing}: #${c.issue}${c.tag ? `/${c.tag}` : ""} ${c.text}${c.warning ? ` (${c.warning})` : ""}`);
  }
  for (const p of problems) console.log(`  ${p.file} covers ${p.cover}: ${p.problem}`);
}

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
