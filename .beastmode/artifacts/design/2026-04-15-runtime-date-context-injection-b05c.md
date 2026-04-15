---
phase: design
epic-id: bm-b05c
epic-slug: runtime-date-context-injection-b05c
epic-name: Runtime Date Context Injection
---

## Problem Statement

Claude Code sessions have no awareness of the current date and time. The assembled context from `.2b/` is entirely static — it reflects file contents but nothing about when the session started. This limits the LLM's ability to reason about temporal context (deadlines, recency, scheduling).

## Solution

Prepend a long-form date and time sentence to the assembled context output, computed at runtime by the CLI. The sentence is always present, requires no user configuration, and appears before any `.2b/` file content.

Example output: `Today is Tuesday, April 15, 2026 at 14:35 CET.`

## User Stories

1. As a Claude Code user, I want the session context to include the current date and time, so that the LLM can reason about temporal context without me having to state it manually.
2. As a Claude Code user, I want the date to include the day name, full date, 24-hour time, and timezone, so that the information is unambiguous and complete.
3. As a Claude Code user, I want the date to appear at the top of the assembled context, so that it is immediately available to the LLM before any project-specific content.

## Implementation Decisions

- The date sentence is a built-in runtime value, not derived from any user file.
- Format: `Today is {DayName}, {Month} {DD}, {YYYY} at {HH}:{mm} {TZ}.` — e.g. `Today is Tuesday, April 15, 2026 at 14:35 CET.`
- 24-hour clock.
- System local timezone with short abbreviation (via `Intl.DateTimeFormat` or equivalent).
- Always English regardless of system locale — hardcoded locale `en-US` for date formatting.
- No heading or markdown structure — bare sentence prepended to the context string.
- Position: first content in the assembled output, before any `.2b/` category sections.
- No opt-out mechanism in v1 — the date is always injected. Opt-out deferred as a future feature.

## Testing Decisions

- Unit tests should verify the date sentence is prepended to the assembled context.
- Date formatting should be tested by injecting a known `Date` object rather than relying on wall-clock time — pass the date as a parameter or use a clock abstraction.
- Existing integration tests for session-start output should be updated to expect the date sentence at the top.
- Prior art: existing tests in `tests/unit/assemble-context.test.ts` use filesystem fixtures; the date test can follow the same pattern but with a controlled date input.

## Out of Scope

- Configuration or opt-out for date injection.
- Non-English locale support for date names.
- Additional runtime values beyond date/time (e.g., hostname, user, working directory).

## Further Notes

None

## Deferred Ideas

- Opt-out flag or config option to disable date injection.
- General-purpose runtime values section (hostname, git branch, user identity).
