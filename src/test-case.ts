export type StepKind = "do" | "expect";

/** `literals` are the "quoted" values, still holding any `{{variables}}`. */
export type Step = { n: number; kind: StepKind; text: string; literals: string[] };

export type TestData = Record<string, string>;

/**
 * `name` is the file name without `.md`: how `requires:` refers to a Test Case.
 * `requires` names the Setup this Test Case starts from (at most one, checked when planning the Run).
 */
export type TestCase = { file: string; name: string; title: string; covers: string[]; requires: string[]; steps: Step[] };

export function parseTestCase(file: string, markdown: string): TestCase {
  const frontMatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const steps: Step[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^- (do|expect):\s*(.+?)\s*$/);
    if (m) steps.push({
      n: steps.length + 1,
      kind: m[1] as StepKind,
      text: m[2],
      literals: [...m[2].matchAll(/"([^"]*)"/g)].map((l) => l[1]),
    });
  }
  return {
    file,
    name: file.replace(/^.*\//, "").replace(/\.md$/, ""),
    title: markdown.match(/^# (.+?)\s*$/m)?.[1] ?? file,
    covers: parseList(frontMatter, "covers"),
    requires: parseList(frontMatter, "requires"),
    steps,
  };
}

/** A front-matter list, inline (`key: [#1/a, "#2/b"]`) or as a YAML block list. */
function parseList(frontMatter: string, key: string): string[] {
  const m = frontMatter.match(new RegExp(`^${key}:[ \\t]*(.*)\\n?((?:[ \\t]+-.*\\n?)*)`, "m"));
  if (!m) return [];
  const items = m[1].trim() ? m[1].trim().replace(/^\[|\]$/g, "").split(",") : m[2].split("\n").map((l) => l.replace(/^\s*-/, ""));
  return items.map((i) => i.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** `{file}#{n}`: how the Journal refers to a Step. */
export const stepRef = (file: string, n: number) => `${file}#${n}`;

const VARIABLE = /\{\{(\w+)\}\}/g;

/** Names of the Variables a Test Case uses, in order of first use. */
export function variableNames(testCase: TestCase): string[] {
  return [...new Set(testCase.steps.flatMap((s) => [...s.text.matchAll(VARIABLE)].map((m) => m[1])))];
}

export function missingVariables(testCase: TestCase, testData: TestData): string[] {
  return variableNames(testCase).filter((name) => !(name in testData));
}

export function resolveVariables(text: string, testData: TestData): string {
  return text.replace(VARIABLE, (whole, name: string) => testData[name] ?? whole);
}
