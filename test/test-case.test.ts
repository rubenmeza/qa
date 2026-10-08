import { describe, expect, it } from "vitest";
import { missingVariables, parseTestCase, resolveVariables } from "../src/test-case.ts";

const SIGN_IN = `---
covers: ["#1/sign-in", "#4/greeting"]
---
# Sign in with valid credentials

Some free prose the parser ignores.

- do: open "http://localhost:4173/"
- expect: a sign-in form asks for an email and a password
- do: type "{{email}}" into the email field
`;

describe("parseTestCase", () => {
  it("reads the title, covers and ordered Steps", () => {
    const tc = parseTestCase("qa/sign-in.md", SIGN_IN);
    expect(tc).toMatchObject({
      file: "qa/sign-in.md",
      title: "Sign in with valid credentials",
      covers: ["#1/sign-in", "#4/greeting"],
    });
    expect(tc.steps).toEqual([
      { n: 1, kind: "do", text: 'open "http://localhost:4173/"', literals: ["http://localhost:4173/"] },
      { n: 2, kind: "expect", text: "a sign-in form asks for an email and a password", literals: [] },
      { n: 3, kind: "do", text: 'type "{{email}}" into the email field', literals: ["{{email}}"] },
    ]);
  });
});

describe("Variables", () => {
  const tc = parseTestCase("qa/x.md", `# X
- do: type "{{email}}" into the email field
- do: type "{{password}}" into the password field
- expect: the page greets "{{name}}"
`);

  it("lists Variables that have no Test Data", () => {
    expect(missingVariables(tc, { email: "ada@example.com" })).toEqual(["password", "name"]);
    expect(missingVariables(tc, { email: "a", password: "b", name: "c" })).toEqual([]);
  });

  it("resolves Variables inside a Literal from Test Data", () => {
    expect(resolveVariables("{{email}}", { email: "ada@example.com" })).toBe("ada@example.com");
    expect(resolveVariables("Hi {{name}}!", { name: "Ada" })).toBe("Hi Ada!");
  });
});
