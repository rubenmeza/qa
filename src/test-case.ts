export type StepKind = "do" | "expect";

/** `literals` are the "quoted" values, still holding any `{{variables}}`. */
export type Step = { n: number; kind: StepKind; text: string; literals: string[] };

export type TestData = Record<string, string>;

export type TestCase = { file: string; title: string; covers: string[]; steps: Step[] };

export function parseTestCase(file: string, markdown: string): TestCase {
  const frontMatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const covers = frontMatter.match(/^covers:\s*(\[.*\])\s*$/m)?.[1];
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
    title: markdown.match(/^# (.+?)\s*$/m)?.[1] ?? file,
    covers: covers ? JSON.parse(covers) : [],
    steps,
  };
}

const VARIABLE = /\{\{(\w+)\}\}/g;

export function missingVariables(testCase: TestCase, testData: TestData): string[] {
  const names = testCase.steps.flatMap((s) => [...s.text.matchAll(VARIABLE)].map((m) => m[1]));
  return [...new Set(names)].filter((name) => !(name in testData));
}

export function resolveVariables(text: string, testData: TestData): string {
  return text.replace(VARIABLE, (whole, name: string) => testData[name] ?? whole);
}
