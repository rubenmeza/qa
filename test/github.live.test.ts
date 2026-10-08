import { describe, expect, it } from "vitest";
import { parseAcceptanceCriteria } from "../src/acceptance-criteria.ts";
import { githubIssueReader } from "../src/github.ts";

// Calls the real GitHub API: runs only with GITHUB_TOKEN set.
describe.skipIf(!process.env.GITHUB_TOKEN)("GitHub issue reader (live)", () => {
  it("reads this repo's own issue and its tagged Acceptance Criteria", async () => {
    const issue = await githubIssueReader("rubenmeza/qa").read(5);
    expect(issue).toMatchObject({ title: "Acceptance Criteria from GitHub issues", url: "https://github.com/rubenmeza/qa/issues/5" });
    expect(parseAcceptanceCriteria(issue.body).map((c) => c.tag)).toContain("read-criteria");
  });

  it("fails clearly for an issue that does not exist", async () => {
    await expect(githubIssueReader("rubenmeza/qa").read(99999)).rejects.toThrow(/^404/);
  });
});
