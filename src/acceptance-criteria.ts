import { casesIn, type Journal } from "./journal.ts";
import type { Verdict } from "./run-test-case.ts";
import type { TestCase } from "./test-case.ts";

/** A checklist item under an issue's `## Acceptance criteria` heading; `tag` is its Criterion Tag. */
export type Criterion = { tag: string | undefined; text: string };

/** Reads the checklist items under the `Acceptance criteria` heading, up to the next heading of its level or higher. */
export function parseAcceptanceCriteria(issueBody: string): Criterion[] {
  const criteria: Criterion[] = [];
  let sectionLevel = 0; // heading level of the open section; 0 when outside it
  for (const line of issueBody.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      if (/^acceptance criteria$/i.test(heading[2])) sectionLevel = level;
      else if (level <= sectionLevel) sectionLevel = 0;
      continue;
    }
    const item = sectionLevel > 0 && line.match(/^\s*[-*] \[[ xX]\]\s+(?:\[([\w-]+)\]\s+)?(.+?)\s*$/);
    if (item) criteria.push({ tag: item[1], text: item[2] });
  }
  return criteria;
}

/** `#123/export-pdf` → issue 123, Criterion Tag `export-pdf`. */
export function parseCriterionId(id: string): { issue: number; tag: string } | undefined {
  const m = id.match(/^#(\d+)\/([\w-]+)$/);
  return m ? { issue: Number(m[1]), tag: m[2] } : undefined;
}

export type Standing = "Met" | "Unmet" | "Unverified";

export type CoveringCase = { file: string; title: string; verdict: Verdict | undefined };

export type EvaluatedCriterion = Criterion & {
  issue: number;
  /** Where the issue lives, when known. */
  url: string | undefined;
  standing: Standing;
  coveredBy: CoveringCase[];
  warning?: string;
};

/** A `covers:` entry that resolves to no Acceptance Criterion. */
export type CoverProblem = { file: string; cover: string; problem: string };

type Event = Record<string, any>;

/**
 * Each Acceptance Criterion of the issues read in a Run, with its Standing from the Test
 * Cases covering it: Met when every one Passed, Unmet when any Failed, otherwise Unverified.
 */
export function evaluateCriteria(events: Event[]): { criteria: EvaluatedCriterion[]; problems: CoverProblem[] } {
  const verdictOf = new Map<string, Verdict>(events.filter((e) => e.event === "case.verdict").map((e) => [e.file, e.verdict]));
  const covers = casesIn(events).flatMap((e) =>
    (e.covers as string[]).map((cover) => ({ file: e.file as string, title: e.title as string, cover, id: parseCriterionId(cover) })),
  );
  const coveringCases = (issue: number, tag: string): CoveringCase[] =>
    covers
      .filter((c) => c.id?.issue === issue && c.id.tag === tag)
      .map(({ file, title }) => ({ file, title, verdict: verdictOf.get(file) }));

  const criteria: EvaluatedCriterion[] = [];
  const criteriaByIssue = new Map<number, Criterion[]>();
  for (const e of events) {
    if (e.event === "issue.read") {
      const items = parseAcceptanceCriteria(e.body);
      criteriaByIssue.set(e.issue, items);
      const seen = new Set<string>();
      for (const item of items) {
        const base = { ...item, issue: e.issue as number, url: e.url as string };
        if (!item.tag) {
          criteria.push({ ...base, standing: "Unverified", coveredBy: [], warning: "needs tag" });
          continue;
        }
        const coveredBy = coveringCases(e.issue, item.tag);
        const repeated = seen.has(item.tag) ? { warning: `tag [${item.tag}] is used twice in #${e.issue}` } : {};
        seen.add(item.tag);
        criteria.push({ ...base, standing: standingOf(coveredBy), coveredBy, ...repeated });
      }
    }
    if (e.event === "issue.unreadable") {
      const tags = [...new Set(covers.filter((c) => c.id?.issue === e.issue).map((c) => c.id!.tag))];
      for (const tag of tags) {
        criteria.push({
          tag, text: "", issue: e.issue, url: e.url, standing: "Unverified",
          coveredBy: coveringCases(e.issue, tag), warning: `could not read #${e.issue}: ${e.error}`,
        });
      }
    }
  }

  const problems: CoverProblem[] = [];
  for (const { file, cover, id } of covers) {
    if (!id) problems.push({ file, cover, problem: "not an Acceptance Criterion ID like #123/tag" });
    else if (criteriaByIssue.get(id.issue)?.every((c) => c.tag !== id.tag)) {
      problems.push({ file, cover, problem: `#${id.issue} has no Acceptance Criterion tagged [${id.tag}]` });
    }
  }
  return { criteria, problems };
}

function standingOf(coveredBy: CoveringCase[]): Standing {
  if (coveredBy.some((c) => c.verdict === "Failed")) return "Unmet";
  if (coveredBy.length && coveredBy.every((c) => c.verdict === "Passed")) return "Met";
  return "Unverified";
}

/** Reads issues of one repo on an issue tracker. */
export interface IssueReader {
  repo: string;
  /** Where an issue lives, or undefined when the repo is unknown. */
  url(issue: number): string | undefined;
  read(issue: number): Promise<{ title: string; body: string; url: string }>;
}

/**
 * Reads every issue the Test Cases cover, once, into the Journal, so the report can
 * evaluate Acceptance Criteria from the Journal alone. An issue that cannot be read is
 * journalled as such and the Run goes on.
 */
export async function readCoveredIssues(testCases: TestCase[], reader: IssueReader, journal: Journal) {
  const issues = new Set(testCases.flatMap((tc) => tc.covers.map(parseCriterionId)).filter((id) => id).map((id) => id!.issue));
  for (const issue of issues) {
    try {
      journal.record("issue.read", { repo: reader.repo, issue, ...(await reader.read(issue)) });
    } catch (e) {
      journal.record("issue.unreadable", { repo: reader.repo, issue, url: reader.url(issue), error: (e as Error).message });
    }
  }
}
