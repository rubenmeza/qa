import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type JournalEvent = { ts: string; event: string; [key: string]: unknown };

/** The durable record of a Run. Reports and Reviews are read from it, nothing else. */
export interface Journal {
  record(event: string, data: Record<string, unknown>): void;
  /** Stores Evidence next to the Journal and returns the path to reference it by. */
  attach(name: string, bytes: Buffer): string;
}

export const JOURNAL_FILE = "journal.jsonl";

export function fileJournal(runDir: string): Journal {
  mkdirSync(runDir, { recursive: true });
  return {
    record(event, data) {
      appendFileSync(join(runDir, JOURNAL_FILE), JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n");
    },
    attach(name, bytes) {
      mkdirSync(dirname(join(runDir, name)), { recursive: true });
      writeFileSync(join(runDir, name), bytes);
      return name;
    },
  };
}
