# Web App QA

Automated replacement for manual QA: plain-language test cases run against a web application, with each step's outcome judged rather than hard-coded.

## Language

**Acceptance Criterion**:
One agreed statement of what the Application Under Test must let a user do or see: a tagged checklist item in an issue. Met when every Test Case covering it Passed, Unmet when any Failed, otherwise Unverified.
_Avoid_: Agreement, requirement, user story

**Criterion Tag**:
The short name written in an Acceptance Criterion's own text that identifies it, together with its issue, however the issue is later reordered or edited.
_Avoid_: Criterion number, index

**Coverage**:
The link from a Test Case to the Acceptance Criteria it proves. An Acceptance Criterion with no covering Test Case is Unverified.
_Avoid_: Traceability, mapping

**Test Case**:
A named, plain-language description of one user journey through the application, made of ordered Steps.
_Avoid_: Test script, scenario, spec

**Step**:
One line inside a Test Case, either an Action or an Expectation, never both.
_Avoid_: Command, instruction

**Action**:
A Step telling the tool to do something to the application, as a user would (click, type, navigate).
_Avoid_: Do, command, interaction

**Expectation**:
A Step stating something that must be true of the application at that point.
_Avoid_: Assertion, check, verification

**Visual Expectation**:
An Expectation about how the page looks (colour, layout, images, overlap) that the Page Snapshot cannot show, so it is judged from a picture of the page.
_Avoid_: Screenshot check, visual assertion

**Literal**:
An exact value written in quotes inside a Step, used verbatim (text to type, URL to open).
_Avoid_: Parameter, argument, input

**Variable**:
A named placeholder in a Step resolved from Test Data at run time, so secrets and fixtures stay out of Test Cases.
_Avoid_: Placeholder, template, param

**Test Data**:
The named values (credentials, fixtures) that Variables resolve against for a run.
_Avoid_: Fixtures, env, config

**Page Snapshot**:
A text description of what the page shows a user at one moment: its elements, their roles, labels, text and states. Every Step but a Visual Expectation is judged from it; visual appearance is not part of it.
_Avoid_: DOM, screen, view

**Setup**:
A Test Case whose end state (a signed-in session, for example) other Test Cases start from. Runs once per Run.
_Avoid_: Fixture, before-hook, precondition

**Requires**:
A Test Case's declared dependency on a Setup.
_Avoid_: Depends on, needs

## Outcomes

**Run**:
One execution of one or more Test Cases against an Application Under Test.
_Avoid_: Execution, session, job

**Verdict**:
The outcome of a Step or Test Case: Passed, Failed, Needs Review, or Skipped.
_Avoid_: Result, status

**Escalation**:
Handing a Step the fast judgment could not confidently decide to a slower, stronger judge before any human sees it.
_Avoid_: Fallback, retry

**Needs Review**:
The Verdict given when even Escalation cannot confidently decide a Step; the Test Case halts and a human decides.
_Avoid_: Flaky, unknown, inconclusive

**Review**:
A human's decision resolving a Needs Review Step as Passed or Failed. Kept, so future Runs judge more like the human did.
_Avoid_: Triage, override, approval

**Skipped**:
The Verdict of a Test Case that never ran because a Setup it requires did not pass.
_Avoid_: Blocked, ignored

**Evidence**:
What a Run keeps for each Step so a human can judge it: what the page looked like and how confident each judgment was.
_Avoid_: Artifacts, logs, trace

**Journal**:
The complete, durable record of a Run: every Step attempted, every judgment asked and answered, every Escalation, and the Evidence for each. Reports and Reviews are read from it.
_Avoid_: Log, history, trace

**Application Under Test**:
The web application a Test Case runs against.
_Avoid_: Target, site, SUT
