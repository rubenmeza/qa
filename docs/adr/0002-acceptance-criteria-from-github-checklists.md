# Acceptance Criteria come from GitHub issue checklists

Acceptance Criteria are not kept in this tool or beside the Test Cases: they are the tagged checklist items under an `## Acceptance criteria` heading in the app's GitHub issues, e.g. `- [ ] [export-pdf] Admin can export invoices as PDF`, identified as `#123/export-pdf`. Test Cases declare `covers: ["#123/export-pdf"]`. The issue is the agreement people already sign off on, so it stays the single source; the inline Criterion Tag keeps IDs stable when items are reordered or edited.

## Considered Options

- **`qa/criteria.md` in the app repo.** No API dependency, but a second copy of the agreement that drifts from the issue.
- **Positional IDs (`#123.2`)**, with or without a text hash. No issue edits needed, but reordering silently re-points Coverage, or churns it.
- **One issue per criterion.** Simpler parsing, too coarse when one issue holds many criteria.

## Consequences

- Untagged checklist items are reported as Unverified with a "needs tag" warning.
- Writing back is opt-in (`qa run --publish`) and only posts or updates one results comment per issue. The tool never ticks checkboxes: ticking is a human sign-off on the agreement.
- Needs a GitHub token at run time; other trackers would need their own reader.
