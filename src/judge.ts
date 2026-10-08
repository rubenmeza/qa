import { choice, noul, TypeSafeClient, TypeSafeError } from "@typesafe-ai/sdk";
import type { Candidate } from "./page-snapshot.ts";

export const ACTION_KINDS = ["open", "click", "type", "select", "press", "wait"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** What was asked and answered, kept in the Journal. */
export type JudgeRecord = { model: string; request: unknown; response: unknown; ms: number };

/** `p` is the probability of `choice`. */
export type JudgedChoice = { choice: string; p: number; record: JudgeRecord };

/** `p` is the probability that the statement holds. */
export type JudgedStatement = { p: number; record: JudgeRecord };

/** The narrow questions the runner asks about a Step. Inputs are already free of Test Data values. */
export interface Judge {
  /** Which of the core Actions the step describes; choice is an ActionKind. */
  actionKind(step: string): Promise<JudgedChoice>;
  /** Which candidate the step acts on; choice is a candidate id or "none". */
  target(step: string, pageSnapshot: string, candidates: Candidate[]): Promise<JudgedChoice>;
  expectation(statement: string, page: { url: string; pageSnapshot: string }): Promise<JudgedStatement>;
}

/** The judge could not answer (network, auth, rate limit): says nothing about the app. */
export class JudgeUnavailableError extends Error {}

export const JEV_MODEL = "jev-1.13.0"; // pinned: thresholds are tuned per version

export function jevJudge(client = new TypeSafeClient({ defaultModel: JEV_MODEL })): Judge {
  async function ask(state: Record<string, unknown>, questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>>) {
    const t0 = Date.now();
    try {
      const res = await client.systemOne({ state: state as never, questions });
      const answers = res.answers as Record<string, any>;
      return { answers, record: { model: res.model, request: { state, questions }, response: { answers, usage: res.usage }, ms: Date.now() - t0 } };
    } catch (e) {
      if (e instanceof TypeSafeError) throw new JudgeUnavailableError(`Jev: ${e.message}`);
      throw e;
    }
  }
  const picked = ({ answers, record }: Awaited<ReturnType<typeof ask>>): JudgedChoice => {
    const a = answers.q;
    return { choice: a.choice, p: a.probabilities[a.choice], record };
  };

  return {
    async actionKind(step) {
      return picked(await ask({ step }, {
        q: choice("Which kind of browser action does `step` describe?", {
          open: "Open or navigate to a URL",
          click: "Click or tap an element",
          type: "Type text into a field",
          select: "Pick an option from a dropdown",
          press: "Press a keyboard key",
          wait: "Wait until some text appears",
        }),
      }));
    },
    async target(step, pageSnapshot, candidates) {
      const criteria: Record<string, string> = Object.fromEntries(candidates.map((c) => [c.id, c.label]));
      criteria.none = "No element on the page matches what the step describes";
      return picked(await ask({ step, page_snapshot: pageSnapshot }, {
        q: choice("Which element in `page_snapshot` does `step` act on?", criteria),
      }));
    },
    async expectation(statement, page) {
      const { answers, record } = await ask({ url: page.url, page_snapshot: page.pageSnapshot }, {
        q: noul(`Is this statement true of the page described in \`page_snapshot\`? Statement: ${statement}`, {
          true: "The page snapshot clearly shows the statement is true",
          false: "The page snapshot shows the statement is false, or shows nothing that makes it true",
        }),
      });
      return { p: answers.q.noul, record };
    },
  };
}
