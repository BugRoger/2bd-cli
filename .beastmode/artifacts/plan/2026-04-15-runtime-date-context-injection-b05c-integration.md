---
phase: plan
epic-id: bm-b05c
epic-slug: runtime-date-context-injection-b05c
epic-name: Runtime Date Context Injection
artifact-type: integration
---

## New Scenarios

### Feature: runtime-date-injection

Covers user stories [1, 2, 3].

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

## Consolidation

##### Update: Produces valid output when all category directories are empty

**File:** `.beastmode/artifacts/plan/2026-04-12-session-context-hook-cli-4983-integration.md`
**Action:** update
**Reason:** With the runtime date injection feature, `additionalContext` will always contain at least the date sentence even when all `.2b/` category directories are empty. The prior scenario asserts that `additionalContext` is "empty or whitespace", which is now incorrect. The scenario must be updated to expect the date sentence as the sole content when no files are present.

```gherkin
@session-context-hook-cli-4983 @context-assembly
Feature: Context assembly CLI -- assembles .2b/ markdown into hook-compatible JSON

  Scenario: Produces valid output when all category directories are empty
    Given a temporary working directory
    And the CLI entry point is available as "2bd"
    And a ".2b/system/" directory that is empty
    And a ".2b/concepts/" directory that is empty
    And a ".2b/instructions/" directory that is empty
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And stdout is valid JSON matching the hook contract
    And the JSON "hookSpecificOutput.additionalContext" begins with "Today is"
    And the JSON "hookSpecificOutput.additionalContext" contains no file section headers
```

##### Update: Assembles context from all three categories in fixed order

**File:** `.beastmode/artifacts/plan/2026-04-12-session-context-hook-cli-4983-integration.md`
**Action:** update
**Reason:** The date sentence now precedes all `.2b/` file sections in the assembled context. The existing scenario validates ordering of file sections but does not account for the date sentence appearing first. The scenario must be updated to assert that the date sentence comes before the first file section header.

```gherkin
@session-context-hook-cli-4983 @context-assembly
Feature: Context assembly CLI -- assembles .2b/ markdown into hook-compatible JSON

  Scenario: Assembles context from all three categories in fixed order with date prefix
    Given a temporary working directory
    And the CLI entry point is available as "2bd"
    And a ".2b/system/" directory containing
      | file            | content                |
      | persona.md      | You are a helpful bot. |
    And a ".2b/concepts/" directory containing
      | file            | content                     |
      | architecture.md | The system uses microservices. |
    And a ".2b/instructions/" directory containing
      | file            | content                    |
      | formatting.md   | Use markdown in responses. |
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And stdout is valid JSON matching the hook contract
    And the JSON "hookSpecificOutput.additionalContext" begins with "Today is"
    And the JSON "hookSpecificOutput.additionalContext" contains sections in order
      | section_header                    |
      | ## .2b/system/persona.md          |
      | ## .2b/concepts/architecture.md   |
      | ## .2b/instructions/formatting.md |
    And the date sentence appears before all section headers
    And each section is followed by its file content
```
