# Jev judges, Playwright acts, text first

Playwright executes every Action; AI models only answer narrow typed questions (TypeSafe System One primitives: Choice, Noul, Score) about each Step. Actions and ordinary Expectations are judged by Jev from the Page Snapshot (accessibility tree as text), because web apps expose their structure and Jev 1.13 accepts text only. Only Visual Expectations (`expect-visual:`) are judged from a screenshot, by `openai/gpt-6-luna-decisions` through OpenRouter's alpha Decisions API, which takes images in the same primitive format. No generative LLM drives the browser.

## Considered Options

- **Screenshots only, like ThePrimeagen/Oligarchy.** Oligarchy tests a Linux desktop with no DOM, so it judges pixels and finds click points with a grid locator (one Noul per cell, zooming in rounds). For web apps that is costlier, slower and less exact than targeting a DOM element the Page Snapshot already names. Only worth revisiting for canvas/WebGL apps.
- **Generative agent (browser-use, Playwright MCP + an LLM).** Flexible, but nondeterministic, expensive per Step and harder to calibrate than typed probabilities.
- **Text only.** Simplest and single-provider, but cannot check colour, layout, overlap or images.

## Consequences

- Two AI providers: TypeSafe (Jev) and OpenRouter (Luna Decisions, plus the slow LLM used for Escalation). Keys stay inside the container.
- OpenRouter's Decisions API is alpha; Visual Expectations depend on it and may break with it.
- Jev cannot generate values, so Literals must be quoted and secrets come from Variables; code extracts them, Jev never invents them.
