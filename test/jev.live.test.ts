import { describe, expect, it } from "vitest";
import { jevJudge } from "../src/judge.ts";
import { candidates } from "../src/page-snapshot.ts";

// Calls the real Jev API: runs only with TYPESAFE_API_KEY set.
describe.skipIf(!process.env.TYPESAFE_API_KEY)("Jev judge (live)", () => {
  const judge = () => jevJudge();
  const pageSnapshot = `- main:
  - heading "Acme Billing" [level=1]
  - textbox "Email"
  - textbox "Password"
  - button "Sign in"`;

  it("picks the element a Step acts on", async () => {
    const t = await judge().target("type the given value into the password field", pageSnapshot, candidates(pageSnapshot));
    expect(t.choice).toBe("e1");
    expect(t.p).toBeGreaterThanOrEqual(0.9);
  });

  it("judges an Expectation true or false from the Page Snapshot", async () => {
    const page = { url: "http://localhost/", pageSnapshot };
    expect((await judge().expectation("a sign-in form asks for an email and a password", page)).p).toBeGreaterThanOrEqual(0.9);
    expect((await judge().expectation("a list of invoices is shown", page)).p).toBeLessThanOrEqual(0.1);
  });
});
