import type { Journal } from "./journal.ts";
import type { TestCase } from "./test-case.ts";

/** A checklist item under an issue's `## Acceptance criteria` heading; `tag` is its Criterion Tag. */
export type Criterion = { tag: string | undefined; text: string };

/** Reads the checklist items under the `Acceptance criteria` heading, up to the next heading. */
export function parseAcceptanceCriteria(issueBody: string): Criterion[] {
  const criteria: Criterion[] = [];
  let inSection = false;
  for (const line of issueBody.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.*?)\s*$/);
    if (heading) {
      inSection = /^acceptance criteria$/i.test(heading[1]);
      continue;
    }
    const item = inSection && line.match(/^\s*[-*] \[[ xX]\]\s+(?:\[([\w-]+)\]\s+)?(.+?)\s*$/);
    if (item) criteria.push({ tag: item[1], text: item[2] });
  }
  return criteria;
}

/** `#123/export-pdf` → issue 123, Criterion Tag `export-pdf`. */
export function parseCriterionId(id: string): { issue: number; tag: string } | undefined {
  const m = id.match(/^#(\d+)\/([\w-]+)$/);
  return m ? { issue: Number(m[1]), tag: m[2] } : undefined;
}

export type CriterionStatus = "Met" | "Unmet" | "Unverified";

export type EvaluatedCriterion = Criterion & {
  issue: number;
  status: CriterionStatus;
  coveredBy: { file: string; verdict: string | undefined }[];
  warning?: string;
};

/** A `covers:` entry that resolves to no Acceptance Criterion. */
export type CoverProblem = { file: string; cover: string; problem: string };

type Event = Record<string, any>;

/**
 * Each Acceptance Criterion of the issues read in a Run, with its status from the Test
 * Cases covering it: Met when every one Passed, Unmet when any Failed, otherwise Unverified.
 */
export function evaluateCriteria(events: Event[]): { criteria: EvaluatedCriterion[]; problems: CoverProblem[] } {
  const verdictOf = new Map<string, string>(events.filter((e) => e.event === "case.verdict").map((e) => [e.file, e.verdict]));
  const covers = events
    .filter((e) => e.event === "case.started" || e.event === "case.skipped")
    .flatMap((e) => (e.covers as string[]).map((cover) => ({ file: e.file as string, cover, id: parseCriterionId(cover) })));
  const coveredBy = (issue: number, tag: string) =>
    covers.filter((c) => c.id?.issue === issue && c.id.tag === tag).map((c) => ({ file: c.file, verdict: verdictOf.get(c.file) }));

  const criteria: EvaluatedCriterion[] = [];
  const read = new Map<number, Criterion[]>();
  for (const e of events) {
    if (e.event === "issue.read") {
      const items = parseAcceptanceCriteria(e.body);
      read.set(e.issue, items);
      for (const item of items) {
        if (!item.tag) {
          criteria.push({ ...item, issue: e.issue, status: "Unverified", coveredBy: [], warning: "needs tag" });
          continue;
        }
        const by = coveredBy(e.issue, item.tag);
        criteria.push({ ...item, issue: e.issue, status: statusOf(by), coveredBy: by });
      }
    }
    if (e.event === "issue.unreadable") {
      const tags = [...new Set(covers.filter((c) => c.id?.issue === e.issue).map((c) => c.id!.tag))];
      for (const tag of tags) {
        criteria.push({ tag, text: "", issue: e.issue, status: "Unverified", coveredBy: coveredBy(e.issue, tag), warning: `could not read #${e.issue}: ${e.error}` });
      }
    }
  }

  const problems: CoverProblem[] = [];
  for (const { file, cover, id } of covers) {
    if (!id) problems.push({ file, cover, problem: "not an Acceptance Criterion ID like #123/tag" });
    else if (read.has(id.issue) && !read.get(id.issue)!.some((c) => c.tag === id.tag)) {
      problems.push({ file, cover, problem: `#${id.issue} has no Acceptance Criterion tagged [${id.tag}]` });
    }
  }
  return { criteria, problems };
}

function statusOf(coveredBy: { verdict: string | undefined }[]): CriterionStatus {
  if (coveredBy.some((c) => c.verdict === "Failed")) return "Unmet";
  if (coveredBy.length && coveredBy.every((c) => c.verdict === "Passed")) return "Met";
  return "Unverified";
}

/** Reads issues of one GitHub repo. */
export interface IssueReader {
  repo: string;
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
      journal.record("issue.unreadable", { repo: reader.repo, issue, error: (e as Error).message });
    }
  }
}
