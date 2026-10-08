import type { IssueReader } from "./acceptance-criteria.ts";

/** Reads issues through the GitHub REST API. Read-only; a token lifts rate limits and opens private repos. */
export function githubIssueReader(repo: string, token = process.env.GITHUB_TOKEN): IssueReader {
  return {
    repo,
    async read(issue) {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issue}`, {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "qa",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
      const json = (await res.json()) as { title: string; body: string | null; html_url: string };
      return { title: json.title, body: json.body ?? "", url: json.html_url };
    },
  };
}

/** `owner/name` from a GitHub remote URL (ssh or https), or undefined for other hosts. */
export function repoFromRemote(remote: string): string | undefined {
  return remote.trim().match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
}
