---
phase: plan
epic-id: runtime-date-context-injection-b05c
epic-slug: runtime-date-context-injection-b05c
feature-name: Runtime Date Injection
wave: 1
---

# Runtime Date Injection

**Design:** .beastmode/artifacts/design/2026-04-15-runtime-date-context-injection-b05c.md

## User Stories

1. As a Claude Code user, I want the session context to include the current date and time, so that the LLM can reason about temporal context without me having to state it manually.
2. As a Claude Code user, I want the date to include the day name, full date, 24-hour time, and timezone, so that the information is unambiguous and complete.
3. As a Claude Code user, I want the date to appear at the top of the assembled context, so that it is immediately available to the LLM before any project-specific content.

## What to Build

Add a date formatting module that produces a single English sentence containing the current day name, full date, 24-hour time, and timezone abbreviation. The format is: `Today is {DayName}, {Month} {DD}, {YYYY} at {HH}:{mm} {TZ}.`

Use `Intl.DateTimeFormat` with hardcoded `en-US` locale and `timeZoneName: "short"` for timezone resolution. The formatting function accepts an optional `Date` parameter for testability — defaults to `new Date()` at call time.

Modify the context assembly module to prepend the date sentence to the assembled output. The sentence appears as the first content, separated from `.2b/` category sections by a blank line. When all categories are empty, the output contains only the date sentence.

Update existing unit tests to account for the date prefix in assembled output. Add new unit tests for the date formatting function using injected `Date` objects. Update existing integration tests that assert on `additionalContext` content to expect the date sentence at the top.

**Cross-cutting constraints from the PRD:**
- Always English regardless of system locale
- 24-hour clock
- No heading or markdown structure — bare sentence
- No opt-out mechanism
- System local timezone with short abbreviation

## Integration Test Scenarios

```gherkin
@runtime-date-context-injection-b05c @context-assembly
Feature: Runtime date context injection -- prepends current date and time to assembled context

  Background:
    Given a temporary working directory
    And the CLI entry point is available as "2bd"
    And a ".2b/system/" directory that is empty
    And a ".2b/concepts/" directory that is empty
    And a ".2b/instructions/" directory that is empty

  Scenario: Session context includes a date and time sentence
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And stdout is valid JSON matching the hook contract
    And the JSON "hookSpecificOutput.additionalContext" begins with a sentence matching "Today is {DayName}, {Month} {DD}, {YYYY} at {HH}:{mm} {TZ}."

  Scenario: Date sentence includes the day name, full date, 24-hour time, and timezone
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And the opening sentence of "hookSpecificOutput.additionalContext" contains a day name
    And the opening sentence contains a full month name
    And the opening sentence contains a two-digit day of month
    And the opening sentence contains a four-digit year
    And the opening sentence contains a time in 24-hour format
    And the opening sentence contains a timezone abbreviation

  Scenario: Date sentence appears before any file content in the assembled context
    Given a ".2b/system/" directory containing
      | file        | content                |
      | persona.md  | You are a helpful bot. |
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And the JSON "hookSpecificOutput.additionalContext" begins with "Today is"
    And the date sentence appears before "## .2b/system/persona.md"

  Scenario: Date sentence is present even when all category directories are empty
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And the JSON "hookSpecificOutput.additionalContext" begins with "Today is"
    And the JSON "hookSpecificOutput.additionalContext" contains a valid date sentence
```

**Consolidation (existing test updates):**

- **"Produces valid output when all category directories are empty"** — update to expect date sentence instead of empty/whitespace `additionalContext`
- **"Assembles context from all three categories in fixed order"** — update to assert date sentence precedes all `.2b/` section headers

## Acceptance Criteria

- [ ] `assembleContext()` output begins with `Today is {DayName}, {Month} {DD}, {YYYY} at {HH}:{mm} {TZ}.`
- [ ] Date sentence uses hardcoded `en-US` locale with 24-hour clock
- [ ] Timezone is system local with short abbreviation (e.g. `CET`, `EST`, `PDT`)
- [ ] Date sentence precedes all `.2b/` category sections in assembled output
- [ ] When all categories are empty, output contains only the date sentence
- [ ] Date formatting function accepts optional `Date` parameter for testability
- [ ] Unit tests pass with injected `Date` objects — no wall-clock dependency
- [ ] Existing integration tests updated to account for date prefix
- [ ] New integration tests verify date presence, format, and position
