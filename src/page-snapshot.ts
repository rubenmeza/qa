import type { Page } from "playwright";

/** The Page Snapshot: Playwright's accessibility tree of the page, as text. */
export const takeSnapshot = (page: Page) => page.locator("body").ariaSnapshot();

const INTERACTIVE = new Set([
  "button", "link", "textbox", "checkbox", "radio", "combobox", "listbox", "option",
  "menuitem", "tab", "switch", "searchbox", "spinbutton", "slider",
]);

/** An element an Action can target; `nth` tells apart elements sharing role and name. */
export type Candidate = { id: string; role: string; name: string; nth: number; label: string };

export function candidates(pageSnapshot: string): Candidate[] {
  const seen = new Map<string, number>();
  const out: Candidate[] = [];
  for (const line of pageSnapshot.split("\n")) {
    const m = line.match(/^\s*- (\w+)(?: "((?:[^"\\]|\\.)*)")?/);
    if (!m || !INTERACTIVE.has(m[1])) continue;
    const role = m[1];
    const name = (m[2] ?? "").replace(/\\"/g, '"');
    const key = `${role}|${name}`;
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    out.push({ id: `e${out.length}`, role, name, nth, label: line.trim().slice(2) });
  }
  return out;
}
