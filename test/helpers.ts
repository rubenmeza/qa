import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import type { Judge, JudgeRecord } from "../src/judge.ts";
import type { Journal, JournalEvent } from "../src/journal.ts";
import type { Candidate } from "../src/page-snapshot.ts";

/** Serves test/fixtures/<name>.html at /<name>, plus any inline pages. */
export function useFixtureServer(inline: Record<string, string> = {}) {
  let server: Server;
  const ctx = { url: "" };
  beforeAll(async () => {
    server = createServer((req, res) => {
      const name = (req.url ?? "/").slice(1) || "index";
      const html = inline[name] ?? readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url));
      res.writeHead(200, { "content-type": "text/html" }).end(html);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    ctx.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  return ctx;
}

export function useBrowserPage() {
  let browser: Browser;
  const ctx = {} as { page: Page };
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(() => browser.close());
  beforeEach(async () => { ctx.page = await (await browser.newContext()).newPage(); });
  afterEach(() => ctx.page.context().close());
  return ctx;
}

export function memoryJournal(): Journal & { events: JournalEvent[]; attachments: Map<string, Buffer> } {
  const events: JournalEvent[] = [];
  const attachments = new Map<string, Buffer>();
  return {
    events,
    attachments,
    record: (event, data) => { events.push({ ts: new Date().toISOString(), event, ...data }); },
    attach: (name, bytes) => { attachments.set(name, bytes); return name; },
  };
}

const record = (request: unknown, response: unknown): JudgeRecord => ({ model: "fake", request, response, ms: 0 });

type Answer = { choice: string; p: number };
/**
 * A Judge scripted by plain functions, standing in for Jev. Every input it
 * receives is kept in `seen` so tests can check what the judge was shown.
 */
export function fakeJudge(script: {
  element?: (step: string, candidates: Candidate[], pageSnapshot: string) => Answer;
  expectation?: (statement: string, pageSnapshot: string) => number;
  actionKind?: (step: string) => Answer;
}) {
  const seen: unknown[] = [];
  const judge: Judge = {
    async actionKind(step) {
      seen.push({ step });
      const a = script.actionKind!(step);
      return { ...a, record: record({ step }, a) };
    },
    async element(step, pageSnapshot, candidates) {
      seen.push({ step, pageSnapshot, candidates });
      const a = script.element!(step, candidates, pageSnapshot);
      return { ...a, record: record({ step, pageSnapshot }, a) };
    },
    async expectation(statement, page) {
      seen.push({ statement, ...page });
      const p = script.expectation!(statement, page.pageSnapshot);
      return { p, record: record({ statement, ...page }, { p }) };
    },
  };
  return Object.assign(judge, { seen });
}

/** Picks the candidate whose accessible name appears in the step, like a sensible judge would. */
export const byName = (step: string, candidates: Candidate[]): Answer => {
  const hit = candidates.find((c) => c.name && step.toLowerCase().includes(c.name.toLowerCase()));
  return hit ? { choice: hit.id, p: 0.99 } : { choice: "none", p: 0.99 };
};
